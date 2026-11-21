/**
 * Ask-your-books — period resolution (Phase 3 item 4, pure).
 *
 * Questions name periods in words ("this quarter", "last month",
 * "in March 2026"); executors need exact YYYY-MM-DD bounds. This
 * module is the only place those words become dates, and it works
 * entirely on YYYY-MM-DD strings with UTC math — no clocks, no DB.
 *
 * Fiscal years use the ONE house definition: src/lib/fiscal-year.ts
 * (anchored on the month/day of Company.fiscalYearStart, honouring a
 * manually-set first fiscal year). Calendar quarters are calendar
 * quarters. Every resolved period is capped at `today` — the books
 * cannot answer for days that have not happened yet.
 */

import {
  anchorMonthDay,
  firstFiscalYearOf,
  fiscalYearRangeContaining,
  fiscalYearRangeForLabelYear,
} from '@/lib/fiscal-year';

export interface PeriodContext {
  /** YYYY-MM-DD "today" the question is asked on. */
  today: string;
  /** Stored Company.fiscalYearStart (Date or string), or null. */
  fiscalYearStart: Date | string | null;
  /** Stored Company.firstFiscalYearEnd, or null. */
  firstFiscalYearEnd: Date | string | null;
}

export interface ResolvedPeriod {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive, never after ctx.today
  label: string; // plain language, e.g. "Oct 1 – Nov 20, 2026"
  /** Set when the period came from a named period — lets the
   *  comparison be the previous instance of the same named period
   *  ("this quarter" compares against last quarter, not against an
   *  equal-length slice of it). */
  named?: NamedPeriod;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toYmdStr(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

export function ymdParts(ymd: string): { year: number; month: number; day: number } {
  const p = ymd.slice(0, 10).split('-').map(Number);
  return { year: p[0], month: p[1], day: p[2] };
}

export function addDaysYmd(ymd: string, days: number): string {
  const { year, month, day } = ymdParts(ymd);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return toYmdStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function daysBetweenYmd(a: string, b: string): number {
  const pa = ymdParts(a);
  const pb = ymdParts(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000,
  );
}

/** True when `ymd` is a real calendar date in strict YYYY-MM-DD form. */
export function isValidYmd(ymd: unknown): ymd is string {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const { year, month, day } = ymdParts(ymd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}

function monthEnd(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0));
  return toYmdStr(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function formatPeriodLabel(start: string, end: string): string {
  const s = ymdParts(start);
  const e = ymdParts(end);
  const sTxt = `${MONTH_NAMES[s.month - 1].slice(0, 3)} ${s.day}`;
  const eTxt = `${MONTH_NAMES[e.month - 1].slice(0, 3)} ${e.day}`;
  if (start === end) return `${sTxt}, ${s.year}`;
  if (s.year === e.year) return `${sTxt} – ${eTxt}, ${s.year}`;
  return `${sTxt}, ${s.year} – ${eTxt}, ${e.year}`;
}

function cap(
  period: { start: string; end: string; label?: string; named?: NamedPeriod },
  ctx: PeriodContext,
): ResolvedPeriod {
  const end = period.end > ctx.today ? ctx.today : period.end;
  const start = period.start > end ? end : period.start;
  return { start, end, label: period.label ?? formatPeriodLabel(start, end), named: period.named };
}

export const NAMED_PERIODS = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_calendar_year',
  'last_calendar_year',
  'this_fiscal_year',
  'last_fiscal_year',
  'last_30_days',
  'last_90_days',
  'last_12_months',
] as const;

export type NamedPeriod = (typeof NAMED_PERIODS)[number];

export function isNamedPeriod(value: unknown): value is NamedPeriod {
  return typeof value === 'string' && (NAMED_PERIODS as readonly string[]).includes(value);
}

function fiscalRangeContaining(ctx: PeriodContext, ymd: string) {
  if (!ctx.fiscalYearStart) return null;
  const anchor = anchorMonthDay(ctx.fiscalYearStart);
  const firstYear = firstFiscalYearOf(ctx.fiscalYearStart, ctx.firstFiscalYearEnd);
  return fiscalYearRangeContaining(anchor, ymd, firstYear);
}

/** Resolve a named period against the context. Null when it cannot be
 *  resolved (e.g. a fiscal period with no fiscal anchor on file). */
export function resolveNamedPeriod(name: NamedPeriod, ctx: PeriodContext): ResolvedPeriod | null {
  const resolved = resolveNamedPeriodInner(name, ctx);
  return resolved ? { ...resolved, named: name } : null;
}

function resolveNamedPeriodInner(name: NamedPeriod, ctx: PeriodContext): ResolvedPeriod | null {
  const { year, month } = ymdParts(ctx.today);
  switch (name) {
    case 'this_month':
      return cap({ start: toYmdStr(year, month, 1), end: monthEnd(year, month) }, ctx);
    case 'last_month': {
      const first = addDaysYmd(toYmdStr(year, month, 1), -1);
      const p = ymdParts(first);
      return { start: toYmdStr(p.year, p.month, 1), end: first, label: formatPeriodLabel(toYmdStr(p.year, p.month, 1), first) };
    }
    case 'this_quarter': {
      const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return cap({ start: toYmdStr(year, qStartMonth, 1), end: monthEnd(year, qStartMonth + 2) }, ctx);
    }
    case 'last_quarter': {
      const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const end = addDaysYmd(toYmdStr(year, qStartMonth, 1), -1);
      const e = ymdParts(end);
      const start = toYmdStr(e.year, Math.floor((e.month - 1) / 3) * 3 + 1, 1);
      return { start, end, label: formatPeriodLabel(start, end) };
    }
    case 'this_calendar_year':
      return cap({ start: toYmdStr(year, 1, 1), end: toYmdStr(year, 12, 31) }, ctx);
    case 'last_calendar_year':
      return {
        start: toYmdStr(year - 1, 1, 1),
        end: toYmdStr(year - 1, 12, 31),
        label: formatPeriodLabel(toYmdStr(year - 1, 1, 1), toYmdStr(year - 1, 12, 31)),
      };
    case 'this_fiscal_year': {
      const fy = fiscalRangeContaining(ctx, ctx.today);
      if (!fy) return null;
      return cap({ start: fy.start, end: fy.end, label: `${fy.label} (${formatPeriodLabel(fy.start, fy.end > ctx.today ? ctx.today : fy.end)})` }, ctx);
    }
    case 'last_fiscal_year': {
      if (!ctx.fiscalYearStart) return null;
      const anchor = anchorMonthDay(ctx.fiscalYearStart);
      const firstYear = firstFiscalYearOf(ctx.fiscalYearStart, ctx.firstFiscalYearEnd);
      const current = fiscalYearRangeContaining(anchor, ctx.today, firstYear);
      const fy = fiscalYearRangeForLabelYear(anchor, current.labelYear - 1, firstYear);
      return { start: fy.start, end: fy.end, label: `${fy.label} (${formatPeriodLabel(fy.start, fy.end)})` };
    }
    case 'last_30_days':
      return { start: addDaysYmd(ctx.today, -29), end: ctx.today, label: `the last 30 days (${formatPeriodLabel(addDaysYmd(ctx.today, -29), ctx.today)})` };
    case 'last_90_days':
      return { start: addDaysYmd(ctx.today, -89), end: ctx.today, label: `the last 90 days (${formatPeriodLabel(addDaysYmd(ctx.today, -89), ctx.today)})` };
    case 'last_12_months':
      return { start: addDaysYmd(ctx.today, -364), end: ctx.today, label: `the last 12 months (${formatPeriodLabel(addDaysYmd(ctx.today, -364), ctx.today)})` };
    default:
      return null;
  }
}

/** Resolve "in March 2026" / "March" (when the year is omitted, the
 *  most recent March — a future month means last year's). */
export function resolveMonthPeriod(month1: number, year: number | null, ctx: PeriodContext): ResolvedPeriod {
  let y = year ?? ymdParts(ctx.today).year;
  if (year === null && toYmdStr(y, month1, 1) > ctx.today) y -= 1;
  return cap(
    { start: toYmdStr(y, month1, 1), end: monthEnd(y, month1), label: `${MONTH_NAMES[month1 - 1]} ${y}` },
    ctx,
  );
}

/**
 * The comparison period for a resolved period: the equal-length period
 * immediately before it — the same rule the Profit & Loss report uses
 * for its prior-period comparison.
 */
export function priorPeriodOf(period: ResolvedPeriod): ResolvedPeriod {
  const lengthDays = daysBetweenYmd(period.start, period.end); // inclusive span − 1
  const end = addDaysYmd(period.start, -1);
  const start = addDaysYmd(end, -lengthDays);
  return { start, end, label: formatPeriodLabel(start, end) };
}

const NAMED_COMPARISON: Partial<Record<NamedPeriod, NamedPeriod>> = {
  this_month: 'last_month',
  this_quarter: 'last_quarter',
  this_calendar_year: 'last_calendar_year',
  this_fiscal_year: 'last_fiscal_year',
};

/**
 * The comparison a person means: for a named current period, the
 * previous instance of that same period (this quarter ↔ last
 * quarter); for anything else, the equal-length period before it.
 */
export function comparisonPeriodOf(period: ResolvedPeriod, ctx: PeriodContext): ResolvedPeriod {
  if (period.named && NAMED_COMPARISON[period.named]) {
    const previous = resolveNamedPeriod(NAMED_COMPARISON[period.named] as NamedPeriod, ctx);
    if (previous) return previous;
  }
  return priorPeriodOf(period);
}
