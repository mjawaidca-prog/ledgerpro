/**
 * CCA write-back — server side (design §3.4, Phase 3 item 5).
 *
 * Import, versioning, the Fixed Assets status/variance assembly,
 * and the approval-gated posting of the proposed Schedule 1
 * journal. The pure contract half is src/lib/cca-writeback.ts;
 * the contract document is src/lib/cca-writeback.CONTRACT.md.
 *
 * Standing rules enforced here:
 *  - A payload is imported only when its hash verifies AND its
 *    company id, business number and fiscal year all match the
 *    importing company (validateWritebackForCompany).
 *  - A second import for the same year VERSIONS: the old record
 *    is kept, the new one becomes the latest, and every effect
 *    (export sourcing, variance, journal) flows from the latest.
 *    Re-importing the identical file is refused as a duplicate.
 *  - The Sch 1 journal is a PROPOSAL stored on the record at
 *    import. It posts only through postCcaWritebackJournal — a
 *    preparer's explicit approval — and never into a closed
 *    period. If a newer version arrives while a proposal is still
 *    unposted, the stale proposal is marked superseded so it can
 *    never be posted by mistake.
 */

import { Prisma, type CcaWriteback, type Company } from '@prisma/client';
import { db } from '@/lib/db';
import { postJournalEntry } from '@/lib/journal';
import { fiscalYearRangeContaining, type FiscalYearRange } from '@/lib/fiscal-year';
import { fiscalContextOf } from '@/lib/loans/present';
import { toDollars } from '@/lib/loans/engine';
import { dateToYmd, ymdToDate } from '@/lib/loans/server';
import { formatContractBn } from '@/lib/tb-gifi';
import {
  buildSch1JournalLines,
  closingUccByClassFromPayload,
  computeClassVariance,
  parseCcaWritebackPayload,
  planWritebackImport,
  sch1ExpenseAccountCode,
  totalCcaClaimedCents,
  validateWritebackForCompany,
  WRITEBACK_ACCUM_ACCOUNT_CODE,
  WRITEBACK_AMORT_EXPENSE_CODE,
  type ClassVariance,
  type ProposedJournalLine,
} from '@/lib/cca-writeback';
import { ccaClassInfo } from './classes';
import { depreciationForYearCents } from './engine';
import {
  assetToFacts,
  ensureAccumulatedDepreciationAccount,
  ensureDepreciationExpenseAccount,
  fiscalYearsThrough,
  type FixedAssetWithDisposal,
} from './server';

type Tx = Prisma.TransactionClient;

export function writebackJournalSourceId(recordId: string): string {
  return `cca-writeback:${recordId}`;
}

// ─── Import ───

export interface ImportWritebackResult {
  recordId: string;
  fiscalYear: FiscalYearRange;
  versioned: boolean;
  journalStatus: string;
  totalCcaClaimedCents: number;
}

async function loadCompany(companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { fiscalYearStart: true, firstFiscalYearEnd: true, businessNumber: true },
  });
  if (!company) throw new Error('Company not found');
  return company;
}

export async function importCcaWriteback(
  companyId: string,
  userId: string | undefined,
  rawPayload: unknown
): Promise<ImportWritebackResult> {
  const parsed = parseCcaWritebackPayload(rawPayload);
  const company = await loadCompany(companyId);
  const ctx = fiscalContextOf(company);
  const fiscalYear = fiscalYearRangeContaining(ctx.anchor, parsed.fiscalYearEnd, ctx.firstYear);
  validateWritebackForCompany(parsed, {
    companyId,
    contractBn: formatContractBn(company.businessNumber),
    fiscalYear: { start: fiscalYear.start, end: fiscalYear.end },
  });

  const fyStart = ymdToDate(fiscalYear.start);
  const fyEnd = ymdToDate(fiscalYear.end);
  const existingLatest = await db.ccaWriteback.findFirst({
    where: { companyId, fiscalYearStart: fyStart, fiscalYearEnd: fyEnd, isLatest: true },
    select: { id: true, hash: true },
  });
  const plan = planWritebackImport(existingLatest?.hash ?? null, parsed.hash);
  if (plan === 'duplicate') {
    throw new Error(
      `This exact write-back file is already on file for ${fiscalYear.label} (same hash) — re-importing it would add a version that changes nothing.`
    );
  }

  // The proposed Sch 1 journal is built NOW, from the payload's
  // own lines, and stored on the record. It is a proposal: posting
  // is a separate, explicit approval (postCcaWritebackJournal).
  const expenseCode = sch1ExpenseAccountCode(parsed.classes);
  const proposedLines = buildSch1JournalLines(parsed.schedule1Adjustments, {
    expenseCode,
    accumCode: WRITEBACK_ACCUM_ACCOUNT_CODE,
  });
  const journalStatus = proposedLines.length > 0 ? 'proposed' : 'none';

  const record = await db.$transaction(async (tx) => {
    if (existingLatest) {
      await tx.ccaWriteback.update({
        where: { id: existingLatest.id },
        data: { isLatest: false },
      });
      // A still-unposted proposal on the superseded record must
      // never be postable — its numbers are no longer the latest
      // filed position.
      await tx.ccaWriteback.updateMany({
        where: { id: existingLatest.id, journalStatus: 'proposed' },
        data: { journalStatus: 'superseded' },
      });
    }
    return tx.ccaWriteback.create({
      data: {
        companyId,
        contractVersion: 'cca-writeback/1',
        businessNumber: parsed.businessNumber,
        fiscalYearStart: fyStart,
        fiscalYearEnd: fyEnd,
        returnId: parsed.source.returnId,
        filedAt: new Date(parsed.source.filedAt),
        confirmationNumber: parsed.source.confirmationNumber,
        payload: parsed.raw as Prisma.InputJsonValue,
        hash: parsed.hash,
        isLatest: true,
        journalStatus,
        proposedLines: proposedLines as unknown as Prisma.InputJsonValue,
        importedBy: userId,
      },
    });
  });

  return {
    recordId: record.id,
    fiscalYear,
    versioned: plan === 'create_version',
    journalStatus,
    totalCcaClaimedCents: totalCcaClaimedCents(parsed),
  };
}

