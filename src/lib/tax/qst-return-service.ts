/**
 * Phase 1 cleanup — QST return (simple path) service: loads the GL lines
 * the pure computation needs, resolves the filing period, and records
 * filing through the existing TaxReturnWorkpaper model (regime 'qst')
 * so this report and Tax Workpapers can never disagree about what was
 * filed. Mirrors gst-return-service.ts; the filing authority here is
 * Revenu Québec (combined GST/HST–QST return FPZ-500-V, detailed lines
 * on FP-500-V) — LedgerPro records the filing, it never submits it.
 */
import { db } from '@/lib/db';
import { computeQstReturn, type QstJournalLine, type QstReturnResult } from './qst-return';
import { loadSimpleTaxAccounts } from './accounts';
import { anchorMonthDay, fiscalYearRangeContaining, toYmd } from '@/lib/fiscal-year';
import { TaxPostingError } from './posting-service';

const day = (d: Date): string => d.toISOString().slice(0, 10);

export interface QstReturnView {
  periodStart: string;
  periodEnd: string;
  result: QstReturnResult;
  accounts: { output: string; recoverable: string };
  registration: { id: string; registrationNumber: string; filingFrequency: string; province: string | null } | null;
  filed: { id: string; filedAt: string; filingConfirmation: string | null; status: string } | null;
  /** Other filed periods overlapping the requested one (period-lock warning). */
  overlappingFiled: { periodStart: string; periodEnd: string }[];
  notes: string[];
}

async function activeQstRegistration(companyId: string) {
  return db.companyTaxRegistration.findFirst({
    where: { companyId, regime: 'qst', active: true },
    orderBy: { validFrom: 'desc' },
    select: { id: true, registrationNumber: true, filingFrequency: true, province: true, validFrom: true },
  });
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return day(d);
}

/** The filing period (registration frequency, else fiscal year) containing `dateStr`. */
async function periodContaining(companyId: string, dateStr: string): Promise<{ start: string; end: string }> {
  const date = new Date(dateStr + 'T00:00:00Z');
  const registration = await activeQstRegistration(companyId);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (registration) {
    const anchor = registration.validFrom;
    const am = anchor.getUTCMonth() + 1;
    const ad = anchor.getUTCDate();
    if (registration.filingFrequency === 'monthly') {
      return { start: toYmd(y, m, 1), end: toYmd(y, m + 1, 0) };
    }
    if (registration.filingFrequency === 'quarterly') {
      const offset = ((m - am) % 3 + 3) % 3;
      const qStartMonth = m - offset;
      const start = toYmd(y, qStartMonth, 1);
      const end = toYmd(y, qStartMonth + 3, 0);
      return { start, end };
    }
    if (registration.filingFrequency === 'annual') {
      const startThisYear = toYmd(y, am, ad);
      const start = dateStr >= startThisYear ? startThisYear : toYmd(y - 1, am, ad);
      const startDate = new Date(start + 'T00:00:00Z');
      startDate.setUTCFullYear(startDate.getUTCFullYear() + 1);
      const end = addDays(day(startDate), -1);
      return { start, end };
    }
  }
  const company = await db.company.findUnique({ where: { id: companyId }, select: { fiscalYearStart: true } });
  const anchor = anchorMonthDay(company?.fiscalYearStart ?? new Date(Date.UTC(y, 0, 1)));
  const range = fiscalYearRangeContaining(anchor, dateStr);
  return { start: range.start, end: range.end };
}

export async function defaultQstPeriod(companyId: string, today = new Date()): Promise<{ start: string; end: string }> {
  const candidate = await periodContaining(companyId, day(today));
  // Activity-aware default, same rule as the GST/HST return: if the
  // latest QST-account activity predates the current (empty) period,
  // default to the period containing that activity.
  const accounts = await loadSimpleTaxAccounts(companyId);
  const codes = [accounts.qstOutput, accounts.qstRecoverable].filter(Boolean);
  if (codes.length > 0) {
    const latest = await db.journalEntry.findFirst({
      where: { companyId, lines: { some: { glAccountCode: { in: codes } } } },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      select: { entryDate: true },
    });
    if (latest) {
      const latestDay = day(latest.entryDate);
      if (latestDay < candidate.start) {
        return periodContaining(companyId, latestDay);
      }
    }
  }
  return candidate;
}

