/**
 * Manual first fiscal year end (Nov 2026).
 *
 * A company may store an explicit first-year end (Company.firstFiscalYearEnd)
 * so its first fiscal year can be shorter or longer than 12 months —
 * e.g. Nexvar Lab Inc.: incorporated Jul 28, 2026, chosen year-end Jul 31,
 * so FY2026 = Jul 28, 2026 → Jul 31, 2027 (369 days) and later years run
 * Aug 1 → Jul 31. With no manual end (null), behaviour must be identical
 * to the Phase 0 anchor-only definition.
 */
import {
  anchorMonthDay,
  fiscalYearRangeForLabelYear,
  fiscalYearRangeContaining,
  chooseDefaultFiscalYear,
  firstFiscalYearOf,
  validateFiscalYearEnd,
  MAX_FISCAL_YEAR_DAYS,
} from '@/lib/fiscal-year';
import { fiscalYearRangeForLabel, fiscalYearStartFor } from '@/lib/reporting';

const NEXVAR_START = '2026-07-28';
const NEXVAR_END = '2027-07-31';
const NEXVAR_ANCHOR = { month: 7, day: 28 };
const NEXVAR_FIRST = { start: NEXVAR_START, end: NEXVAR_END };

describe('firstFiscalYearOf', () => {
  test('null when no manual end is stored', () => {
    expect(firstFiscalYearOf(NEXVAR_START, null)).toBeNull();
    expect(firstFiscalYearOf(NEXVAR_START, undefined)).toBeNull();
  });

  test('null when the stored end is exactly the derived end (automatic, not manual)', () => {
    expect(firstFiscalYearOf(NEXVAR_START, '2027-07-27')).toBeNull();
  });

  test('returns the manual first year when the end differs from derived', () => {
    expect(firstFiscalYearOf(NEXVAR_START, NEXVAR_END)).toEqual(NEXVAR_FIRST);
    expect(firstFiscalYearOf(new Date(Date.UTC(2026, 6, 28)), new Date(Date.UTC(2027, 6, 31)))).toEqual(NEXVAR_FIRST);
  });
});

describe('validateFiscalYearEnd', () => {
  test('accepts the derived 12-month year, a 1-day year, and exactly 371 days', () => {
    expect(validateFiscalYearEnd('2026-07-28', '2027-07-27')).toBeNull();
    expect(validateFiscalYearEnd('2026-07-28', '2026-07-28')).toBeNull();
    expect(validateFiscalYearEnd('2026-07-28', '2027-07-31')).toBeNull(); // Nexvar: 369 days
    // 2026-01-01 + 370 days = 2027-01-06 → 371 days inclusive
    expect(validateFiscalYearEnd('2026-01-01', '2027-01-06')).toBeNull();
    expect(MAX_FISCAL_YEAR_DAYS).toBe(371);
  });

  test('blocks a year longer than 371 days with a clear message', () => {
    const msg = validateFiscalYearEnd('2026-01-01', '2027-01-07'); // 372 days
    expect(msg).toMatch(/371 days \(53 weeks\)/);
  });

  test('blocks an end before the start and impossible dates', () => {
    expect(validateFiscalYearEnd('2026-07-28', '2026-07-27')).toMatch(/on or after/);
    expect(validateFiscalYearEnd('2026-07-28', '2027-02-30')).toMatch(/not a valid date/);
  });
});

