/**
 * Loan amortization engine — pure functions, no database, no I/O.
 *
 * Improvement plan Phase 1, item 3 (DESIGN-TAX-DOMAIN.md §4.1). A loan is
 * created once from its real paperwork and the engine does everything
 * after: real paperwork (e.g. a Ford Credit statement) states the PAYMENT
 * and not always the rate or term, so the schedule solves for whichever
 * variable is missing — payment from rate & term, or term from payment.
 *
 * Conventions:
 *   - All money is integer cents. Interest is rounded to the cent each
 *     period, the way a lender statement rounds it; the final payment
 *     absorbs the accumulated rounding so the schedule closes at exactly
 *     the balloon amount (usually zero) — never a residual cent.
 *   - All dates are YYYY-MM-DD strings with UTC math (the fiscal-year.ts
 *     convention), so no timezone can shift a payment date.
 *   - The periodic rate converts the nominal annual rate through the
 *     compounding convention: r = (1 + nominal/cpy)^(cpy/ppy) − 1.
 *     Monthly compounding with monthly payments gives nominal/12;
 *     Canadian mortgages (cpy = 2) get the proper semi-annual conversion.
 */

import {
  fiscalYearRangeContaining,
  type FirstFiscalYear,
} from '@/lib/fiscal-year';

export type LoanFrequency = 'monthly' | 'biweekly' | 'weekly';

export function paymentsPerYear(frequency: LoanFrequency): number {
  switch (frequency) {
    case 'monthly':
      return 12;
    case 'biweekly':
      return 26;
    case 'weekly':
      return 52;
  }
}

/** Periodic interest rate (a fraction, e.g. 0.0058) for one payment period. */
export function periodicRate(
  annualRatePct: number,
  compoundingPerYear: number | null | undefined,
  frequency: LoanFrequency
): number {
  const ppy = paymentsPerYear(frequency);
  const cpy = compoundingPerYear ?? ppy;
  const nominal = annualRatePct / 100;
  if (nominal <= 0) return 0;
  return Math.pow(1 + nominal / cpy, cpy / ppy) - 1;
}

// ─── Date helpers (YYYY-MM-DD, UTC) ───

function ymdParts(ymd: string): { year: number; month: number; day: number } {
  const p = ymd.slice(0, 10).split('-').map(Number);
  return { year: p[0], month: p[1], day: p[2] };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Whole days from a to b (b − a); negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  const pa = ymdParts(a);
  const pb = ymdParts(b);
  const ms =
    Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86400000);
}

