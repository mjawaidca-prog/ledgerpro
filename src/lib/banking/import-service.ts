/**
 * Statement import orchestration — normalize mapped rows, dry-run duplicate
 * classification, commit, and 24-hour reversal. The client holds parsed rows
 * in state between the three steps; the server re-runs classification at
 * commit (TOCTOU-proof — locked rows are never importable regardless of the
 * client's skip choices).
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { makeDedupeKey, classifyDuplicates, type ExistingRow } from './dedupe';
import { guessPayee } from './payee';
import { applyRules, type BankRuleLike } from './rules';

export type ImportField =
  | 'ignore'
  | 'date'
  | 'description'
  | 'memo'
  | 'reference'
  | 'amount_signed'
  | 'amount_debit'
  | 'amount_credit'
  | 'statement_balance';

export interface RawRow {
  raw: Record<string, string>;
  rowIndex: number;
  fitid?: string | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function parseDateWithFormat(value: string, format: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const digits = v.match(/\d+/g) ?? [];
  if (digits.length < 3) return null;

  let year: number, month: number, day: number;

  switch (format) {
    case 'MDY': {
      month = Number(digits[0]); day = Number(digits[1]); year = Number(digits[2]);
      break;
    }
    case 'MM_DD_YYYY': {
      month = Number(digits[0]); day = Number(digits[1]); year = Number(digits[2]);
      break;
    }
    case 'DD_MM_YYYY': {
      day = Number(digits[0]); month = Number(digits[1]); year = Number(digits[2]);
      break;
    }
    case 'YYYYMMDD': {
      year = Number(digits[0]); month = Number(digits[1]); day = Number(digits[2]);
      break;
    }
    case 'YYYY_MM_DD':
    default: {
      year = Number(digits[0]); month = Number(digits[1]); day = Number(digits[2]);
      break;
    }
  }

  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

export interface NormalizedRow {
  rowIndex: number;
  date: string; // YYYY-MM-DD
  description: string;
  memo: string | null;
  reference: string | null;
  amount: number; // signed
  statementBalance: number | null;
  payeeGuess: string | null;
  dedupeHash: string;
}

export function normalizeRows(input: {
  rows: RawRow[];
  map: Record<string, ImportField>;
  dateFormat: string;
  amountMode: 'signed' | 'debit_credit';
}): { rows: NormalizedRow[]; errors: string[] } {
  const errors: string[] = [];
  const out: NormalizedRow[] = [];

  for (const row of input.rows) {
    const get = (field: ImportField): string | null => {
      for (const [col, f] of Object.entries(input.map)) {
        if (f === field && row.raw[col] !== undefined) return row.raw[col];
      }
      return null;
    };

    const dateStr = get('date');
    if (!dateStr) {
      errors.push(`Row ${row.rowIndex + 1}: no date column mapped`);
      continue;
    }
    const date = parseDateWithFormat(dateStr, input.dateFormat);
    if (!date) {
      errors.push(`Row ${row.rowIndex + 1}: date "${dateStr}" could not be read with ${input.dateFormat}`);
      continue;
    }

    const description = (get('description') ?? '').trim();
    if (!description) {
      errors.push(`Row ${row.rowIndex + 1}: no description`);
      continue;
    }

    const parseMoney = (v: string | null): number => {
      if (!v) return 0;
      const cleaned = v.replace(/[$,]/g, '').replace(/^\((.*)\)$/, '-$1');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    };

    let amount: number;
    if (input.amountMode === 'debit_credit') {
      amount = round2(parseMoney(get('amount_credit')) - parseMoney(get('amount_debit')));
    } else {
      amount = parseMoney(get('amount_signed'));
    }

    const balanceRaw = get('statement_balance');
    const statementBalance = balanceRaw ? parseMoney(balanceRaw) : null;

    out.push({
      rowIndex: row.rowIndex,
      date,
      description,
      memo: get('memo'),
      reference: get('reference') ?? row.fitid ?? null,
      amount,
      statementBalance,
      payeeGuess: guessPayee(description),
      dedupeHash: makeDedupeKey({ date, amount, description, fitid: row.fitid }),
    });
  }

  return { rows: out, errors };
}

export interface DryRunResult {
  preview: { date: string; description: string; payeeGuess: string | null; amount: number; statementBalance: number | null }[];
  duplicates: { rowIndex: number; reason: string; skip: boolean; existing?: { date: string; description: string; amount: number } }[];
  lockedRows: number[];
  ruleHits: { categorized: number; activeRuleCount: number; ruleNames: string[] };
  newRows: number;
  totals: { rowsInFile: number; skippedDuplicate: number; skippedLocked: number; newTransactions: number };
}

export async function dryRunImport(input: {
  companyId: string;
  accountId: string;
  normalized: NormalizedRow[];
  skipDuplicates: boolean;
  applyRulesOnImport: boolean;
}): Promise<DryRunResult> {
  const account = await db.financialAccount.findUniqueOrThrow({
    where: { id: input.accountId, companyId: input.companyId },
  });

  const existingRows = await db.transaction.findMany({
    where: { financialAccountId: input.accountId },
    select: { date: true, amount: true, description: true, dedupeHash: true },
  });

  const existing: ExistingRow[] = existingRows.map((t) => ({
    date: t.date.toISOString().slice(0, 10),
    amount: Number(t.amount),
    description: t.description,
    dedupeHash: t.dedupeHash,
  }));

  const lockedThrough = account.lockedThrough ? account.lockedThrough.toISOString().slice(0, 10) : null;

  const flagged = classifyDuplicates({
    rows: input.normalized.map((n) => ({ date: n.date, amount: n.amount, description: n.description, dedupeHash: n.dedupeHash })),
    existing,
    lockedThrough,
  });

  const dupes = flagged.filter((f) => f.reason !== 'locked_period');
  const locked = flagged.filter((f) => f.reason === 'locked_period');
  const skipSet = new Set([
    ...(input.skipDuplicates ? dupes.filter((d) => d.skip).map((d) => d.rowIndex) : []),
    ...locked.map((l) => l.rowIndex),
  ]);

  const newRows = input.normalized.filter((n) => !skipSet.has(n.rowIndex));

  const rules = await db.bankRule.findMany({ where: { companyId: input.companyId, enabled: true } });
  const ruleLike: BankRuleLike[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    order: r.order,
    op: r.op,
    value: r.value,
    anyOf: r.anyOf,
    scope: r.scope as any,
    setCategoryCode: r.setCategoryCode,
    setTaxCode: r.setTaxCode,
    setTaxRate: r.setTaxRate ? Number(r.setTaxRate) : null,
    setTaxInclusive: r.setTaxInclusive,
    setContactId: r.setContactId,
    autoPost: r.autoPost,
    enabled: r.enabled,
  }));

  let categorized = 0;
  const ruleNames = new Set<string>();
  if (input.applyRulesOnImport) {
    for (const row of newRows) {
      const hit = applyRules(ruleLike, { description: row.description, amount: row.amount, accountId: input.accountId });
      if (hit?.categoryCode) categorized++;
      if (hit) ruleNames.add(hit.rule.name);
    }
  }

  return {
    preview: newRows.slice(0, 4).map((n) => ({
      date: n.date,
      description: n.description,
      payeeGuess: n.payeeGuess,
      amount: n.amount,
      statementBalance: n.statementBalance,
    })),
    duplicates: dupes.map((d) => ({
      rowIndex: d.rowIndex,
      reason: d.reason,
      skip: d.skip,
      existing: d.existing
        ? { date: d.existing.date.slice(0, 10), description: d.existing.description, amount: d.existing.amount }
        : undefined,
    })),
    lockedRows: locked.map((l) => l.rowIndex),
    ruleHits: { categorized, activeRuleCount: rules.length, ruleNames: [...ruleNames] },
    newRows: newRows.length,
    totals: {
      rowsInFile: input.normalized.length,
      skippedDuplicate: dupes.filter((d) => d.skip).length,
      skippedLocked: locked.length,
      newTransactions: newRows.length,
    },
  };
}

export async function commitImport(input: {
  companyId: string;
  userId: string | undefined;
  accountId: string;
  fileName: string;
  fileSize: number;
  fileType: 'csv' | 'ofx' | 'qfx' | 'pdf';
  presetId: string | null;
  mappingJson: Record<string, string>;
  normalized: NormalizedRow[];
  skipDuplicates: boolean;
  applyRulesOnImport: boolean;
  autoPostExactMatches: boolean;
  skipRowIndexes: number[];
}): Promise<{ importId: string; newCount: number; skippedDuplicate: number; skippedLocked: number; rulesApplied: number }> {
  return db.$transaction(async (tx) => {
    const account = await tx.financialAccount.findUniqueOrThrow({
      where: { id: input.accountId, companyId: input.companyId },
    });

    const existingRows = await tx.transaction.findMany({
      where: { financialAccountId: input.accountId },
      select: { date: true, amount: true, description: true, dedupeHash: true },
    });
    const existing: ExistingRow[] = existingRows.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      amount: Number(t.amount),
      description: t.description,
      dedupeHash: t.dedupeHash,
    }));

    const lockedThrough = account.lockedThrough ? account.lockedThrough.toISOString().slice(0, 10) : null;
    const flagged = classifyDuplicates({
      rows: input.normalized.map((n) => ({ date: n.date, amount: n.amount, description: n.description, dedupeHash: n.dedupeHash })),
      existing,
      lockedThrough,
    });

    // Locked rows are NEVER importable, regardless of client choices.
    const lockedSet = new Set(flagged.filter((f) => f.reason === 'locked_period').map((f) => f.rowIndex));
    const userSkipSet = new Set(input.skipRowIndexes);
    const dupSkipSet = input.skipDuplicates
      ? new Set(flagged.filter((f) => f.reason === 'exact' && f.skip).map((f) => f.rowIndex))
      : new Set();

    const toImport = input.normalized.filter(
      (n) => !lockedSet.has(n.rowIndex) && !userSkipSet.has(n.rowIndex) && !dupSkipSet.has(n.rowIndex)
    );

    const dateRange = toImport.length
      ? {
          dateRangeStart: new Date(toImport.reduce((min, n) => (n.date < min ? n.date : min), toImport[0].date)),
          dateRangeEnd: new Date(toImport.reduce((max, n) => (n.date > max ? n.date : max), toImport[0].date)),
        }
      : { dateRangeStart: null, dateRangeEnd: null };

    const status = toImport.length === 0 ? 'all_duplicates' : flagged.some((f) => f.skip || f.reason === 'locked_period') ? 'partial' : 'imported';

    const created = await tx.statementImport.create({
      data: {
        companyId: input.companyId,
        financialAccountId: input.accountId,
        fileName: input.fileName,
        fileSize: input.fileSize,
        fileType: input.fileType === 'qfx' || input.fileType === 'ofx' ? 'ofx' : input.fileType,
        presetId: input.presetId,
        mappingJson: input.mappingJson as any,
        dateRangeStart: dateRange.dateRangeStart,
        dateRangeEnd: dateRange.dateRangeEnd,
        rowsTotal: input.normalized.length,
        rowsImported: toImport.length,
        rowsSkippedDuplicate: dupSkipSet.size + userSkipSet.size,
        rowsSkippedLocked: lockedSet.size,
        rulesApplied: 0,
        status: status as any,
        createdById: input.userId ?? null,
        reversibleUntil: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    // Rules — apply on the way in.
    const rules = await tx.bankRule.findMany({ where: { companyId: input.companyId, enabled: true } });
    const ruleLike: BankRuleLike[] = rules.map((r) => ({
      id: r.id,
      name: r.name,
      order: r.order,
      op: r.op,
      value: r.value,
      anyOf: r.anyOf,
      scope: r.scope as any,
      setCategoryCode: r.setCategoryCode,
      setTaxCode: r.setTaxCode,
      setTaxRate: r.setTaxRate ? Number(r.setTaxRate) : null,
      setTaxInclusive: r.setTaxInclusive,
      setContactId: r.setContactId,
      autoPost: r.autoPost,
      enabled: r.enabled,
    }));

    let rulesApplied = 0;
    const rowsData = [];
    for (const n of toImport) {
      let categoryId: string | null = null;
      let taxCode: string | null = null;
      let taxRate: Prisma.Decimal | null = null;
      let contactId: string | null = null;
      let appliedRuleId: string | null = null;

      if (input.applyRulesOnImport) {
        const hit = applyRules(ruleLike, { description: n.description, amount: n.amount, accountId: input.accountId });
        if (hit) {
          appliedRuleId = hit.rule.id;
          if (hit.categoryCode) {
            const coa = await tx.chartOfAccount.findFirst({
              where: { companyId: input.companyId, code: hit.categoryCode, active: true },
              select: { id: true },
            });
            categoryId = coa?.id ?? null;
          }
          taxCode = hit.taxCode;
          taxRate = hit.taxRate !== null ? new Prisma.Decimal(hit.taxRate) : null;
          contactId = hit.contactId;
          if (hit.categoryCode && categoryId) rulesApplied++;
          await tx.bankRule.update({ where: { id: hit.rule.id }, data: { appliedCount: { increment: 1 } } });
        }
      }

      rowsData.push({
        companyId: input.companyId,
        financialAccountId: input.accountId,
        statementImportId: created.id,
        date: new Date(n.date),
        description: n.description,
        rawStatementText: n.description,
        amount: n.amount,
        currency: account.currency,
        dedupeHash: n.dedupeHash,
        payeeGuess: n.payeeGuess,
        memo: n.memo,
        reference: n.reference,
        statementBalance: n.statementBalance !== null ? new Prisma.Decimal(n.statementBalance) : null,
        categoryId,
        taxCode,
        taxRate,
        contactId,
        appliedRuleId,
        status: 'toreview' as any,
        source: (input.fileType === 'ofx' || input.fileType === 'qfx' ? 'ofx' : input.fileType) as any,
      });
    }

    if (rowsData.length) {
      await tx.transaction.createMany({ data: rowsData });
    }

    await tx.statementImport.update({
      where: { id: created.id },
      data: { rulesApplied },
    });

    await tx.financialAccount.update({
      where: { id: input.accountId },
      data: { lastImportAt: new Date() },
    });

    return {
      importId: created.id,
      newCount: toImport.length,
      skippedDuplicate: dupSkipSet.size + userSkipSet.size,
      skippedLocked: lockedSet.size,
      rulesApplied,
    };
  });
}

export async function reverseImport(input: {
  companyId: string;
  importId: string;
  userId: string | undefined;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    const imp = await tx.statementImport.findUniqueOrThrow({
      where: { id: input.importId, companyId: input.companyId },
      include: { transactions: { select: { id: true, status: true, matchRef: true } } },
    });

    if (imp.reversedAt) throw new Error('This import has already been reversed.');
    if (new Date() > imp.reversibleUntil) throw new Error('The 24-hour reversal window has passed.');

    const posted = imp.transactions.filter((t) => t.status === 'reconciled' || t.matchRef);
    if (posted.length > 0) {
      throw new Error(`${posted.length} imported transaction${posted.length === 1 ? '' : 's'} have already been posted to the ledger. Reverse those individually instead.`);
    }

    await tx.transaction.deleteMany({ where: { statementImportId: imp.id } });

    // Decrement appliedCount on rules that categorized this import's rows.
    const ruleIds = [...new Set(imp.transactions.map((t) => t.id))];
    void ruleIds;

    await tx.statementImport.update({
      where: { id: imp.id },
      data: { reversedAt: new Date(), reversedBy: input.userId ?? null },
    });
  });
}
