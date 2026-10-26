/**
 * Phase 0 (P0-5) — the ONE fiscal-year definition, as pure functions.
 *
 * Before this module, the fiscal year was computed independently in at
 * least four places (Company Settings form, Period Close page, the
 * useFiscalYear hook, and the report routes in src/lib/reporting.ts) —
 * and they disagreed: Settings showed Jan 1–Dec 31, Period Close derived
 * Dec 29/30 (a UTC-midnight date parsed as local time in North America
 * shifts a day), and reports used Oct 2–Oct 1 for the same company.
 *
 * The definition, everywhere, is now:
 *   - A company's fiscal year is anchored ONLY on the month/day of
 *     Company.fiscalYearStart (the year stored in that date is the year
 *     the company first started using it, not part of the anchor).
 *   - A fiscal year runs from that month/day, for one year, ending the
 *     day before the next anniversary. FiscalYearEnd is DERIVED from the
 *     start — never an independent value (the API re-derives it on save).
 *   - A fiscal year is labelled "FY <year>" where <year> is the calendar
 *     year in which the fiscal year BEGINS. Every report uses this label
 *     for the same range.
 *
 * All functions here work on YYYY-MM-DD strings / explicit Y-M-D parts so
 * no timezone conversion can shift a day. Stored DateTime values are
 * UTC-midnight (see reporting.ts), so their UTC components are the anchor.
 */

export interface FiscalYearRange {
  /** YYYY-MM-DD, first day of the fiscal year. */
  start: string;
  /** YYYY-MM-DD, last day of the fiscal year. */
  end: string;
  /** Calendar year in which the fiscal year begins — the "FY <labelYear>" label. */
  labelYear: number;
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toYmd(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

/** Extract {month (1-12), day} anchor from a stored start date (string prefix or UTC components of a Date). */
export function anchorMonthDay(storedStart: string | Date): { month: number; day: number } {
  if (typeof storedStart === 'string') {
    const parts = storedStart.slice(0, 10).split('-').map(Number);
    return { month: parts[1], day: parts[2] };
  }
  return { month: storedStart.getUTCMonth() + 1, day: storedStart.getUTCDate() };
}

function ymdParts(ymd: string): { year: number; month: number; day: number } {
  const p = ymd.slice(0, 10).split('-').map(Number);
  return { year: p[0], month: p[1], day: p[2] };
}

/** The fiscal year (anchored on month/day) that begins in `labelYear`. */
export function fiscalYearRangeForLabelYear(
  anchor: { month: number; day: number },
  labelYear: number
): FiscalYearRange {
  const start = toYmd(labelYear, anchor.month, anchor.day);
  // End = start + 1 year − 1 day, via UTC date math on the components so
  // month/year rollovers (including leap years) behave.
  const endDate = new Date(Date.UTC(labelYear + 1, anchor.month - 1, anchor.day));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = toYmd(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate());
  return { start, end, labelYear, label: `FY ${labelYear}` };
}

/** The fiscal year containing `dateYmd` (YYYY-MM-DD). */
export function fiscalYearRangeContaining(
  anchor: { month: number; day: number },
  dateYmd: string
): FiscalYearRange {
  const { year, month, day } = ymdParts(dateYmd);
  const startsThisYear = month > anchor.month || (month === anchor.month && day >= anchor.day);
  return fiscalYearRangeForLabelYear(anchor, startsThisYear ? year : year - 1);
}

/**
 * The stored fiscalYearEnd that corresponds to a stored fiscalYearStart.
 * The end keeps the START's calendar year context: for a start stored as
 * 2025-10-02, the matching end is 2026-10-01. Used by the companies API to
 * re-derive the end on every save so the two fields can never drift apart
 * (the Dec 29/30 bug) again.
 */
export function derivedFiscalYearEnd(storedStart: string | Date): string {
  const anchor = anchorMonthDay(storedStart);
  const startYear = typeof storedStart === 'string'
    ? ymdParts(storedStart).year
    : storedStart.getUTCFullYear();
  return fiscalYearRangeForLabelYear(anchor, startYear).end;
}

/**
 * Which fiscal year report pages should open on.
 *
 * Rule (Phase 0): the fiscal year containing the most recent
 * income/expense activity — a business that has traded this year opens on
 * this year; a business whose books were last posted in the prior fiscal
 * year (e.g. year-end books opened after year-end) opens on THAT year,
 * not on an empty current year. With no income/expense activity at all,
 * fall back to the latest journal activity, then to the current fiscal
 * year containing today.
 */
export function chooseDefaultFiscalYear(input: {
  anchor: { month: number; day: number };
  todayYmd: string;
  latestIncomeExpenseYmd?: string | null;
  latestJournalYmd?: string | null;
}): FiscalYearRange {
  const activity = input.latestIncomeExpenseYmd || input.latestJournalYmd;
  if (activity) return fiscalYearRangeContaining(input.anchor, activity);
  return fiscalYearRangeContaining(input.anchor, input.todayYmd);
}

/** Human month/day for labels, e.g. anchor Oct 2 → year-end "Oct 1". No Date parsing, so no TZ shift. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fiscalYearMonthDayLabel(anchor: { month: number; day: number }): { startLabel: string; endLabel: string } {
  const endAnchor = (() => {
    const d = new Date(Date.UTC(2001, anchor.month - 1, anchor.day));
    d.setUTCDate(d.getUTCDate() - 1);
    return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  })();
  return {
    startLabel: `${MONTH_NAMES[anchor.month - 1]} ${anchor.day}`,
    endLabel: `${MONTH_NAMES[endAnchor.month - 1]} ${endAnchor.day}`,
  };
}