// ─── Status + variance ───

export interface WritebackRecordSummary {
  id: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  fiscalYearLabel: string;
  returnId: string;
  filedAt: string;
  confirmationNumber: string | null;
  isLatest: boolean;
  journalStatus: string;
  journalEntryId: string | null;
  totalCcaClaimed: number | null; // dollars
  importedAt: string;
}

export interface WritebackStatus {
  records: WritebackRecordSummary[];
  latest: {
    record: WritebackRecordSummary;
    classes: { ccaClass: string; label: string; ccaClaimed: number; closingUcc: number }[];
    variance: (ClassVariance & {
      filedClaim: number;
      filedClosingUcc: number;
      projectedClaim: number | null;
      expectedClosingUcc: number | null;
      difference: number | null;
    })[];
    journal: {
      status: string;
      lines: ProposedJournalLine[];
      entryId: string | null;
      /** Set when the proposal cannot post (e.g. the year end falls in a closed period). */
      blockedReason: string | null;
      /** True when the payload carried no Sch 1 lines — stated plainly in the UI. */
      noSchedule1Lines: boolean;
    };
  } | null;
}

function summarize(
  company: Pick<Company, 'fiscalYearStart' | 'firstFiscalYearEnd'>,
  record: CcaWriteback
): WritebackRecordSummary {
  const ctx = fiscalContextOf(company);
  const fy = fiscalYearRangeContaining(ctx.anchor, dateToYmd(record.fiscalYearEnd), ctx.firstYear);
  const parsed = (() => {
    try {
      return parseCcaWritebackPayload(record.payload);
    } catch {
      return null;
    }
  })();
  return {
    id: record.id,
    fiscalYearStart: dateToYmd(record.fiscalYearStart),
    fiscalYearEnd: dateToYmd(record.fiscalYearEnd),
    fiscalYearLabel: fy.label,
    returnId: record.returnId,
    filedAt: record.filedAt.toISOString(),
    confirmationNumber: record.confirmationNumber,
    isLatest: record.isLatest,
    journalStatus: record.journalStatus,
    journalEntryId: record.journalEntryId,
    totalCcaClaimed: parsed ? toDollars(totalCcaClaimedCents(parsed)) : null,
    importedAt: record.createdAt.toISOString(),
  };
}

function storedProposedLines(record: CcaWriteback): ProposedJournalLine[] {
  if (!Array.isArray(record.proposedLines)) return [];
  return (record.proposedLines as unknown as ProposedJournalLine[]).filter(
    (l) =>
      l &&
      typeof l.glAccountCode === 'string' &&
      typeof l.description === 'string' &&
      typeof l.debit === 'number' &&
      typeof l.credit === 'number'
  );
}

async function closedPeriodReason(companyId: string, fyEndYmd: string): Promise<string | null> {
  const date = ymdToDate(fyEndYmd);
  const closed = await db.periodClose.findFirst({
    where: { companyId, status: 'closed', periodStart: { lte: date }, periodEnd: { gte: date } },
  });
  if (!closed) return null;
  return `The journal date (${fyEndYmd}) falls within a closed period (${dateToYmd(closed.periodStart)} — ${dateToYmd(closed.periodEnd)}). Reopen that period to post it.`;
}

