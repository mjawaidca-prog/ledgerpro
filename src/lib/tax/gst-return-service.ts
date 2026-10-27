/**
 * Phase 1 — GST/HST return (simple path) service: loads the GL lines the
 * pure computation needs, resolves the filing period, and records filing
 * through the existing TaxReturnWorkpaper model so this report and Tax
 * Workpapers can never disagree about what was filed.
 */
import { db } from '@/lib/db';
import {
  computeGstHstReturn, normalizeGstAdjustments, validateGstAdjustments,
  type GstAdjustments, type GstAdjustmentsInput, type GstJournalLine, type GstReturnResult,
} from './gst-return';
import { loadSimpleTaxAccounts } from './accounts';
import { anchorMonthDay, fiscalYearRangeContaining, toYmd } from '@/lib/fiscal-year';
import { TaxPostingError } from './posting-service';

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Storage decision (Phase 1 cleanup, no schema change): simple-path
 * adjustments live in `inputs.simpleAdjustments` of the period's
 * TaxReturnWorkpaper — the same row the GST/HST Return report already
 * creates on mark-as-filed and the same row Tax Workpapers reads. That
 * keeps one source of truth per period: the return page, its CSV, and a
 * GL-mode workpaper for the same period all read the same JSON, so they
 * cannot disagree. The key is deliberately distinct from the workpaper's
 * `classifications` (GL-line classifications), which the GL bridge treats
 * as a blocker — adjustments are period-level rows, not classifications.
 */
export function extractSimpleAdjustments(inputs: unknown): GstAdjustmentsInput | undefined {
  if (!inputs || typeof inputs !== 'object') return undefined;
  const raw = (inputs as Record<string, unknown>).simpleAdjustments;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const items = (v: unknown) => (Array.isArray(v)
    ? v.filter((i) => i && typeof i === 'object').map((i) => {
        const o = i as Record<string, unknown>;
        return { amount: Number(o.amount) || 0, note: String(o.note ?? '') };
      })
    : []);
  const out: GstAdjustmentsInput = {
    add: items(r.add), deduct: items(r.deduct),
    instalments: items(r.instalments), rebates: items(r.rebates),
  };
  return out.add!.length || out.deduct!.length || out.instalments!.length || out.rebates!.length ? out : undefined;
}

/** Storage form: normalized groups with trimmed notes (no totals — derived). */
function adjustmentsForStorage(input?: GstAdjustmentsInput | null): Record<string, { amount: number; note: string }[]> {
  const n = normalizeGstAdjustments(input);
  const clean = (items: { amount: number; note: string }[]) => items.map((i) => ({ amount: i.amount, note: i.note.trim() }));
  return { add: clean(n.add), deduct: clean(n.deduct), instalments: clean(n.instalments), rebates: clean(n.rebates) };
}