describe('ranges with a manual first year (Nexvar: Jul 28 2026 → Jul 31 2027)', () => {
  test('the first year is exactly [start, manual end], labelled by its start year', () => {
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2026, NEXVAR_FIRST))
      .toEqual({ start: '2026-07-28', end: '2027-07-31', labelYear: 2026, label: 'FY 2026' });
  });

  test('later years run day-after-end → end anniversary', () => {
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2027, NEXVAR_FIRST))
      .toEqual({ start: '2027-08-01', end: '2028-07-31', labelYear: 2027, label: 'FY 2027' });
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2028, NEXVAR_FIRST))
      .toEqual({ start: '2028-08-01', end: '2029-07-31', labelYear: 2028, label: 'FY 2028' });
  });

  test('containing: inside first year, on its last day, and in later years', () => {
    expect(fiscalYearRangeContaining(NEXVAR_ANCHOR, '2027-03-15', NEXVAR_FIRST).labelYear).toBe(2026);
    expect(fiscalYearRangeContaining(NEXVAR_ANCHOR, '2027-07-31', NEXVAR_FIRST).labelYear).toBe(2026);
    expect(fiscalYearRangeContaining(NEXVAR_ANCHOR, '2027-08-01', NEXVAR_FIRST))
      .toEqual({ start: '2027-08-01', end: '2028-07-31', labelYear: 2027, label: 'FY 2027' });
    expect(fiscalYearRangeContaining(NEXVAR_ANCHOR, '2028-02-01', NEXVAR_FIRST).labelYear).toBe(2027);
  });

  test('default-year choice honours the manual first year', () => {
    const def = chooseDefaultFiscalYear({
      anchor: NEXVAR_ANCHOR,
      todayYmd: '2026-11-10',
      latestIncomeExpenseYmd: '2026-09-15',
      firstYear: NEXVAR_FIRST,
    });
    expect(def).toEqual({ start: '2026-07-28', end: '2027-07-31', labelYear: 2026, label: 'FY 2026' });
  });
});

describe('ranges with a SHORT manual first year (Jul 28 2026 → Dec 31 2026)', () => {
  const SHORT = { start: '2026-07-28', end: '2026-12-31' };

  test('first year is the stub; later years are calendar years', () => {
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2026, SHORT))
      .toEqual({ start: '2026-07-28', end: '2026-12-31', labelYear: 2026, label: 'FY 2026' });
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2027, SHORT))
      .toEqual({ start: '2027-01-01', end: '2027-12-31', labelYear: 2027, label: 'FY 2027' });
    expect(fiscalYearRangeContaining(NEXVAR_ANCHOR, '2027-06-15', SHORT).labelYear).toBe(2027);
  });
});

describe('no manual end → Phase 0 behaviour unchanged', () => {
  test('anchor ranges are untouched', () => {
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2026))
      .toEqual({ start: '2026-07-28', end: '2027-07-27', labelYear: 2026, label: 'FY 2026' });
    expect(fiscalYearRangeForLabelYear(NEXVAR_ANCHOR, 2026, null))
      .toEqual({ start: '2026-07-28', end: '2027-07-27', labelYear: 2026, label: 'FY 2026' });
    expect(anchorMonthDay(NEXVAR_START)).toEqual(NEXVAR_ANCHOR);
  });
});

describe('reporting.ts (Date-based) with a manual first year', () => {
  const start = new Date(Date.UTC(2026, 6, 28));
  const firstEnd = new Date(Date.UTC(2027, 6, 31));
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  test('range for the first-year label is [start, manual end]', () => {
    const r = fiscalYearRangeForLabel(start, 2026, firstEnd);
    expect(ymd(r.start)).toBe('2026-07-28');
    expect(ymd(r.end)).toBe('2027-07-31');
  });

  test('range for a later label is Aug 1 → Jul 31', () => {
    const r = fiscalYearRangeForLabel(start, 2027, firstEnd);
    expect(ymd(r.start)).toBe('2027-08-01');
    expect(ymd(r.end)).toBe('2028-07-31');
  });

  test('fiscalYearStartFor: inside first year → real start; later → Aug 1', () => {
    expect(ymd(fiscalYearStartFor(start, new Date(2027, 2, 1), firstEnd))).toBe('2026-07-28');
    expect(ymd(fiscalYearStartFor(start, new Date(2027, 8, 1), firstEnd))).toBe('2027-08-01');
    expect(ymd(fiscalYearStartFor(start, new Date(2028, 1, 1), firstEnd))).toBe('2027-08-01');
  });

  test('without a manual end, reporting helpers keep the anchor rule', () => {
    const r = fiscalYearRangeForLabel(start, 2026);
    expect(ymd(r.start)).toBe('2026-07-28');
    expect(ymd(r.end)).toBe('2027-07-27');
    expect(ymd(fiscalYearStartFor(start, new Date(2027, 2, 1)))).toBe('2026-07-28');
  });
});
