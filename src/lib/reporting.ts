/**
 * Shared balance computation for financial statements.
 *
 * Fiscal-year definition: see src/lib/fiscal-year.ts (Phase 0, P0-5) —
 * anchored only on the month/day of Company.fiscalYearStart, labelled by
 * the calendar year the fiscal year begins. The helpers below implement
 * that same definition for server-side Date inputs; do not introduce a
 * second definition here.
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

export type EarningsAccount = { code: string; type: string };

/**
 * Net earnings (income − expense) implied by a set of journal activity.
 * This is THE shared earnings definition for every balance-sheet builder:
 * income/expense accounts are stated in their normal-balance direction, so
 * the result is exactly the amount that must sit in equity for the balance
 * sheet to balance when no closing entries have been posted. When closing
 * entries HAVE been posted they debit income / credit expense and credit
 * retained earnings, so this figure automatically shrinks to the unclosed
 * remainder — it never double-counts closed earnings.
 */
export function netEarnings(
  activity: Record<string, AccountActivity>,
  accounts: EarningsAccount[]
): number {
  let total = 0;
  for (const a of accounts) {
    if (a.type === 'income') total += normalBalance('income', activity[a.code]);
    else if (a.type === 'expense') total -= normalBalance('expense', activity[a.code]);
  }
  return Math.round(total * 100) / 100;
}

export interface UnclosedEarnings {
  /** Earnings from every period in `activityToDate` (all activity up to as-of). */
  cumulative: number;
  /** Earnings inside the current fiscal year only. */
  currentYear: number;
  /** Earnings before the current fiscal year that have not been closed to a named equity account. */
  priorYears: number;
}

/**
 * Phase 0 fix (P0-2): the balance sheet previously added ONLY the current
 * fiscal year's earnings to equity. Any income earned in a prior fiscal year
 * (e.g. a business whose year-end has passed but whose books were never
 * formally closed) vanished from equity, so Assets ≠ Liabilities + Equity
 * even though the trial balance — which lists income/expense accounts
 * directly — balanced perfectly.
 */
export function unclosedEarnings(
  activityToDate: Record<string, AccountActivity>,
  currentYearActivity: Record<string, AccountActivity>,
  accounts: EarningsAccount[]
): UnclosedEarnings {
  const cumulative = netEarnings(activityToDate, accounts);
  const currentYear = netEarnings(currentYearActivity, accounts);
  const priorYears = Math.round((cumulative - currentYear) * 100) / 100;
  return { cumulative, currentYear, priorYears };
}

/**
 * Balance-sheet totals from normal-balance account balances plus the
 * CUMULATIVE unclosed earnings. Shared by the dashboard route and the v1
 * API builder so the two can never disagree about whether a company balances.
 */
export function balanceSheetTotals(input: {
  assetBalances: number[];
  liabilityBalances: number[];
  equityAccountBalances: number[];
  cumulativeUnclosedEarnings: number;
}): { totalAssets: number; totalLiabilities: number; totalEquity: number; totalLiabilitiesAndEquity: number; isBalanced: boolean } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const totalAssets = round(input.assetBalances.reduce((s, n) => s + n, 0));
  const totalLiabilities = round(input.liabilityBalances.reduce((s, n) => s + n, 0));
  const totalEquity = round(input.equityAccountBalances.reduce((s, n) => s + n, 0) + input.cumulativeUnclosedEarnings);
  const totalLiabilitiesAndEquity = round(totalLiabilities + totalEquity);
  return {
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
  };
}

type ClassifiableAccount = { code: string; type: string; subType?: string | null; detailType?: string | null; name?: string | null };

const NON_CURRENT_ASSET_HINTS = ['fixed asset', 'property', 'equipment', 'vehicle', 'intangible', 'long-term investment', 'long term investment'];
const NON_CURRENT_LIABILITY_HINTS = ['long-term', 'long term', 'loan', 'mortgage', 'note payable'];

/**
 * Current vs non-current classification, shared by the balance sheet.
 *
 * Phase 0 fix (P0-2): the previous fallback classified an asset purely by
 * code range (`code < 2000`), so a legitimately-created asset account coded
 * in the 3xxx range (e.g. 3010 "Due from Shareholder / Shareholder Draws",
 * created because the 1xxx range was full or by an accountant's own chart)
 * was silently shown as a NON-current asset. Explicit subType still wins;
 * otherwise detail/name hints win; only then does a narrow code fallback
 * apply (15xx–18xx fixed-asset range for assets, 25xx+ for liabilities).
 * A due-from-shareholder balance is a current asset by default: it is
 * repayable on demand in the small-corporation charts this product serves.
 */
export function isCurrentAccount(a: ClassifiableAccount): boolean {
  if (a.subType) {
    if (a.type === 'asset') return a.subType === 'current_asset';
    if (a.type === 'liability') return a.subType === 'current_liability';
  }
  const hint = `${a.detailType ?? ''} ${a.name ?? ''}`.toLowerCase();
  if (hint.includes('shareholder') || hint.includes('due from')) return true;
  const n = parseInt(a.code, 10);
  if (a.type === 'asset') {
    if (NON_CURRENT_ASSET_HINTS.some((h) => hint.includes(h))) return false;
    return !(n >= 1500 && n < 1900);
  }
  if (a.type === 'liability') {
    if (NON_CURRENT_LIABILITY_HINTS.some((h) => hint.includes(h))) return false;
    return !(n >= 2500 && n < 3000);
  }
  return true;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Parse a Prisma DateTime to safe month/day numbers. Prisma Date objects
 * are constructed as UTC midnight; .getMonth()/.getDate() use local time,
 * which shifts dates to the previous day in timezones behind UTC (all of
 * North America). .getUTCMonth()/.getUTCDate() avoid the shift and return
 * the date as stored in the database.
 */
function utcMonthDay(date: Date): { month: number; day: number } {
  return { month: date.getUTCMonth(), day: date.getUTCDate() };
}

/** The fiscal-year start that contains `asOfDate`, anchored on the company's configured fiscal year start month/day. */
export function fiscalYearStartFor(companyFiscalYearStart: Date, asOfDate: Date): Date {
  const { month, day } = utcMonthDay(companyFiscalYearStart);
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
  const { month, day } = utcMonthDay(companyFiscalYearStart);
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
  // Parse a YYYY-MM-DD string as local time — new Date("2025-11-30")
  // parses as UTC midnight which shifts to the previous day in
  // timezones behind UTC (all of North America).
  const parseLocal = (d: Date | string): Date => {
    if (d instanceof Date) return d;
    const parts = d.split('-');
    if (parts.length === 3) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(d);
  };

  const fmt = (d: Date | string): string => {
    const date = parseLocal(d);
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

/**
 * Parse a YYYY-MM-DD string as a local-midnight Date.
 * Safe alternative to new Date(str) which treats the string as UTC and shifts
 * the date by one day in timezones behind UTC.
 */
export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.slice(0, 10).split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(dateStr);
}