export function addDays(ymd: string, days: number): string {
  const p = ymdParts(ymd);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return toYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Same month/day one year later; Feb 29 clamps to Feb 28. */
export function addOneYear(ymd: string): string {
  const p = ymdParts(ymd);
  const day = Math.min(p.day, daysInMonth(p.year + 1, p.month));
  return toYmd(p.year + 1, p.month, day);
}

/**
 * The payment date `periods` steps after `firstPaymentDate`. Monthly
 * payments keep the anchor day (Jan 31 → Feb 28 → Mar 31, never drifting
 * to Mar 28); weekly/biweekly step by whole weeks.
 */
export function paymentDateAt(
  firstPaymentDate: string,
  frequency: LoanFrequency,
  periods: number
): string {
  if (frequency === 'weekly') return addDays(firstPaymentDate, periods * 7);
  if (frequency === 'biweekly') return addDays(firstPaymentDate, periods * 14);
  const p = ymdParts(firstPaymentDate);
  const totalMonths = p.year * 12 + (p.month - 1) + periods;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return toYmd(year, month, day);
}

// ─── Schedule ───

export interface ScheduleInput {
  principalCents: number;
  annualRatePct: number;
  compoundingPerYear?: number | null;
  frequency: LoanFrequency;
  firstPaymentDate: string; // YYYY-MM-DD of period 1
  /** Stated payment (solves the term) — or null to solve from the term. */
  paymentCents?: number | null;
  /** Stated number of payments (solves the payment) — or null. */
  numberOfPayments?: number | null;
  /** Balance still owing after the last scheduled payment. Default 0. */
  balloonCents?: number | null;
  /** Opening balance when (re)building a tail; defaults to principalCents. */
  openingBalanceCents?: number;
  /** Period number of the first row when (re)building a tail. Default 1. */
  startPeriod?: number;
}

export interface ScheduleRow {
  period: number;
  date: string; // YYYY-MM-DD
  openingCents: number;
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  closingCents: number;
}

export interface ScheduleResult {
  rows: ScheduleRow[];
  /** The regular payment used (the solved one when it was solved). */
  paymentCents: number;
  numberOfPayments: number;
  totalInterestCents: number;
  totalPaymentsCents: number;
}

const MAX_PERIODS = 1200; // 100 years of monthly payments — a runaway guard, not a product limit

/**
 * The level payment that amortizes `principalCents` to `balloonCents`
 * over `numberOfPayments` periods at periodic rate `r`.
 */
export function solvePaymentCents(
  principalCents: number,
  r: number,
  numberOfPayments: number,
  balloonCents = 0
): number {
  if (numberOfPayments <= 0) throw new Error('Number of payments must be positive.');
  if (r <= 0) {
    return Math.round((principalCents - balloonCents) / numberOfPayments);
  }
  const v = 1 / (1 + r);
  const vn = Math.pow(v, numberOfPayments);
  return Math.round(((principalCents - balloonCents * vn) * r) / (1 - vn));
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const balloon = input.balloonCents ?? 0;
  const opening0 = input.openingBalanceCents ?? input.principalCents;
  const startPeriod = input.startPeriod ?? 1;
  const r = periodicRate(input.annualRatePct, input.compoundingPerYear, input.frequency);

  if (opening0 <= balloon) {
    throw new Error('Loan balance must be greater than the balloon amount.');
  }

  let payment: number;
  let term: number | null = null;
  if (input.paymentCents != null && input.paymentCents > 0) {
    payment = input.paymentCents;
    // A payment that does not cover the first period's interest never amortizes.
    const firstInterest = Math.round(opening0 * r);
    if (payment <= firstInterest && opening0 > balloon) {
      throw new Error(
        'The payment does not cover the interest on the opening balance — the loan would never be repaid. Increase the payment or lower the rate.'
      );
    }
  } else if (input.numberOfPayments != null && input.numberOfPayments > 0) {
    term = input.numberOfPayments;
    payment = solvePaymentCents(opening0, r, term, balloon);
  } else {
    throw new Error('A loan schedule needs either a payment amount or a number of payments.');
  }

  const rows: ScheduleRow[] = [];
  let balance = opening0;
  let totalInterest = 0;
  let totalPayments = 0;

  for (let i = 0; i < MAX_PERIODS; i++) {
    const period = startPeriod + i;
    const interest = Math.round(balance * r);
    const isLastByTerm = term != null && i === term - 1;
    const paysOff = balance + interest - payment <= balloon;
    let pay: number;
    let principalPart: number;
    if (isLastByTerm || paysOff) {
      // Final payment: exactly what closes the loan at the balloon amount.
      pay = balance + interest - balloon;
      principalPart = balance - balloon;
    } else {
      pay = payment;
      principalPart = payment - interest;
    }
    const closing = balance - principalPart;
    rows.push({
      period,
      date: paymentDateAt(input.firstPaymentDate, input.frequency, i),
      openingCents: balance,
      paymentCents: pay,
      interestCents: interest,
      principalCents: principalPart,
      closingCents: closing,
    });
    totalInterest += interest;
    totalPayments += pay;
    balance = closing;
    if (closing <= balloon) break;
    if (term != null && i >= term - 1) break;
  }

  return {
    rows,
    paymentCents: payment,
    numberOfPayments: rows.length,
    totalInterestCents: totalInterest,
    totalPaymentsCents: totalPayments,
  };
}

// ─── Reading a schedule ───

/** Balance owed after the last payment due on or before `asOfYmd`. */
export function scheduleBalanceAtCents(
  rows: ScheduleRow[],
  principalCents: number,
  asOfYmd: string
): number {
  let balance = principalCents;
  for (const row of rows) {
    if (row.date <= asOfYmd) balance = row.closingCents;
    else break;
  }
  return balance;
}

/** Principal falling due in the 12 months after `asOfYmd` (the current portion). */
export function currentPortionCents(rows: ScheduleRow[], asOfYmd: string): number {
  const horizon = addOneYear(asOfYmd);
  return rows
    .filter((row) => row.date > asOfYmd && row.date <= horizon)
    .reduce((sum, row) => sum + row.principalCents, 0);
}

export interface FiscalYearLoanTotals {
  labelYear: number;
  label: string;
  start: string;
  end: string;
  interestCents: number;
  principalCents: number;
  paymentsCents: number;
  paymentCount: number;
}

/**
 * Interest (and principal / payments) sliced by the CORPORATION's fiscal
 * year — the figure the T2 needs (GIFI 8710), computed on the company's
 * own year-end, never the calendar year. Interest is attributed to the
 * fiscal year containing the payment date.
 */
export function fiscalYearTotals(
  rows: ScheduleRow[],
  anchor: { month: number; day: number },
  firstYear?: FirstFiscalYear | null
): FiscalYearLoanTotals[] {
  const byLabel = new Map<number, FiscalYearLoanTotals>();
  for (const row of rows) {
    const fy = fiscalYearRangeContaining(anchor, row.date, firstYear ?? null);
    let bucket = byLabel.get(fy.labelYear);
    if (!bucket) {
      bucket = {
        labelYear: fy.labelYear,
        label: fy.label,
        start: fy.start,
        end: fy.end,
        interestCents: 0,
        principalCents: 0,
        paymentsCents: 0,
        paymentCount: 0,
      };
      byLabel.set(fy.labelYear, bucket);
    }
    bucket.interestCents += row.interestCents;
    bucket.principalCents += row.principalCents;
    bucket.paymentsCents += row.paymentCents;
    bucket.paymentCount += 1;
  }
  return [...byLabel.values()].sort((a, b) => a.labelYear - b.labelYear);
}

// ─── Money conversion (Prisma Decimals cross the API as numbers) ───

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function toDollars(cents: number): number {
  return cents / 100;
}
