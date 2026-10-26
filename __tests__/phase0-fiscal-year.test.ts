/**
 * Phase 0 (P0-5) — one fiscal-year definition.
 *
 * Live bug (Muja): Settings said Jan 1–Dec 31, 2026; Period Close said
 * year-end Dec 29/30; reports used Oct 2–Oct 1. The default P&L opened on
 * Oct 2, 2026–Oct 1, 2027 (all $0) while the trading year was
 * Oct 2, 2025–Oct 1, 2026 ($180,174.75 income).
 */
import {
  anchorMonthDay,
  derivedFiscalYearEnd,
  fiscalYearRangeContaining,
  fiscalYearRangeForLabelYear,
  chooseDefaultFiscalYear,
} from '@/lib/fiscal-year';

const OCT2 = { month: 10, day: 2 };
const JAN1 = { month: 1, day: 1 };

describe('Phase 0 — fiscal year ranges', () => {
  test('label year is the year the FY begins, on every surface', () => {
    const fy = fiscalYearRangeForLabelYear(OCT2, 2025);
    expect(fy).toEqual({ start: '2025-10-02', end: '2026-10-01', labelYear: 2025, label: 'FY 2025' });
  });

  test('calendar-year company: Jan 1 – Dec 31 of the same year', () => {
    expect(fiscalYearRangeForLabelYear(JAN1, 2026)).toEqual({ start: '2026-01-01', end: '2026-12-31', labelYear: 2026, label: 'FY 2026' });
  });

  test('range containing a date honours the anchor day, not Jan 1', () => {
    expect(fiscalYearRangeContaining(OCT2, '2026-09-29').labelYear).toBe(2025);
    expect(fiscalYearRangeContaining(OCT2, '2026-10-01').labelYear).toBe(2025);
    expect(fiscalYearRangeContaining(OCT2, '2026-10-02').labelYear).toBe(2026);
    expect(fiscalYearRangeContaining(OCT2, '2026-01-15').labelYear).toBe(2025);
  });

  test('derived end can never drift from the start (Dec 29/30 bug)', () => {
    expect(derivedFiscalYearEnd('2025-10-02')).toBe('2026-10-01');
    expect(derivedFiscalYearEnd('2026-01-01')).toBe('2026-12-31');
    expect(derivedFiscalYearEnd(new Date(Date.UTC(2025, 9, 2)))).toBe('2026-10-01');
    // Dec 31 anchor stays Dec 30 of the NEXT year (start + 1y − 1d), it does not decay a day per surface
    expect(derivedFiscalYearEnd('2025-12-31')).toBe('2026-12-30');
  });

  test('anchor comes from UTC components / string parts — no local-time day shift', () => {
    expect(anchorMonthDay('2025-10-02T00:00:00.000Z')).toEqual(OCT2);
    expect(anchorMonthDay(new Date(Date.UTC(2026, 0, 1)))).toEqual(JAN1);
  });
});

describe('Phase 0 — default fiscal year for report pages', () => {
  test('Muja scenario: opens on the year WITH the books, not the empty current year', () => {
    const def = chooseDefaultFiscalYear({
      anchor: OCT2,
      todayYmd: '2026-10-26',
      latestIncomeExpenseYmd: '2026-09-29',
      latestJournalYmd: '2026-10-24', // a balance-sheet-only correction in the new FY must not hijack the default
    });
    expect(def.start).toBe('2025-10-02');
    expect(def.end).toBe('2026-10-01');
    expect(def.label).toBe('FY 2025');
  });

  test('actively trading this year: opens on the current year', () => {
    const def = chooseDefaultFiscalYear({
      anchor: OCT2,
      todayYmd: '2026-10-26',
      latestIncomeExpenseYmd: '2026-10-15',
    });
    expect(def.labelYear).toBe(2026);
  });

  test('no activity at all: current fiscal year', () => {
    const def = chooseDefaultFiscalYear({ anchor: JAN1, todayYmd: '2026-10-26' });
    expect(def).toEqual({ start: '2026-01-01', end: '2026-12-31', labelYear: 2026, label: 'FY 2026' });
  });
});