export async function computeQstReturnView(companyId: string, periodStart: string, periodEnd: string): Promise<QstReturnView> {
  if (periodStart > periodEnd) throw new TaxPostingError('invalid_period', 'Period start must not be after period end.');
  const accounts = await loadSimpleTaxAccounts(companyId);
  const qstAccounts = { output: accounts.qstOutput, recoverable: accounts.qstRecoverable };
  const registration = await activeQstRegistration(companyId);

  const start = new Date(periodStart + 'T00:00:00Z');
  const endExclusive = new Date(periodEnd + 'T00:00:00Z');
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const incomeAccounts = await db.chartOfAccount.findMany({
    where: { companyId, type: 'income' },
    select: { code: true },
  });
  const codes = [...new Set([...incomeAccounts.map((a) => a.code), qstAccounts.output, qstAccounts.recoverable])];

  const entries = await db.journalEntry.findMany({
    where: { companyId, entryDate: { gte: start, lt: endExclusive }, lines: { some: { glAccountCode: { in: codes } } } },
    include: { lines: { where: { glAccountCode: { in: codes } } } },
    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
  });
  const typeByCode = new Map<string, string>();
  const allAccounts = await db.chartOfAccount.findMany({ where: { companyId, code: { in: codes } }, select: { code: true, type: true } });
  allAccounts.forEach((a) => typeByCode.set(a.code, a.type));

  const lines: QstJournalLine[] = entries.flatMap((e) =>
    e.lines.map((l) => ({
      id: l.id,
      entryId: e.id,
      date: day(e.entryDate),
      accountCode: l.glAccountCode,
      accountType: l.glAccountCode === qstAccounts.output || l.glAccountCode === qstAccounts.recoverable ? 'liability' : (typeByCode.get(l.glAccountCode) ?? ''),
      description: l.description ?? e.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  );
  const incomeCodes = new Set(incomeAccounts.map((a) => a.code));
  const typedLines = lines.map((l) => ({ ...l, accountType: incomeCodes.has(l.accountCode) ? 'income' : l.accountType }));

  const result = computeQstReturn({ lines: typedLines, outputAccountCode: qstAccounts.output, recoverableAccountCode: qstAccounts.recoverable });

  const workpapers = registration
    ? await db.taxReturnWorkpaper.findMany({
        where: { companyId, registrationId: registration.id, regime: 'qst' },
        select: { id: true, periodStart: true, periodEnd: true, status: true, filedAt: true, filingConfirmation: true },
        orderBy: { version: 'desc' },
      })
    : [];
  const exact = workpapers.find(
    (w) => day(w.periodStart) === periodStart && day(w.periodEnd) === periodEnd && w.status === 'filed_recorded',
  );
  const overlappingFiled = workpapers
    .filter((w) => w.status === 'filed_recorded' && !(day(w.periodStart) === periodStart && day(w.periodEnd) === periodEnd))
    .filter((w) => day(w.periodStart) <= periodEnd && day(w.periodEnd) >= periodStart)
    .map((w) => ({ periodStart: day(w.periodStart), periodEnd: day(w.periodEnd) }));

  const notes: string[] = [];
  if (!registration) notes.push('No QST registration on file for this company. The return still computes from the ledger; add a registration (Settings → Tax or the mark-as-filed flow) to record filings.');
  notes.push('Lines 204/207 adjustments, 210 instalments and 211 rebates are $0 in this view — record them through Tax Workpapers with supporting evidence.');
  notes.push('Part 2 amounts (line 214 — QST on taxable immovables / emission allowances, and line 216) are not computed in this simple-path view.');

  return {
    periodStart,
    periodEnd,
    result,
    accounts: qstAccounts,
    registration: registration
      ? { id: registration.id, registrationNumber: registration.registrationNumber, filingFrequency: registration.filingFrequency, province: registration.province }
      : null,
    filed: exact ? { id: exact.id, filedAt: exact.filedAt ? exact.filedAt.toISOString() : '', filingConfirmation: exact.filingConfirmation, status: exact.status } : null,
    overlappingFiled,
    notes,
  };
}

/**
 * Mark a period as filed: stores the computed working copy in a
 * TaxReturnWorkpaper (regime 'qst') advanced straight to filed_recorded
 * with the user's external Revenu Québec confirmation reference.
 * LedgerPro records filing, it never submits to Revenu Québec.
 */
export async function markQstReturnFiled(input: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  confirmation: string;
  registrationId?: string;
  createRegistration?: { registrationNumber: string; filingFrequency: 'monthly' | 'quarterly' | 'annual' };
}): Promise<{ workpaperId: string }> {
  const confirmation = input.confirmation?.trim();
  if (!confirmation || confirmation.length > 200) {
    throw new TaxPostingError('filing_not_allowed', 'Provide the external Revenu Québec filing confirmation reference (max 200 characters).');
  }
  let registration = input.registrationId
    ? await db.companyTaxRegistration.findFirst({ where: { id: input.registrationId, companyId: input.companyId, regime: 'qst' } })
    : await activeQstRegistration(input.companyId);

  if (!registration) {
    if (!input.createRegistration?.registrationNumber) {
      throw new TaxPostingError('registration_not_found', 'A QST registration is required to record a filing. Provide the registration (TQ) number and filing frequency.', 409);
    }
    registration = await db.companyTaxRegistration.create({
      data: {
        companyId: input.companyId,
        regime: 'qst',
        registrationNumber: input.createRegistration.registrationNumber.trim(),
        province: 'QC' as never,
        method: 'regular',
        filingFrequency: input.createRegistration.filingFrequency,
        validFrom: new Date(input.periodStart + 'T00:00:00Z'),
        active: true,
        reviewedById: input.userId,
        reviewedAt: new Date(),
      },
    });
  }

  const view = await computeQstReturnView(input.companyId, input.periodStart, input.periodEnd);
  if (view.filed) throw new TaxPostingError('already_filed', 'This period is already recorded as filed.', 409);

  const start = new Date(input.periodStart + 'T00:00:00Z');
  const end = new Date(input.periodEnd + 'T00:00:00Z');
  const latest = await db.taxReturnWorkpaper.findFirst({
    where: { companyId: input.companyId, registrationId: registration.id, periodStart: start, periodEnd: end },
    orderBy: { version: 'desc' },
  });
  const { createHash } = await import('node:crypto');
  const sourceHash = createHash('sha256').update(JSON.stringify(view.result)).digest('hex');
  const workpaper = await db.taxReturnWorkpaper.create({
    data: {
      companyId: input.companyId,
      registrationId: registration.id,
      regime: 'qst',
      periodStart: start,
      periodEnd: end,
      version: (latest?.version ?? 0) + 1,
      status: 'filed_recorded',
      inputs: { classifications: [], periodEvidence: 'Filed from the QST Return report (simple path, GL-based).', reviewNote: '' } as never,
      snapshot: { source: 'qst_return_report', lines: view.result.lines, accounts: view.accounts } as never,
      sourceHash,
      createdById: input.userId,
      preparedById: input.userId,
      reviewedById: input.userId,
      reviewedAt: new Date(),
      filingConfirmation: confirmation,
      filedAt: new Date(),
    },
  });
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      action: 'tax.qst_return.filed_recorded',
      entityType: 'TaxReturnWorkpaper',
      entityId: workpaper.id,
      metadata: { periodStart: input.periodStart, periodEnd: input.periodEnd, confirmation, lines: view.result.lines } as never,
    },
  });
  return { workpaperId: workpaper.id };
}
