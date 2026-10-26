/**
 * Phase 1 — GST/HST return (simple path) service: loads the GL lines the
 * pure computation needs, resolves the filing period, and records filing
 * through the existing TaxReturnWorkpaper model so this report and Tax
 * Workpapers can never disagree about what was filed.
 */
import { db } from '@/lib/db';
import { computeGstHstReturn, type GstJournalLine, type GstReturnResult } from './gst-return';
import { loadSimpleTaxAccounts } from './accounts';
import { anchorMonthDay, fiscalYearRangeContaining, toYmd } from '@/lib/fiscal-year';
import { TaxPostingError } from './posting-service';

const day = (d: Date): string => d.toISOString().slice(0, 10);

export interface GstReturnView {
  periodStart: string;
  periodEnd: string;
  result: GstReturnResult;
  accounts: { output: string; recoverable: string };
  registration: { id: string; registrationNumber: string; filingFrequency: string; province: string | null } | null;
  filed: { id: string; filedAt: string; filingConfirmation: string | null; status: string } | null;
  /** Other filed periods overlapping the requested one (period-lock warning). */
  overlappingFiled: { periodStart: string; periodEnd: string }[];
  notes: string[];
}

async function activeGstRegistration(companyId: string) {
  return db.companyTaxRegistration.findFirst({
    where: { companyId, regime: 'gst_hst', active: true },
    orderBy: { validFrom: 'desc' },
    select: { id: true, registrationNumber: true, filingFrequency: true, province: true, validFrom: true },
  });
}

/**
 * Default filing period containing `today`: the registration's frequency
 * anchored on its validFrom month/day; without a registration, the
 * company's current fiscal year (via the Phase 0 fiscal-year helpers).
 */
export async function defaultGstPeriod(companyId: string, today = new Date()): Promise<{ start: string; end: string }> {
  const registration = await activeGstRegistration(companyId);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  if (registration) {
    const anchor = registration.validFrom;
    const am = anchor.getUTCMonth() + 1;
    const ad = anchor.getUTCDate();
    if (registration.filingFrequency === 'monthly') {
      return { start: toYmd(y, m, 1), end: toYmd(y, m + 1, 0) };
    }
    if (registration.filingFrequency === 'quarterly') {
      // Quarters anchored on the registration's start month.
      const offset = ((m - am) % 3 + 3) % 3;
      const qStartMonth = m - offset;
      const start = toYmd(y, qStartMonth, 1);
      const end = toYmd(y, qStartMonth + 3, 0);
      return { start, end };
    }
    if (registration.filingFrequency === 'annual') {
      const startThisYear = toYmd(y, am, ad);
      const start = day(today) >= startThisYear ? startThisYear : toYmd(y - 1, am, ad);
      // Annual period: [start, start + 1 year − 1 day].
      const startDate = new Date(start + 'T00:00:00Z');
      startDate.setUTCFullYear(startDate.getUTCFullYear() + 1);
      const end = addDays(day(startDate), -1);
      return { start, end };
    }
  }
  const company = await db.company.findUnique({ where: { id: companyId }, select: { fiscalYearStart: true } });
  const anchor = anchorMonthDay(company?.fiscalYearStart ?? new Date(Date.UTC(y, 0, 1)));
  const range = fiscalYearRangeContaining(anchor, day(today));
  return { start: range.start, end: range.end };
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return day(d);
}

