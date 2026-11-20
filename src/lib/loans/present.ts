/**
 * Loan tool — API presentation: serialize Prisma rows to plain JSON and
 * attach the computed views (current balance, next payment, fiscal-year
 * interest, shareholder warnings) that the register screens render.
 * Dates cross the API as YYYY-MM-DD strings; money as dollar numbers.
 */

import type { Company, Loan, LoanAdvance, LoanPayment } from '@prisma/client';
import {
  anchorMonthDay,
  firstFiscalYearOf,
  fiscalYearRangeContaining,
  type FirstFiscalYear,
} from '@/lib/fiscal-year';
import {
  fiscalYearTotals,
  scheduleBalanceAtCents,
  toCents,
  toDollars,
} from './engine';
import {
  advanceDeadlines,
  detectSeriesPatterns,
  shareholderBalanceAtCents,
  shareholderBenefitCents,
  type AdvanceEvent,
} from './shareholder';
import { dateToYmd, loanToScheduleRows } from './server';

export interface FiscalContext {
  anchor: { month: number; day: number };
  firstYear: FirstFiscalYear | null;
}

export function fiscalContextOf(
  company: Pick<Company, 'fiscalYearStart' | 'firstFiscalYearEnd'>
): FiscalContext {
  return {
    anchor: anchorMonthDay(company.fiscalYearStart),
    firstYear: firstFiscalYearOf(company.fiscalYearStart, company.firstFiscalYearEnd),
  };
}

export function loanJson(loan: Loan) {
  return {
    id: loan.id,
    kind: loan.kind,
    status: loan.status,
    lenderName: loan.lenderName,
    purpose: loan.purpose,
    assetAccountCode: loan.assetAccountCode,
    principal: Number(loan.principal),
    annualRatePct: Number(loan.annualRatePct),
    rateType: loan.rateType,
    compoundingPerYear: loan.compoundingPerYear,
    startDate: dateToYmd(loan.startDate),
    firstPaymentDate: loan.firstPaymentDate ? dateToYmd(loan.firstPaymentDate) : null,
    paymentFrequency: loan.paymentFrequency,
    paymentAmount: loan.paymentAmount != null ? Number(loan.paymentAmount) : null,
    numberOfPayments: loan.numberOfPayments,
    balloonAmount: loan.balloonAmount != null ? Number(loan.balloonAmount) : null,
    loanAccountCode: loan.loanAccountCode,
    interestAccountCode: loan.interestAccountCode,
    paymentAccountCode: loan.paymentAccountCode,
    statementBalance: loan.statementBalance != null ? Number(loan.statementBalance) : null,
    statementBalanceDate: loan.statementBalanceDate ? dateToYmd(loan.statementBalanceDate) : null,
    prescribedRatePct: loan.prescribedRatePct != null ? Number(loan.prescribedRatePct) : null,
    notes: loan.notes,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

export function paymentJson(p: LoanPayment) {
  return {
    id: p.id,
    periodNumber: p.periodNumber,
    dueDate: dateToYmd(p.dueDate),
    openingBalance: Number(p.openingBalance),
    paymentAmount: Number(p.paymentAmount),
    interestPortion: Number(p.interestPortion),
    principalPortion: Number(p.principalPortion),
    closingBalance: Number(p.closingBalance),
    status: p.status,
    actualAmount: p.actualAmount != null ? Number(p.actualAmount) : null,
    actualDate: p.actualDate ? dateToYmd(p.actualDate) : null,
    journalEntryId: p.journalEntryId,
  };
}

export function advanceJson(a: LoanAdvance) {
  return {
    id: a.id,
    kind: a.kind,
    date: dateToYmd(a.advanceDate),
    amount: Number(a.amount),
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toAdvanceEvents(advances: LoanAdvance[]): AdvanceEvent[] {
  return advances.map((a) => ({
    id: a.id,
    kind: a.kind,
    date: dateToYmd(a.advanceDate),
    amountCents: toCents(Number(a.amount)),
    notes: a.notes,
  }));
}

/** Computed summary for a term loan: balance today, next payment, FY interest. */
export function termLoanSummary(loan: Loan, payments: LoanPayment[], ctx: FiscalContext, todayYmd: string) {
  const rows = loanToScheduleRows(payments);
  const next = payments
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => a.periodNumber - b.periodNumber)[0];
  return {
    balanceToday: toDollars(scheduleBalanceAtCents(rows, toCents(Number(loan.principal)), todayYmd)),
    nextPayment: next
      ? { paymentId: next.id, date: dateToYmd(next.dueDate), amount: Number(next.paymentAmount) }
      : null,
    fiscalYearInterest: fiscalYearTotals(rows, ctx.anchor, ctx.firstYear).map((fy) => ({
      label: fy.label,
      start: fy.start,
      end: fy.end,
      interest: toDollars(fy.interestCents),
      principal: toDollars(fy.principalCents),
      payments: toDollars(fy.paymentsCents),
      paymentCount: fy.paymentCount,
    })),
  };
}

/** Computed summary for a shareholder loan: balance, deadlines, series flags, s.80.4 estimate. */
export function shareholderSummary(
  loan: Loan,
  advances: LoanAdvance[],
  ctx: FiscalContext,
  todayYmd: string
) {
  const rawEvents = toAdvanceEvents(advances);
  if (loan.kind === 'shareholder_funding') {
    // Money the shareholder put IN: the balance is owed TO them, and the
    // s.15(2) / s.80.4 machinery (which concerns loans TO a shareholder)
    // does not apply. Flip the event kinds so the balance reads as the
    // amount owed to the shareholder.
    const flipped = rawEvents.map((e) => ({
      ...e,
      kind: (e.kind === 'advance' ? 'repayment' : 'advance') as AdvanceEvent['kind'],
    }));
    return {
      balanceToday: toDollars(shareholderBalanceAtCents(flipped, todayYmd)),
      deadlines: [],
      activeWarnings: 0,
      seriesFlags: [],
      benefitCurrentYear: null,
    };
  }
  const events = rawEvents;
  const deadlines = advanceDeadlines(events, ctx.anchor, todayYmd, ctx.firstYear);
  // s.80.4 estimate for the current fiscal year to date, when a prescribed rate is set.
  let benefitCurrentYearCents: number | null = null;
  if (loan.prescribedRatePct != null) {
    const fyStart = fiscalYearRangeContaining(ctx.anchor, todayYmd, ctx.firstYear).start;
    benefitCurrentYearCents = shareholderBenefitCents(
      events,
      Number(loan.prescribedRatePct),
      Number(loan.annualRatePct),
      fyStart,
      todayYmd
    );
  }
  return {
    balanceToday: toDollars(shareholderBalanceAtCents(events, todayYmd)),
    deadlines: deadlines.map((d) => ({
      advanceId: d.advance.id ?? null,
      advanceDate: d.advance.date,
      advanceAmount: toDollars(d.advance.amountCents),
      outstanding: toDollars(d.outstandingCents),
      deadline: d.deadline,
      daysRemaining: d.daysRemaining,
      level: d.level,
      message: d.message,
    })),
    activeWarnings: deadlines.filter((d) => d.level != null).length,
    seriesFlags: detectSeriesPatterns(events),
    benefitCurrentYear: benefitCurrentYearCents != null ? toDollars(benefitCurrentYearCents) : null,
  };
}