export async function getCcaWritebackStatus(companyId: string): Promise<WritebackStatus> {
  const company = await loadCompany(companyId);
  const records = await db.ccaWriteback.findMany({
    where: { companyId },
    orderBy: [{ fiscalYearEnd: 'desc' }, { createdAt: 'desc' }],
  });
  const summaries = records.map((r) => summarize(company, r));
  const latestRecord = records.find((r) => r.isLatest);
  if (!latestRecord) return { records: summaries, latest: null };

  const ctx = fiscalContextOf(company);
  const fyStart = dateToYmd(latestRecord.fiscalYearStart);
  const fyEnd = dateToYmd(latestRecord.fiscalYearEnd);
  const target = fiscalYearRangeContaining(ctx.anchor, fyEnd, ctx.firstYear);
  const parsed = parseCcaWritebackPayload(latestRecord.payload);

  // Prior filed year: the latest record whose year ends the day
  // before this year starts. Its closing UCC by class is this
  // year's filed opening — the variance baseline.
  const priorEnd = (() => {
    const d = ymdToDate(fyStart);
    d.setUTCDate(d.getUTCDate() - 1);
    return dateToYmd(d);
  })();
  const priorRecord = records.find((r) => r.isLatest && dateToYmd(r.fiscalYearEnd) === priorEnd);
  const openingByClass = priorRecord
    ? closingUccByClassFromPayload(priorRecord.payload)
    : new Map<string, number>();

  // Register facts for the filed year.
  const assets: FixedAssetWithDisposal[] = await db.fixedAsset.findMany({
    where: { companyId },
    include: { disposal: true },
    orderBy: { availableForUseDate: 'asc' },
  });
  const earliest = assets.length > 0 ? assets.map((a) => dateToYmd(a.availableForUseDate)).sort()[0] : target.start;
  const years = fiscalYearsThrough(ctx, earliest, target.end);
  const facts = assets.map((a) => ({ asset: a, facts: assetToFacts(a) }));
  const importedAt = latestRecord.createdAt.getTime();

  const variance = parsed.classes.map((line) => {
    const inClass = facts.filter((f) => f.asset.ccaClass === line.ccaClass);
    const additions = inClass
      .filter((f) => f.facts.availableForUseDate >= target.start && f.facts.availableForUseDate <= target.end)
      .map((f) => ({
        costCents: f.facts.capitalCostCents,
        aiip: f.facts.aiip,
        availableForUseDate: f.facts.availableForUseDate,
      }));
    const disposals = inClass
      .filter((f) => f.facts.disposal && f.facts.disposal.date >= target.start && f.facts.disposal.date <= target.end)
      .map((f) => ({
        proceedsCents: f.facts.disposal!.proceedsCents,
        capitalCostCents: f.facts.capitalCostCents,
      }));
    const slProjectedClaimCents = inClass.reduce(
      (s, f) => s + depreciationForYearCents(f.facts, years, target.label),
      0
    );
    const factsChangedAfterFiling = inClass.some((f) => {
      const inYear =
        (f.facts.availableForUseDate >= target.start && f.facts.availableForUseDate <= target.end) ||
        (f.facts.disposal && f.facts.disposal.date >= target.start && f.facts.disposal.date <= target.end);
      if (!inYear) return false;
      return (
        f.asset.createdAt.getTime() > importedAt ||
        f.asset.updatedAt.getTime() > importedAt ||
        (f.asset.disposal != null && f.asset.disposal.createdAt.getTime() > importedAt)
      );
    });
    const openingUccCents = openingByClass.get(line.ccaClass);
    const v = computeClassVariance({
      ccaClass: line.ccaClass,
      filedClaimCents: line.ccaClaimedCents,
      filedClosingUccCents: line.closingUccCents,
      projectionFacts:
        openingUccCents != null
          ? {
              ccaClass: line.ccaClass,
              openingUccCents,
              additions,
              disposals,
              slProjectedClaimCents,
            }
          : null,
      factsChangedAfterFiling,
    });
    return {
      ...v,
      filedClaim: toDollars(v.filedClaimCents),
      filedClosingUcc: toDollars(v.filedClosingUccCents),
      projectedClaim: v.projectedClaimCents != null ? toDollars(v.projectedClaimCents) : null,
      expectedClosingUcc: v.expectedClosingUccCents != null ? toDollars(v.expectedClosingUccCents) : null,
      difference: v.differenceCents != null ? toDollars(v.differenceCents) : null,
    };
  });

  const lines = storedProposedLines(latestRecord);
  const blockedReason =
    latestRecord.journalStatus === 'proposed' ? await closedPeriodReason(companyId, fyEnd) : null;

  return {
    records: summaries,
    latest: {
      record: summarize(company, latestRecord),
      classes: parsed.classes.map((c) => ({
        ccaClass: c.ccaClass,
        label: ccaClassInfo(c.ccaClass)?.label ?? `Class ${c.ccaClass}`,
        ccaClaimed: toDollars(c.ccaClaimedCents),
        closingUcc: toDollars(c.closingUccCents),
      })),
      variance,
      journal: {
        status: latestRecord.journalStatus,
        lines,
        entryId: latestRecord.journalEntryId,
        blockedReason,
        noSchedule1Lines: parsed.schedule1Adjustments.length === 0,
      },
    },
  };
}