export interface GstReturnView {
  periodStart: string;
  periodEnd: string;
  result: GstReturnResult;
  /** Current simple-path adjustments for the period (from the period workpaper's inputs). */
  adjustments: GstAdjustments;
  /** Workpaper holding the adjustments, when one exists for the exact period. */
  adjustmentsWorkpaper: { id: string; status: string } | null;
  accounts: { output: string; recoverable: string };
  registration: { id: string; registrationNumber: string; filingFrequency: string; province: string | null } | null;
  filed: { id: string; filedAt: string; filingConfirmation: string | null; status: string } | null;
  /** Other filed periods overlapping the requested one (period-lock warning). */
  overlappingFiled: { periodStart: string; periodEnd: string; filedAt: string; filingConfirmation: string | null }[];
  /** Hard lock: a filed_recorded workpaper covers (exactly or overlapping) this period — tax-affecting postings dated inside it are blocked. */
  locked: boolean;
  /** The filed period that locks this view (exact match wins, else the first overlapping filed period). */
  lockedFiled: { periodStart: string; periodEnd: string; filedAt: string; filingConfirmation: string | null } | null;
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
/** The filing period (registration frequency, else fiscal year) containing `dateStr`. */
async function periodContaining(companyId: string, dateStr: string): Promise<{ start: string; end: string }> {
  const date = new Date(dateStr + 'T00:00:00Z');
  const registration = await activeGstRegistration(companyId);
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
      // Quarters anchored on the registration's start month.
      const offset = ((m - am) % 3 + 3) % 3;
      const qStartMonth = m - offset;
      const start = toYmd(y, qStartMonth, 1);
      const end = toYmd(y, qStartMonth + 3, 0);
      return { start, end };
    }
    if (registration.filingFrequency === 'annual') {
      const startThisYear = toYmd(y, am, ad);
      const start = dateStr >= startThisYear ? startThisYear : toYmd(y - 1, am, ad);
      // Annual period: [start, start + 1 year − 1 day].
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

export async function defaultGstPeriod(companyId: string, today = new Date()): Promise<{ start: string; end: string }> {
  const candidate = await periodContaining(companyId, day(today));
  // Activity-aware default: users open this report to file or review the
  // period they actually posted in. If the latest tax-account activity is
  // older than the current (still empty) period — the common case right
  // after a period ends — default to the period containing that activity
  // instead of the empty current one.
  const accounts = await loadSimpleTaxAccounts(companyId);
  const codes = [accounts.output, accounts.recoverable].filter(Boolean);
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

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return day(d);
}

export async function computeGstReturn(
  companyId: string, periodStart: string, periodEnd: string,
  adjustmentsOverride?: GstAdjustmentsInput | null,
): Promise<GstReturnView> {
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

  // With a registration, filings are scoped to it (as before). Without
  // one, fall back to every GST/HST workpaper for the company so the
  // locked flag matches the company-wide filed-period hard lock.
  const workpapers = await db.taxReturnWorkpaper.findMany({
    where: registration ? { companyId, registrationId: registration.id, regime: 'gst_hst' } : { companyId, regime: 'gst_hst' },
    select: { id: true, periodStart: true, periodEnd: true, status: true, filedAt: true, filingConfirmation: true, inputs: true },
    orderBy: { version: 'desc' },
  });
  const exact = workpapers.find(
    (w) => day(w.periodStart) === periodStart && day(w.periodEnd) === periodEnd && w.status === 'filed_recorded',
  );
  // Latest workpaper for the exact period (any status) holds the period's
  // simple-path adjustments in its inputs — see the storage note above.
  const exactLatest = workpapers.find(
    (w) => day(w.periodStart) === periodStart && day(w.periodEnd) === periodEnd,
  );
  const adjustmentsInput = adjustmentsOverride !== undefined
    ? adjustmentsOverride
    : extractSimpleAdjustments(exactLatest?.inputs);
  const adjustments = normalizeGstAdjustments(adjustmentsInput);
  const result = computeGstHstReturn({
    lines: typedLines, outputAccountCode: accounts.output, recoverableAccountCode: accounts.recoverable,
    adjustments: adjustmentsInput,
  });
  const overlappingFiled = workpapers
    .filter((w) => w.status === 'filed_recorded' && !(day(w.periodStart) === periodStart && day(w.periodEnd) === periodEnd))
    .filter((w) => day(w.periodStart) <= periodEnd && day(w.periodEnd) >= periodStart)
    .map((w) => ({ periodStart: day(w.periodStart), periodEnd: day(w.periodEnd), filedAt: w.filedAt ? w.filedAt.toISOString() : '', filingConfirmation: w.filingConfirmation }));
  const lockedFiled = exact
    ? { periodStart, periodEnd, filedAt: exact.filedAt ? exact.filedAt.toISOString() : '', filingConfirmation: exact.filingConfirmation }
    : overlappingFiled[0] ?? null;

  const notes: string[] = [];
  if (!registration) notes.push('No GST/HST registration on file for this company. The return still computes from the ledger; add a registration (Settings → Tax or the mark-as-filed flow) to record filings.');
  const hasAdjustments = adjustments.add.length + adjustments.deduct.length + adjustments.instalments.length + adjustments.rebates.length > 0;
  notes.push(hasAdjustments
    ? 'Lines 104/107/110/111 include the simple-path adjustments saved for this period (see Adjustments below). The same amounts flow into a GL simple-path Tax Workpaper for this period.'
    : 'Lines 104/107 adjustments, 110 instalments and 111 rebates are $0 — add them in the Adjustments section below when they apply.');

  return {
    periodStart,
    periodEnd,
    result,
    adjustments,
    adjustmentsWorkpaper: exactLatest ? { id: exactLatest.id, status: exactLatest.status } : null,
    accounts: { output: accounts.output, recoverable: accounts.recoverable },
    registration: registration
      ? { id: registration.id, registrationNumber: registration.registrationNumber, filingFrequency: registration.filingFrequency, province: registration.province }
      : null,
    filed: exact ? { id: exact.id, filedAt: exact.filedAt ? exact.filedAt.toISOString() : '', filingConfirmation: exact.filingConfirmation, status: exact.status } : null,
    overlappingFiled,
    locked: Boolean(lockedFiled),
    lockedFiled,
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
      inputs: {
        classifications: [], periodEvidence: 'Filed from the GST/HST Return report (simple path, GL-based).', reviewNote: '',
        ...(extractSimpleAdjustments(latest?.inputs) || view.adjustments.add.length + view.adjustments.deduct.length + view.adjustments.instalments.length + view.adjustments.rebates.length > 0
          ? { simpleAdjustments: adjustmentsForStorage(view.adjustments) }
          : {}),
      } as never,
      snapshot: { source: 'gst_return_report', lines: view.result.lines, accounts: view.accounts, adjustments: view.adjustments } as never,
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

/**
 * Save (replace) the simple-path adjustments for a period. Stored in
 * `inputs.simpleAdjustments` of the period's TaxReturnWorkpaper; the
 * draft workpaper — and, when the company has none, a minimal GST/HST
 * registration — is created lazily, mirroring mark-as-filed. Filed
 * periods and non-draft workpapers are locked. Owner/admin enforcement
 * happens at the route (roles) and is re-checked by requireCompany.
 */
export async function saveGstAdjustments(input: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  adjustments: GstAdjustmentsInput;
  registrationId?: string;
  createRegistration?: { registrationNumber: string; filingFrequency: 'monthly' | 'quarterly' | 'annual' };
}): Promise<{ workpaperId: string; adjustments: GstAdjustments; result: GstReturnResult }> {
  if (input.periodStart > input.periodEnd) {
    throw new TaxPostingError('invalid_period', 'Period start must not be after period end.');
  }
  const invalid = validateGstAdjustments(input.adjustments);
  if (invalid) throw new TaxPostingError('invalid_adjustments', invalid);
  const stored = adjustmentsForStorage(input.adjustments);

  let registration = input.registrationId
    ? await db.companyTaxRegistration.findFirst({ where: { id: input.registrationId, companyId: input.companyId, regime: 'gst_hst' } })
    : await activeGstRegistration(input.companyId);
  if (!registration) {
    // Lazy minimal registration, mirroring mark-as-filed: explicit
    // createRegistration wins; otherwise fall back to the company's
    // GST number on file (annual filer) so a first adjustment save works
    // for a company whose books predate its Tax Setup records.
    const company = await db.company.findUnique({ where: { id: input.companyId }, select: { gstNumber: true, province: true } });
    const registrationNumber = input.createRegistration?.registrationNumber?.trim() || company?.gstNumber?.trim();
    if (!registrationNumber) {
      throw new TaxPostingError('registration_not_found', 'A GST/HST registration is required to save adjustments. Provide the registration (RT) number and filing frequency, or add the GST number to the company profile.', 409);
    }
    registration = await db.companyTaxRegistration.create({
      data: {
        companyId: input.companyId,
        regime: 'gst_hst',
        registrationNumber,
        province: (company?.province as never) ?? null,
        method: 'regular',
        filingFrequency: input.createRegistration?.filingFrequency ?? 'annual',
        validFrom: new Date(input.periodStart + 'T00:00:00Z'),
        active: true,
        reviewedById: input.userId,
        reviewedAt: new Date(),
      },
    });
  }

  const start = new Date(input.periodStart + 'T00:00:00Z');
  const end = new Date(input.periodEnd + 'T00:00:00Z');
  const latest = await db.taxReturnWorkpaper.findFirst({
    where: { companyId: input.companyId, registrationId: registration.id, periodStart: start, periodEnd: end },
    orderBy: { version: 'desc' },
  });
  if (latest?.status === 'filed_recorded') {
    throw new TaxPostingError('already_filed', 'This period is already recorded as filed; its adjustments can no longer be changed.', 409);
  }
  if (latest && latest.status !== 'draft') {
    throw new TaxPostingError('workpaper_locked', 'Only a draft workpaper can take new adjustments. Reopen the period workpaper before changing adjustments.', 409);
  }

  // Compute the return with the NEW adjustments (override) for the snapshot.
  const view = await computeGstReturn(input.companyId, input.periodStart, input.periodEnd, input.adjustments);
  const { createHash } = await import('node:crypto');
  const sourceHash = createHash('sha256').update(JSON.stringify(view.result)).digest('hex');
  const snapshot = { source: 'gst_return_report', lines: view.result.lines, accounts: view.accounts, adjustments: view.adjustments } as never;

  let workpaperId: string;
  if (latest) {
    const prevInputs = (latest.inputs && typeof latest.inputs === 'object' ? latest.inputs : {}) as Record<string, unknown>;
    const nextInputs = {
      classifications: Array.isArray(prevInputs.classifications) ? prevInputs.classifications : [],
      periodEvidence: typeof prevInputs.periodEvidence === 'string' && prevInputs.periodEvidence.length >= 5
        ? prevInputs.periodEvidence
        : 'GST/HST Return adjustments (simple path, GL-based).',
      reviewNote: typeof prevInputs.reviewNote === 'string' ? prevInputs.reviewNote : '',
      simpleAdjustments: stored,
    };
    const updated = await db.taxReturnWorkpaper.update({
      where: { id: latest.id },
      data: { inputs: nextInputs as never, snapshot, sourceHash },
    });
    workpaperId = updated.id;
  } else {
    const created = await db.taxReturnWorkpaper.create({
      data: {
        companyId: input.companyId,
        registrationId: registration.id,
        regime: 'gst_hst',
        periodStart: start,
        periodEnd: end,
        version: 1,
        status: 'draft',
        inputs: {
          classifications: [],
          periodEvidence: 'GST/HST Return adjustments (simple path, GL-based).',
          reviewNote: '',
          simpleAdjustments: stored,
        } as never,
        snapshot,
        sourceHash,
        createdById: input.userId,
      },
    });
    workpaperId = created.id;
  }
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      action: 'tax.gst_return.adjustments_saved',
      entityType: 'TaxReturnWorkpaper',
      entityId: workpaperId,
      metadata: {
        periodStart: input.periodStart, periodEnd: input.periodEnd,
        totals: view.adjustments.totals, lines: view.result.lines,
      } as never,
    },
  });
  return { workpaperId, adjustments: view.adjustments, result: view.result };
}