export async function computeGstReturn(companyId: string, periodStart: string, periodEnd: string): Promise<GstReturnView> {
  if (periodStart > periodEnd) throw new TaxPostingError('invalid_period', 'Period start must not be after period end.');
  const accounts = await loadSimpleTaxAccounts(companyId);
  const registration = await activeGstRegistration(companyId);

  const start = new Date(periodStart + 'T00:00:00Z');
  const endExclusive = new Date(periodEnd + 'T00:00:00Z');
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const incomeAccounts = await db.chartOfAccount.findMany({
    where: { companyId, type: 'income' },
    select: { code: true },
  });
  const codes = [...new Set([...incomeAccounts.map((a) => a.code), accounts.output, accounts.recoverable])];

  const entries = await db.journalEntry.findMany({
    where: { companyId, entryDate: { gte: start, lt: endExclusive }, lines: { some: { glAccountCode: { in: codes } } } },
    include: { lines: { where: { glAccountCode: { in: codes } } } },
    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
  });
  const typeByCode = new Map<string, string>();
  const allAccounts = await db.chartOfAccount.findMany({ where: { companyId, code: { in: codes } }, select: { code: true, type: true } });
  allAccounts.forEach((a) => typeByCode.set(a.code, a.type));

  const lines: GstJournalLine[] = entries.flatMap((e) =>
    e.lines.map((l) => ({
      id: l.id,
      entryId: e.id,
      date: day(e.entryDate),
      accountCode: l.glAccountCode,
      accountType: l.glAccountCode === accounts.output || l.glAccountCode === accounts.recoverable ? 'liability' : (typeByCode.get(l.glAccountCode) ?? ''),
      description: l.description ?? e.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  );
  // Income classification: only real income accounts feed line 101.
  const incomeCodes = new Set(incomeAccounts.map((a) => a.code));
  const typedLines = lines.map((l) => ({ ...l, accountType: incomeCodes.has(l.accountCode) ? 'income' : l.accountType }));

  const result = computeGstHstReturn({ lines: typedLines, outputAccountCode: accounts.output, recoverableAccountCode: accounts.recoverable });

  const workpapers = registration
    ? await db.taxReturnWorkpaper.findMany({
        where: { companyId, registrationId: registration.id, regime: 'gst_hst' },
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
  if (!registration) notes.push('No GST/HST registration on file for this company. The return still computes from the ledger; add a registration (Settings → Tax or the mark-as-filed flow) to record filings.');
  notes.push('Lines 104/107 adjustments, 110 instalments and 111 rebates are $0 in this view — record them through Tax Workpapers with supporting evidence.');

  return {
    periodStart,
    periodEnd,
    result,
    accounts: { output: accounts.output, recoverable: accounts.recoverable },
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
 * TaxReturnWorkpaper advanced straight to filed_recorded with the user's
 * external CRA confirmation reference. The report is a working copy —
 * LedgerPro records filing, it never submits to CRA.
 */
export async function markGstReturnFiled(input: {
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
    throw new TaxPostingError('filing_not_allowed', 'Provide the external CRA filing confirmation reference (max 200 characters).');
  }
  let registration = input.registrationId
    ? await db.companyTaxRegistration.findFirst({ where: { id: input.registrationId, companyId: input.companyId, regime: 'gst_hst' } })
    : await activeGstRegistration(input.companyId);

  if (!registration) {
    if (!input.createRegistration?.registrationNumber) {
      throw new TaxPostingError('registration_not_found', 'A GST/HST registration is required to record a filing. Provide the registration (RT) number and filing frequency.', 409);
    }
    const company = await db.company.findUnique({ where: { id: input.companyId }, select: { gstNumber: true, province: true } });
    registration = await db.companyTaxRegistration.create({
      data: {
        companyId: input.companyId,
        regime: 'gst_hst',
        registrationNumber: input.createRegistration.registrationNumber.trim(),
        province: (company?.province as never) ?? null,
        method: 'regular',
        filingFrequency: input.createRegistration.filingFrequency,
        validFrom: new Date(input.periodStart + 'T00:00:00Z'),
        active: true,
        reviewedById: input.userId,
        reviewedAt: new Date(),
      },
    });
  }

  const view = await computeGstReturn(input.companyId, input.periodStart, input.periodEnd);
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
      regime: 'gst_hst',
      periodStart: start,
      periodEnd: end,
      version: (latest?.version ?? 0) + 1,
      status: 'filed_recorded',
      inputs: { classifications: [], periodEvidence: 'Filed from the GST/HST Return report (simple path, GL-based).', reviewNote: '' } as never,
      snapshot: { source: 'gst_return_report', lines: view.result.lines, accounts: view.accounts } as never,
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
      action: 'tax.gst_return.filed_recorded',
      entityType: 'TaxReturnWorkpaper',
      entityId: workpaper.id,
      metadata: { periodStart: input.periodStart, periodEnd: input.periodEnd, confirmation, lines: view.result.lines } as never,
    },
  });
  return { workpaperId: workpaper.id };
}
