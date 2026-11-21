/**
 * Year-end package — server side: assemble the pre-flight facts and
 * the `year-end-package/1` payload for one fiscal year from the
 * company's books. Every section reuses the assembly Phase 1 already
 * built — the tb-gifi/1 builder for the trial balance (current and
 * prior year), assembleCcaRegisterExport for the CCA register, the
 * loan engine/shareholder modules for schedules and proofs,
 * computeGstReturn + buildGstWorksheetPayload for the GST periods.
 * Nothing here recomputes a figure those modules own.
 *
 * Two deliberate choices:
 *  - Loan balance proofs are computed AS AT the fiscal year end from
 *    journal activity (the same source as the trial balance in this
 *    package), not from ChartOfAccount.balance — so the package is
 *    internally consistent even when it is generated after year-end
 *    postings for the next year have begun. (The loan screens use the
 *    running balance for their live proof; the numbers agree at the
 *    moment of generation for the year being closed.)
 *  - GST filing periods are enumerated with the registration's own
 *    anchoring (monthly / quarterly anchored on the registration
 *    month / annual anchored on its start date) — the same rules the
 *    GST return service uses to resolve the period containing a date.
 */

import type { GLType } from '@prisma/client';
import { db } from '@/lib/db';
import { endOfDay, getGLActivity, normalBalance, parseLocalDate, toDebitCredit } from '@/lib/reporting';
import {
  fiscalYearRangeContaining,
  fiscalYearRangeForLabelYear,
  type FiscalYearRange,
} from '@/lib/fiscal-year';
import { buildTbGifiPayload, formatContractBn, type TbGifiPayload } from '@/lib/tb-gifi';
import { computeGifiReadiness } from '@/lib/gifi-readiness';
import { fiscalContextOf, toAdvanceEvents } from '@/lib/loans/present';
import { dateToYmd, loanToScheduleRows } from '@/lib/loans/server';
import { fiscalYearTotals, scheduleBalanceAtCents, toCents } from '@/lib/loans/engine';
import {
  advanceDeadlines,
  detectSeriesPatterns,
  shareholderBalanceAtCents,
  type AdvanceEvent,
} from '@/lib/loans/shareholder';
import { assembleCcaRegisterExport, previewBookDepreciation } from '@/lib/cca/server';
import { ccaClassInfo } from '@/lib/cca/classes';
import { computeGstReturn } from '@/lib/tax/gst-return-service';
import { buildGstWorksheetPayload } from '@/lib/tax/gst-worksheet';
import {
  buildYearEndPackagePayload,
  evaluatePreflight,
  type BuildYearEndPackageResult,
  type CoverSheet,
  type LoanPackageInput,
  type YearEndFacts,
} from '@/lib/year-end-package';

