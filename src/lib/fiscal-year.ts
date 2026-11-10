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
 * Manual first fiscal year (Nov 2026): a company may store an explicit
 * first-year end in Company.firstFiscalYearEnd — e.g. incorporated
 * Jul 28, 2026 with a chosen Jul 31 year-end, so the first year runs
 * Jul 28, 2026 → Jul 31, 2027 (369 days) and later years run Aug 1 → Jul 31.
 * When a FirstFiscalYear is supplied, the first year is exactly
 * [start, firstEnd] and every later year is anchored on the day after
 * firstEnd. When it is absent (null), everything behaves exactly as the
 * original anchor-only definition above — existing companies are
 * unaffected until an owner sets an end explicitly.
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

/**
 * A manually-set first fiscal year: the company's actual first day of
 * books and the explicit last day of its first fiscal year (both
 * YYYY-MM-DD). See the module header — later years anchor on the day
 * after `end`.
 */
export interface FirstFiscalYear {
  start: string;
  end: string;
}

/** Longest permitted fiscal year: 371 days = 53 weeks (CRA first-year maximum). */
export const MAX_FISCAL_YEAR_DAYS = 371;

function toStoredYmd(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return toYmd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

/**
 * Build the FirstFiscalYear for a company from its stored start and its
 * stored firstFiscalYearEnd. Returns null when no manual end is stored,
 * or when the stored end is exactly the derived end (start + 1y − 1d) —
 * that is the automatic value, not a manual choice.
 */
export function firstFiscalYearOf(
  storedStart: string | Date,
  storedFirstEnd: string | Date | null | undefined
): FirstFiscalYear | null {
  if (!storedFirstEnd) return null;
  const start = toStoredYmd(storedStart);
  const end = toStoredYmd(storedFirstEnd);
  if (end === derivedFiscalYearEnd(storedStart)) return null;
  return { start, end };
}

/** The recurring start anchor (month/day) implied by a manual first year: the day after its end. */
function recurringAnchor(firstYear: FirstFiscalYear): { month: number; day: number } {
  const e = ymdParts(firstYear.end);
  const d = new Date(Date.UTC(e.year, e.month - 1, e.day));
  d.setUTCDate(d.getUTCDate() + 1);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Validate a manually chosen fiscal year end against the fiscal year
 * start. Returns a human-readable error, or null when valid. A fiscal
 * year must be at least 1 day (end on/after start) and at most
 * MAX_FISCAL_YEAR_DAYS long (371 days / 53 weeks — the CRA maximum for a
 * new corporation's first tax year).
 */
export function validateFiscalYearEnd(startYmd: string, endYmd: string): string | null {
  const start = ymdParts(String(startYmd).slice(0, 10));
  const end = ymdParts(String(endYmd).slice(0, 10));
  const sMs = Date.UTC(start.year, start.month - 1, start.day);
  const eMs = Date.UTC(end.year, end.month - 1, end.day);
  // Date.UTC normalizes impossible dates (Feb 30 → Mar 2); reject them.
  const sCheck = new Date(sMs);
  if (sCheck.getUTCFullYear() !== start.year || sCheck.getUTCMonth() + 1 !== start.month || sCheck.getUTCDate() !== start.day) {
    return 'Fiscal year start is not a valid date.';
  }
  const eCheck = new Date(eMs);
  if (eCheck.getUTCFullYear() !== end.year || eCheck.getUTCMonth() + 1 !== end.month || eCheck.getUTCDate() !== end.day) {
    return 'Fiscal year end is not a valid date.';
  }
  const days = Math.round((eMs - sMs) / 86400000) + 1;
  if (days < 1) return 'Fiscal year end must be on or after the fiscal year start.';
  if (days > MAX_FISCAL_YEAR_DAYS) {
    return `That year-end makes the fiscal year ${days} days long. A fiscal year can be at most ${MAX_FISCAL_YEAR_DAYS} days (53 weeks) — the CRA limit for a corporation's first tax year. Choose an earlier year-end.`;
  }
  return null;
}

/** The fiscal year (anchored on month/day) that begins in `labelYear`. */
export function fiscalYearRangeForLabelYear(
  anchor: { month: number; day: number },
  labelYear: number,
  firstYear?: FirstFiscalYear | null
): FiscalYearRange {
  if (firstYear) {
    const firstLabelYear = ymdParts(firstYear.start).year;
    if (labelYear === firstLabelYear) {
      return { start: firstYear.start, end: firstYear.end, labelYear, label: `FY ${labelYear}` };
    }
    if (labelYear > firstLabelYear) {
      // Later years start the day after the first year's end and end on
      // the first-end's month/day anniversary.
      const rec = recurringAnchor(firstYear);
      const ey = ymdParts(firstYear.end);
      const start = toYmd(labelYear, rec.month, rec.day);
      let end = toYmd(labelYear, ey.month, ey.day);
      if (end <= start) end = toYmd(labelYear + 1, ey.month, ey.day);
      return { start, end, labelYear, label: `FY ${labelYear}` };
    }
    // labelYear before the first year: fall through to the anchor rule
    // (pre-incorporation years behave exactly as before).
  }
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
  dateYmd: string,
  firstYear?: FirstFiscalYear | null
): FiscalYearRange {
  if (firstYear) {
    const firstLabelYear = ymdParts(firstYear.start).year;
    if (dateYmd >= firstYear.start && dateYmd <= firstYear.end) {
      return { start: firstYear.start, end: firstYear.end, labelYear: firstLabelYear, label: `FY ${firstLabelYear}` };
    }
    if (dateYmd > firstYear.end) {
      const rec = recurringAnchor(firstYear);
      const { year, month, day } = ymdParts(dateYmd);
      const startsThisYear = month > rec.month || (month === rec.month && day >= rec.day);
      return fiscalYearRangeForLabelYear(anchor, startsThisYear ? year : year - 1, firstYear);
    }
    // Dates before the first year starts: fall through to the anchor rule.
  }
  const { year, month, day } = ymdParts(dateYmd);
  const startsThisYear = month > anchor.month || (month === anchor.month && day >= anchor.day);
  return fiscalYearRangeForLabelYear(anchor, startsThisYear ? year : year - 1, firstYear);
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
  firstYear?: FirstFiscalYear | null;
}): FiscalYearRange {
  const activity = input.latestIncomeExpenseYmd || input.latestJournalYmd;
  if (activity) return fiscalYearRangeContaining(input.anchor, activity, input.firstYear);
  return fiscalYearRangeContaining(input.anchor, input.todayYmd, input.firstYear);
}

/** Human month/day for labels, e.g. anchor Oct 2 → year-end "Oct 1". No Date parsing, so no TZ shift. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fiscalYearMonthDayLabel(
  anchor: { month: number; day: number },
  firstYear?: FirstFiscalYear | null
): { startLabel: string; endLabel: string } {
  if (firstYear) {
    // The label describes the recurring cycle: years begin the day after
    // the manual year-end (the first year itself may begin earlier, on
    // the company's actual start date).
    const rec = recurringAnchor(firstYear);
    const e = ymdParts(firstYear.end);
    return {
      startLabel: `${MONTH_NAMES[rec.month - 1]} ${rec.day}`,
      endLabel: `${MONTH_NAMES[e.month - 1]} ${e.day}`,
    };
  }
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