// ─── Approval posting ───

export interface PostWritebackJournalResult {
  journalEntryId: string;
  fiscalYear: FiscalYearRange;
  totalCents: number;
}

/**
 * Approve and post the proposed Sch 1 journal for one write-back
 * record. This is the ONLY path from a write-back to the ledger,
 * and it runs only on a preparer's explicit approval (the route).
 * Refusals: superseded record, already posted, no Sch 1 lines, or
 * a journal date inside a closed period.
 */
export async function postCcaWritebackJournal(
  companyId: string,
  userId: string | undefined,
  recordId: string
): Promise<PostWritebackJournalResult> {
  const record = await db.ccaWriteback.findFirst({ where: { id: recordId, companyId } });
  if (!record) throw new Error('Write-back record not found');
  if (!record.isLatest || record.journalStatus === 'superseded') {
    throw new Error(
      'This write-back has been superseded by a newer filing for the same year — its proposed journal can no longer be posted. Review the latest version instead.'
    );
  }
  if (record.journalStatus === 'posted') {
    throw new Error(
      `The Schedule 1 journal for this write-back is already posted (journal ${record.journalEntryId}). Correct it with a manual journal if needed.`
    );
  }
  if (record.journalStatus !== 'proposed') {
    throw new Error('This write-back carries no Schedule 1 adjustment lines, so there is no journal to post.');
  }
  const lines = storedProposedLines(record);
  if (lines.length === 0) {
    throw new Error('This write-back carries no Schedule 1 adjustment lines, so there is no journal to post.');
  }

  const company = await loadCompany(companyId);
  const ctx = fiscalContextOf(company);
  const fyEnd = dateToYmd(record.fiscalYearEnd);
  const fiscalYear = fiscalYearRangeContaining(ctx.anchor, fyEnd, ctx.firstYear);
  const sourceId = writebackJournalSourceId(record.id);

  const existing = await db.journalEntry.findFirst({
    where: { companyId, sourceType: 'cca_writeback', sourceId },
    select: { id: true },
  });
  if (existing) {
    await db.ccaWriteback.update({
      where: { id: record.id },
      data: { journalStatus: 'posted', journalEntryId: existing.id },
    });
    throw new Error(
      `The Schedule 1 journal for this write-back is already posted (journal ${existing.id}). Correct it with a manual journal if needed.`
    );
  }

  const blocked = await closedPeriodReason(companyId, fyEnd);
  if (blocked) throw new Error(blocked);

  const totalCents = Math.round(
    lines.reduce((s, l) => s + l.debit, 0) * 100
  );

  const entry = await db.$transaction(async (tx: Tx) => {
    // Get-or-create the register's accounts the proposal runs
    // through, inside the same transaction as the posting.
    await ensureAccumulatedDepreciationAccount(tx, companyId);
    const expenseCodes = [...new Set(lines.map((l) => l.glAccountCode))].filter(
      (c) => c !== WRITEBACK_ACCUM_ACCOUNT_CODE
    );
    for (const code of expenseCodes) {
      await ensureDepreciationExpenseAccount(tx, companyId, code === WRITEBACK_AMORT_EXPENSE_CODE);
    }
    const posted = await postJournalEntry(
      {
        entryDate: ymdToDate(fyEnd),
        description: `Schedule 1 CCA adjustments — ${fiscalYear.label} (Nexvar Tax write-back, return ${record.returnId})`,
        sourceType: 'cca_writeback',
        sourceId,
        createdBy: userId,
        lines,
      },
      companyId,
      tx
    );
    await tx.ccaWriteback.update({
      where: { id: record.id },
      data: { journalStatus: 'posted', journalEntryId: posted.id },
    });
    return posted;
  });

  return { journalEntryId: entry.id, fiscalYear, totalCents };
}
