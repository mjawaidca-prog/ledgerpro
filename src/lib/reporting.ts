/**
 * Shared balance computation for financial statements.
 *
 * Balance Sheet and P&L both need account balances as of / over a date
 * range that isn't "now" — but ChartOfAccount.balance is a single mutable
 * running total, not time-scoped. These helpers derive real point-in-time
 * (or period) balances from JournalLine activity instead, the same way
 * trial-balance and general-ledger already correctly do it. A voided entry
 * and its reversal are just two rows that net to zero in the aggregation,
 * so no special-casing for void status is needed here.
 */

import { db } from '@/lib/db';
import type { GLType } from '@prisma/client';

export interface AccountActivity {
  debits: number;
  credits: number;
}

/** Sum of debit/credit journal-line activity per GL account code within an optional date range. */
export async function getGLActivity(
  companyId: string,
  range: { from?: Date; to: Date }
): Promise<Record<string, AccountActivity>> {
  const entryDate: any = { lte: range.to };
  if (range.from) entryDate.gte = range.from;

  const lines = await db.journalLine.findMany({
    where: { journalEntry: { companyId, entryDate } },
    select: { glAccountCode: true, debit: true, credit: true },
  });

  const activity: Record<string, AccountActivity> = {};
  for (const line of lines) {
    if (!activity[line.glAccountCode]) activity[line.glAccountCode] = { debits: 0, credits: 0 };
    activity[line.glAccountCode].debits += Number(line.debit);
    activity[line.glAccountCode].credits += Number(line.credit);
  }
  return activity;
}

/** Net balance in an account's normal-balance direction (positive = normal side). */
export function normalBalance(type: GLType, activity: AccountActivity | undefined): number {
  const debits = activity?.debits ?? 0;
  const credits = activity?.credits ?? 0;
  return type === 'asset' || type === 'expense' ? debits - credits : credits - debits;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** The fiscal-year start that contains `asOfDate`, anchored on the company's configured fiscal year start month/day. */
export function fiscalYearStartFor(companyFiscalYearStart: Date, asOfDate: Date): Date {
  const month = companyFiscalYearStart.getMonth();
  const day = companyFiscalYearStart.getDate();
  const year = asOfDate.getFullYear();
  const thisYearStart = new Date(year, month, day);
  const fyStartYear = asOfDate < thisYearStart ? year - 1 : year;
  return new Date(fyStartYear, month, day);
}

/**
 * The [start, end] boundaries of the fiscal year labeled `yearLabel` (the
 * calendar year the fiscal year begins in), anchored on the company's
 * configured fiscal year start month/day — e.g. a company with a July 1
 * fiscal year start and yearLabel 2025 runs 2025-07-01 through 2026-06-30.
 * Calendar-year companies (fiscalYearStart = Jan 1) get plain Jan 1–Dec 31,
 * so this is a safe drop-in replacement wherever `${year}-01-01`/`-12-31`
 * was previously hardcoded.
 */
export function fiscalYearRangeForLabel(
  companyFiscalYearStart: Date,
  yearLabel: number
): { start: Date; end: Date } {
  const month = companyFiscalYearStart.getMonth();
  const day = companyFiscalYearStart.getDate();
  const start = new Date(yearLabel, month, day);
  const end = new Date(yearLabel + 1, month, day);
  end.setDate(end.getDate() - 1);
  return { start, end: endOfDay(end) };
}

/** Splits an account's balance into a trial-balance-style debit/credit pair — exactly one side is non-zero. */
export function toDebitCredit(type: GLType, activity: AccountActivity | undefined): { debit: number; credit: number } {
  const net = normalBalance(type, activity);
  if (type === 'asset' || type === 'expense') {
    return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net };
  }
  return net >= 0 ? { debit: 0, credit: net } : { debit: -net, credit: 0 };
}

/**
 * Format a report period label following accounting convention.
 *
 * Point-in-time reports (Balance Sheet, Trial Balance, AR/AP Aging) use
 * "As at MMMM d, yyyy". Period-range reports (P&L, Cash Flow, GL,
 * Expense Breakdown) use "For the period ended MMMM d, yyyy" for a
 * single end date, or "For the period MMMM d, yyyy to MMMM d, yyyy"
 * when both start and end are provided.
 */
export function formatReportPeriod(
  type: 'point-in-time' | 'period-range',
  endDate: Date | string,
  startDate?: Date | string
): string {
  const fmt = (d: Date | string): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (type === 'point-in-time') {
    return `As at ${fmt(endDate)}`;
  }

  if (startDate) {
    return `For the period ${fmt(startDate)} to ${fmt(endDate)}`;
  }

  return `For the period ended ${fmt(endDate)}`;
}