const ATTACH_FROM_NEXVAR_PAY = [
  'T4 slips and T4 Summary for each calendar year overlapping the fiscal year',
  'T4A data for non-employment payments (fees for services, pensions, other income)',
  'PD7A annual reconciliation — T4 summary totals tied to the year’s remittances',
  'Per-employee earnings registers and the employer cost report (gross + employer CPP/EI + WCB)',
];

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The GST filing period containing `dateStr`, under the registration's anchoring. */
function gstPeriodContaining(
  registration: { filingFrequency: string; validFrom: Date },
  dateStr: string
): { start: string; end: string } {
  const [y, m] = dateStr.split('-').map(Number);
  const am = registration.validFrom.getUTCMonth() + 1;
  const ad = registration.validFrom.getUTCDate();
  if (registration.filingFrequency === 'monthly') {
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (registration.filingFrequency === 'quarterly') {
    // Quarters anchored on the registration's start month, computed on
    // a month index so year boundaries cannot produce a month ≤ 0.
    const idx = y * 12 + (m - 1);
    const anchorIdx = registration.validFrom.getUTCFullYear() * 12 + (am - 1);
    const offset = (((idx - anchorIdx) % 3) + 3) % 3;
    const startIdx = idx - offset;
    const start = new Date(Date.UTC(Math.floor(startIdx / 12), startIdx % 12, 1));
    const end = new Date(Date.UTC(Math.floor((startIdx + 3) / 12), (startIdx + 3) % 12, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  // annual (and any other frequency falls back to the annual anchor)
  const anchorMd = `${String(am).padStart(2, '0')}-${String(ad).padStart(2, '0')}`;
  const startThisYear = `${y}-${anchorMd}`;
  const start = dateStr >= startThisYear ? startThisYear : `${y - 1}-${anchorMd}`;
  const startDate = new Date(`${start}T00:00:00Z`);
  startDate.setUTCFullYear(startDate.getUTCFullYear() + 1);
  return { start, end: addDaysYmd(startDate.toISOString().slice(0, 10), -1) };
}

/** Every filing period overlapping [fyStart, fyEnd], in order. */
function enumerateGstPeriods(
  registration: { filingFrequency: string; validFrom: Date },
  fyStart: string,
  fyEnd: string
): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = [];
  let period = gstPeriodContaining(registration, fyStart);
  for (let i = 0; i < 40; i++) {
    if (period.end >= fyStart && period.start <= fyEnd) periods.push(period);
    const nextStart = addDaysYmd(period.end, 1);
    if (nextStart > fyEnd) break;
    period = gstPeriodContaining(registration, nextStart);
  }
  return periods;
}

export interface AssembledYearEnd {
  fiscalYear: FiscalYearRange;
  companyName: string;
  coverSheet: CoverSheet;
  result: BuildYearEndPackageResult;
}

/**
 * Assemble the year-end package for the fiscal year containing
 * `asOfYmd`. Throws (with a bookkeeper-readable message) when the
 * company has no BN or no fiscal year start — the same prerequisites
 * as the tb-gifi/1 and cca-register/1 exports it embeds.
 */
export async function assembleYearEndPackage(
  companyId: string,
  asOfYmd: string
): Promise<AssembledYearEnd> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      businessNumber: true,
      gstNumber: true,
      fiscalYearStart: true,
      firstFiscalYearEnd: true,
    },
  });
  if (!company) throw new Error('Company not found');
  const bn = formatContractBn(company.businessNumber);
  if (!bn) {
    throw new Error(
      'This company has no business number on file. Add the BN in Company Settings before generating a year-end package.'
    );
  }
  if (!company.fiscalYearStart) {
    throw new Error('This company has no fiscal year start configured, so the package period cannot be determined.');
  }

  const ctx = fiscalContextOf(company);
  const fy = fiscalYearRangeContaining(ctx.anchor, asOfYmd, ctx.firstYear);
  const priorFy = fiscalYearRangeForLabelYear(ctx.anchor, fy.labelYear - 1, ctx.firstYear);
  const fyStartDate = parseLocalDate(fy.start);
  const fyEndDate = endOfDay(parseLocalDate(fy.end));
  const generatedAt = new Date().toISOString();

  const accounts = await db.chartOfAccount.findMany({
    where: { companyId },
    orderBy: { code: 'asc' },
  });
  const activeAccounts = accounts.filter((a) => a.active);
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  const [activityThrough, activityPrior, activityWithin, activityOpening] = await Promise.all([
    getGLActivity(companyId, { to: fyEndDate }),
    getGLActivity(companyId, { to: endOfDay(parseLocalDate(priorFy.end)) }),
    getGLActivity(companyId, { from: fyStartDate, to: fyEndDate }),
    getGLActivity(companyId, { to: endOfDay(parseLocalDate(addDaysYmd(fy.start, -1))) }),
  ]);
  const signedCents = (activity: Record<string, { debits: number; credits: number }>, code: string) => {
    const a = activity[code];
    return a ? Math.round((a.debits - a.credits) * 100) : 0;
  };

  // ── Period closes ──
  const [closedFy, closedPrior] = await Promise.all([
    db.periodClose.findFirst({
      where: {
        companyId,
        status: 'closed',
        periodStart: { lte: fyStartDate },
        periodEnd: { gte: fyEndDate },
      },
    }),
    db.periodClose.findFirst({
      where: {
        companyId,
        status: 'closed',
        periodStart: { lte: parseLocalDate(priorFy.start) },
        periodEnd: { gte: endOfDay(parseLocalDate(priorFy.end)) },
      },
      select: { id: true },
    }),
  ]);
  let postingsAfterCloseCount = 0;
  if (closedFy) {
    const closedAt = closedFy.closedAt ?? closedFy.createdAt;
    postingsAfterCloseCount = await db.journalEntry.count({
      where: {
        companyId,
        entryDate: { gte: fyStartDate, lte: fyEndDate },
        createdAt: { gt: closedAt },
      },
    });
  }

  // ── Trial balances (tb-gifi/1, current + comparative) ──
  const tbAccounts = (activity: Record<string, { debits: number; credits: number }>) =>
    activeAccounts.map((acct) => {
      const { debit, credit } = toDebitCredit(acct.type as GLType, activity[acct.code]);
      return {
        accountId: acct.id,
        number: acct.code,
        name: acct.name,
        type: acct.type,
        gifiCode: acct.gifiCode,
        debitCents: Math.round(debit * 100),
        creditCents: Math.round(credit * 100),
      };
    });
  const currentTbInputs = tbAccounts(activityThrough);
  const currentTb = buildTbGifiPayload({
    companyId,
    bn,
    periodStart: fy.start,
    periodEnd: fy.end,
    postedThrough: fyEndDate.toISOString(),
    periodLocked: !!closedFy,
    accounts: currentTbInputs,
  });
  const entriesBeforePriorEnd = await db.journalEntry.count({
    where: { companyId, entryDate: { lte: endOfDay(parseLocalDate(priorFy.end)) } },
  });
  const priorTb: TbGifiPayload | null =
    entriesBeforePriorEnd > 0
      ? buildTbGifiPayload({
          companyId,
          bn,
          periodStart: priorFy.start,
          periodEnd: priorFy.end,
          postedThrough: endOfDay(parseLocalDate(priorFy.end)).toISOString(),
          periodLocked: !!closedPrior,
          accounts: tbAccounts(activityPrior),
        }).payload
      : null;

  // ── GIFI readiness ──
  const readiness = computeGifiReadiness(
    activeAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      detailType: a.detailType,
      gifiCode: a.gifiCode,
      gifiUnmappedByChoice: a.gifiUnmappedByChoice,
      active: a.active,
    }))
  );

  // ── Suspense / clearing accounts ──
  const suspenseAccounts = activeAccounts.filter((a) =>
    /suspense|unidentified|clearing/i.test(a.name)
  );

  // ── Loans ──
  const loans = await db.loan.findMany({
    where: { companyId },
    include: {
      payments: { orderBy: { periodNumber: 'asc' } },
      advances: { orderBy: { advanceDate: 'asc' } },
    },
    orderBy: { startDate: 'asc' },
  });
  const loanFacts: YearEndFacts['loans'] = [];
  const loanInputs: LoanPackageInput[] = [];
  for (const loan of loans) {
    const rows = loanToScheduleRows(loan.payments);
    const principalCents = toCents(Number(loan.principal));
    const account = accountByCode.get(loan.loanAccountCode);
    const glBalanceCents = account
      ? toCents(normalBalance(account.type as GLType, activityThrough[account.code]))
      : null;
    const statementBalanceCents =
      loan.statementBalance != null ? toCents(Number(loan.statementBalance)) : null;

    let scheduleBalanceCents: number;
    let shareholder: LoanPackageInput['shareholder'] = null;
    let factDeadlines: YearEndFacts['loans'][number]['shareholderDeadlines'] = [];

    if (loan.kind === 'term') {
      scheduleBalanceCents = scheduleBalanceAtCents(rows, principalCents, fy.end);
    } else {
      const rawEvents = toAdvanceEvents(loan.advances);
      const flipped = loan.kind === 'shareholder_funding';
      const events: AdvanceEvent[] = flipped
        ? rawEvents.map((e) => ({
            ...e,
            kind: (e.kind === 'advance' ? 'repayment' : 'advance') as AdvanceEvent['kind'],
          }))
        : rawEvents;
      scheduleBalanceCents = shareholderBalanceAtCents(events, fy.end);
      const deadlines = flipped
        ? []
        : advanceDeadlines(rawEvents, ctx.anchor, fy.end, ctx.firstYear).filter(
            (d) => d.outstandingCents > 0
          );
      factDeadlines = deadlines.map((d) => ({
        advanceDate: d.advance.date,
        deadline: d.deadline,
        daysRemaining: d.daysRemaining,
        outstandingCents: d.outstandingCents,
      }));
      shareholder = {
        balanceCents: scheduleBalanceCents,
        deadlines: deadlines.map((d) => ({
          advanceDate: d.advance.date,
          advanceAmountCents: d.advance.amountCents,
          outstandingCents: d.outstandingCents,
          deadline: d.deadline,
          daysRemaining: d.daysRemaining,
          level: d.level,
        })),
        seriesFlags: flipped ? [] : detectSeriesPatterns(rawEvents),
        advances: loan.advances.map((a) => ({
          date: dateToYmd(a.advanceDate),
          kind: a.kind,
          amountCents: toCents(Number(a.amount)),
          notes: a.notes,
        })),
      };
    }

    const scheduleVsGlCents = glBalanceCents != null ? scheduleBalanceCents - glBalanceCents : null;
    const scheduleVsStatementCents =
      statementBalanceCents != null ? scheduleBalanceCents - statementBalanceCents : null;
    const paymentStatus = new Map(loan.payments.map((p) => [p.periodNumber, p.status as string]));

    loanFacts.push({
      id: loan.id,
      lenderName: loan.lenderName,
      kind: loan.kind,
      unpostedDueCount: loan.payments.filter(
        (p) => p.status === 'scheduled' && dateToYmd(p.dueDate) <= fy.end
      ).length,
      scheduleVsGlCents,
      scheduleVsStatementCents,
      shareholderDeadlines: factDeadlines,
    });
    loanInputs.push({
      loanId: loan.id,
      kind: loan.kind,
      status: loan.status,
      lenderName: loan.lenderName,
      purpose: loan.purpose,
      principalCents,
      annualRatePct: Number(loan.annualRatePct),
      startDate: dateToYmd(loan.startDate),
      loanAccountCode: loan.loanAccountCode,
      schedule: rows.map((r) => ({
        period: r.period,
        date: r.date,
        openingCents: r.openingCents,
        paymentCents: r.paymentCents,
        interestCents: r.interestCents,
        principalCents: r.principalCents,
        closingCents: r.closingCents,
        status: paymentStatus.get(r.period) ?? null,
      })),
      fiscalYearTotals: fiscalYearTotals(rows, ctx.anchor, ctx.firstYear).map((t) => ({
        label: t.label,
        start: t.start,
        end: t.end,
        interestCents: t.interestCents,
        principalCents: t.principalCents,
        paymentsCents: t.paymentsCents,
        paymentCount: t.paymentCount,
      })),
      proof: {
        asOf: fy.end,
        scheduleBalanceCents,
        glBalanceCents,
        statementBalanceCents,
        statementBalanceDate: loan.statementBalanceDate ? dateToYmd(loan.statementBalanceDate) : null,
        scheduleVsGlCents,
        scheduleVsStatementCents,
        tiesOut:
          (scheduleVsGlCents == null || scheduleVsGlCents === 0) &&
          (scheduleVsStatementCents == null || scheduleVsStatementCents === 0),
      },
      shareholder,
    });
  }

  // ── Fixed assets + CCA register ──
  const assets = await db.fixedAsset.findMany({
    where: { companyId },
    include: { disposal: true },
    orderBy: { availableForUseDate: 'asc' },
  });
  let ccaPayload: (Record<string, unknown> & { hash: string }) | null = null;
  let bookVsLedgerDifferenceCents: number | null = null;
  try {
    const assembled = await assembleCcaRegisterExport(companyId, fy.end);
    ccaPayload = assembled.result.payload;
    bookVsLedgerDifferenceCents = assembled.result.bookVsLedgerDifferenceCents;
  } catch {
    // BN / fiscal-year prerequisites are validated above, so this is a
    // defensive fallback: the package still generates, with the CCA
    // section absent rather than wrong.
    ccaPayload = null;
  }
  let unpostedDepreciationCents = 0;
  try {
    const preview = await previewBookDepreciation(companyId, fy.end);
    unpostedDepreciationCents = preview.alreadyPostedJournalId ? 0 : preview.totalCents;
  } catch {
    unpostedDepreciationCents = 0;
  }
  const registerAdditionsCents = assets
    .filter((a) => {
      const d = dateToYmd(a.acquisitionDate);
      return d >= fy.start && d <= fy.end;
    })
    .reduce((s, a) => s + toCents(Number(a.capitalCost)), 0);
  const mappedAssetCodes = [...new Set(assets.map((a) => a.assetAccountCode).filter(Boolean))] as string[];
  const glAdditionsCents =
    mappedAssetCodes.length > 0
      ? mappedAssetCodes.reduce((s, code) => s + signedCents(activityWithin, code), 0)
      : null;

  // ── GST/HST periods ──
  const registration = await db.companyTaxRegistration.findFirst({
    where: { companyId, regime: 'gst_hst', active: true },
    orderBy: { validFrom: 'desc' },
    select: { registrationNumber: true, filingFrequency: true, province: true, validFrom: true },
  });
  const gstPeriodRanges = registration
    ? enumerateGstPeriods(registration, fy.start, fy.end)
    : [{ start: fy.start, end: fy.end }];
  const gstFacts: YearEndFacts['gst'] = {
    registrationPresent: !!registration,
    periods: [],
  };
  const gstWorksheets: { periodStart: string; periodEnd: string; payload: Record<string, unknown> & { hash: string } }[] = [];
  for (const period of gstPeriodRanges) {
    const view = await computeGstReturn(companyId, period.start, period.end);
    gstFacts.periods.push({
      start: period.start,
      end: period.end,
      due: period.end <= fy.end,
      filed: !!view.filed,
      confirmation: view.filed?.filingConfirmation ?? null,
    });
    const { payload } = buildGstWorksheetPayload({
      companyId,
      companyName: company.name,
      gstNumber: company.gstNumber ?? null,
      registration: view.registration,
      worksheet: view.worksheet,
      generatedAt,
    });
    gstWorksheets.push({ periodStart: period.start, periodEnd: period.end, payload });
  }

  // ── Bank reconciliation state ──
  const financialAccounts = await db.financialAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, lockedThrough: true },
    orderBy: { name: 'asc' },
  });
  let bankAccounts: YearEndFacts['bank']['accounts'] = null;
  if (financialAccounts.length > 0) {
    const completedRecs = await db.reconciliation.findMany({
      where: {
        companyId,
        financialAccountId: { in: financialAccounts.map((a) => a.id) },
        state: { in: ['locked', 'closed_with_variance'] },
      },
      select: { financialAccountId: true, periodEnd: true },
    });
    bankAccounts = financialAccounts.map((a) => {
      const throughs = completedRecs
        .filter((r) => r.financialAccountId === a.id)
        .map((r) => dateToYmd(r.periodEnd));
      if (a.lockedThrough) throughs.push(dateToYmd(a.lockedThrough));
      throughs.sort();
      return { name: a.name, reconciledThrough: throughs[throughs.length - 1] ?? null };
    });
  }

  // ── Payroll journals posted into these books ──
  const payrollEntries = await db.journalEntry.findMany({
    where: { companyId, sourceType: 'payroll', entryDate: { gte: fyStartDate, lte: fyEndDate } },
    include: { lines: true },
    orderBy: { entryDate: 'asc' },
  });
  const payrollAccountTotals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const entry of payrollEntries) {
    for (const line of entry.lines) {
      const t = payrollAccountTotals.get(line.glAccountCode) ?? { debitCents: 0, creditCents: 0 };
      t.debitCents += toCents(Number(line.debit));
      t.creditCents += toCents(Number(line.credit));
      payrollAccountTotals.set(line.glAccountCode, t);
    }
  }

  // ── GL detail: journal summary by source ──
  const fyEntries = await db.journalEntry.findMany({
    where: { companyId, entryDate: { gte: fyStartDate, lte: fyEndDate } },
    select: { id: true, sourceType: true },
  });
  const sourceByEntry = new Map(fyEntries.map((e) => [e.id, e.sourceType as string]));
  const fyLines = fyEntries.length
    ? await db.journalLine.findMany({
        where: { journalEntryId: { in: fyEntries.map((e) => e.id) } },
        select: { journalEntryId: true, debit: true },
      })
    : [];
  const sourceSummary = new Map<string, { entryCount: number; debitCents: number }>();
  for (const e of fyEntries) {
    const s = sourceSummary.get(e.sourceType) ?? { entryCount: 0, debitCents: 0 };
    s.entryCount += 1;
    sourceSummary.set(e.sourceType, s);
  }
  for (const line of fyLines) {
    const source = sourceByEntry.get(line.journalEntryId);
    if (!source) continue;
    const s = sourceSummary.get(source);
    if (s) s.debitCents += toCents(Number(line.debit));
  }

  // ── Facts → pre-flight ──
  const facts: YearEndFacts = {
    fiscalYear: { start: fy.start, end: fy.end, label: fy.label },
    trialBalance: {
      totalDebitCents: currentTbInputs.reduce((s, a) => s + a.debitCents, 0),
      totalCreditCents: currentTbInputs.reduce((s, a) => s + a.creditCents, 0),
      accountCount: currentTb.accountCount,
    },
    gifi: {
      total: readiness.total,
      coded: readiness.coded,
      needsCode: readiness.needsCode.map((a) => ({
        code: a.code,
        name: a.name,
        balanceCents: signedCents(activityThrough, a.code),
      })),
      decidedUnmapped: readiness.decidedUnmapped.map((a) => ({ code: a.code, name: a.name })),
    },
    suspense: suspenseAccounts
      .map((a) => ({ code: a.code, name: a.name, balanceCents: signedCents(activityThrough, a.code) }))
      .filter((a) => a.balanceCents !== 0),
    suspenseAccountsExist: suspenseAccounts.length > 0,
    periodLock: { closed: !!closedFy, postingsAfterCloseCount },
    loans: loanFacts,
    fixedAssets: {
      assetCount: assets.length,
      unmodelledClass: assets
        .filter((a) => !ccaClassInfo(a.ccaClass))
        .map((a) => ({ description: a.description, ccaClass: a.ccaClass })),
      missingGlMapping: assets.filter((a) => !a.assetAccountCode).map((a) => a.description),
      afuBeforeAcquisition: assets
        .filter((a) => dateToYmd(a.availableForUseDate) < dateToYmd(a.acquisitionDate))
        .map((a) => a.description),
      registerAdditionsCents,
      glAdditionsCents,
      bookVsLedgerDifferenceCents,
      unpostedDepreciationCents,
    },
    gst: gstFacts,
    bank: { accounts: bankAccounts },
    payroll: {
      notCheckedReason:
        'Nexvar Pay — a separate product and database — owns the T4 summary and the PD7A remittance record, so the tie-out cannot be checked from LedgerPro. The payroll journals posted into these books are in this package’s Payroll section; attach Nexvar Pay’s year-end payroll package for the T4/T4A data and the PD7A reconciliation.',
    },
  };
  const coverSheet = evaluatePreflight(facts);

  // ── Package ──
  const result = buildYearEndPackagePayload({
    companyId,
    companyName: company.name,
    bn,
    gstNumber: company.gstNumber ?? null,
    fiscalYear: { start: fy.start, end: fy.end, label: fy.label },
    generatedAt,
    coverSheet,
    mappingHealth: {
      total: readiness.total,
      coded: readiness.coded,
      undecidedCount: readiness.needsCode.length,
      decidedUnmappedCount: readiness.decidedUnmapped.length,
      scorePct:
        readiness.total > 0 ? Math.round((readiness.coded / readiness.total) * 1000) / 10 : null,
    },
    trialBalance: { current: currentTb.payload, priorYear: priorTb },
    glDetail: {
      accounts: activeAccounts.map((a) => {
        const opening = signedCents(activityOpening, a.code);
        const within = activityWithin[a.code];
        const debitCents = within ? Math.round(within.debits * 100) : 0;
        const creditCents = within ? Math.round(within.credits * 100) : 0;
        return {
          code: a.code,
          name: a.name,
          type: a.type,
          openingCents: opening,
          debitCents,
          creditCents,
          closingCents: opening + debitCents - creditCents,
        };
      }),
      journalSummaryBySource: [...sourceSummary.entries()]
        .map(([source, s]) => ({ source, entryCount: s.entryCount, debitCents: s.debitCents }))
        .sort((x, y) => x.source.localeCompare(y.source)),
    },
    ccaRegister: ccaPayload,
    loans: loanInputs,
    gstWorksheets,
    payroll: {
      status: payrollEntries.length > 0 ? 'ledgerpro_journals' : 'no_payroll_journals',
      runCount: payrollEntries.filter((e) => e.reversalOfId == null).length,
      accounts: [...payrollAccountTotals.entries()]
        .map(([code, t]) => ({
          code,
          name: accountByCode.get(code)?.name ?? code,
          debitCents: t.debitCents,
          creditCents: t.creditCents,
        }))
        .sort((x, y) => x.code.localeCompare(y.code)),
      attachFromNexvarPay: ATTACH_FROM_NEXVAR_PAY,
    },
  });

  return { fiscalYear: fy, companyName: company.name, coverSheet, result };
}
