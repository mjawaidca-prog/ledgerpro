/**
 * Loan & interest tool (improvement plan Phase 1, item 3).
 *
 * The expected values below are hand-computed from the standard
 * amortization formulas (level payment = P·r / (1 − (1+r)^−n), interest
 * rounded to the cent each period, final payment absorbing the
 * rounding) and cross-checked against an independent calculation —
 * they are not snapshots of whatever the engine happens to output.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSchedule,
  currentPortionCents,
  fiscalYearTotals,
  paymentDateAt,
  periodicRate,
  scheduleBalanceAtCents,
  solvePaymentCents,
} from '@/lib/loans/engine';
import {
  advanceDeadlines,
  detectSeriesPatterns,
  shareholderBalanceAtCents,
  shareholderBenefitCents,
  shareholderDeadlineForAdvance,
  warningLevelFor,
  type AdvanceEvent,
} from '@/lib/loans/shareholder';
import {
  buildSplitJournalLines,
  linesBalanceCents,
  splitActualPayment,
} from '@/lib/loans/journal-lines';

describe('amortization engine — fixed rate, solved from term', () => {
  // Textbook case: $10,000 at 12% nominal, monthly compounding, 12 monthly
  // payments. Payment = 10000 × 0.01 / (1 − 1.01^−12) = $888.4879 → $888.49.
  const s = buildSchedule({
    principalCents: 1_000_000,
    annualRatePct: 12,
    frequency: 'monthly',
    firstPaymentDate: '2026-02-01',
    numberOfPayments: 12,
  });

  test('solves the level payment', () => {
    expect(s.paymentCents).toBe(88849);
    expect(solvePaymentCents(1_000_000, 0.01, 12)).toBe(88849);
  });

  test('first period: interest is exactly 1% of the opening balance', () => {
    expect(s.rows[0]).toEqual({
      period: 1,
      date: '2026-02-01',
      openingCents: 1_000_000,
      paymentCents: 88849,
      interestCents: 10000,
      principalCents: 78849,
      closingCents: 921151,
    });
  });

  test('final payment absorbs the rounding and closes at exactly zero', () => {
    const last = s.rows[s.rows.length - 1];
    expect(s.rows).toHaveLength(12);
    expect(last.paymentCents).toBe(88847); // two cents under the level payment
    expect(last.interestCents).toBe(880);
    expect(last.closingCents).toBe(0);
  });

  test('principal sums to the amount borrowed; interest total is the hand-computed $661.86', () => {
    expect(s.rows.reduce((sum, r) => sum + r.principalCents, 0)).toBe(1_000_000);
    expect(s.totalInterestCents).toBe(66186);
    expect(s.totalPaymentsCents).toBe(1_000_000 + 66186);
  });

  test('every row is internally consistent', () => {
    for (const row of s.rows) {
      expect(row.paymentCents).toBe(row.interestCents + row.principalCents);
      expect(row.closingCents).toBe(row.openingCents - row.principalCents);
    }
  });
});

describe('amortization engine — the vehicle-loan case (Muja / Ford Credit shape)', () => {
  // $35,000 at 6.99%, 60 monthly payments. Payment = $692.88;
  // first interest = 35000 × 0.0699/12 = $203.87 (20387.5 rounds down on
  // the exact binary value), first principal = $489.01.
  const s = buildSchedule({
    principalCents: 3_500_000,
    annualRatePct: 6.99,
    frequency: 'monthly',
    firstPaymentDate: '2026-02-01',
    numberOfPayments: 60,
  });

  test('payment, first split and totals match the hand computation', () => {
    expect(s.paymentCents).toBe(69288);
    expect(s.rows[0].interestCents).toBe(20387);
    expect(s.rows[0].principalCents).toBe(48901);
    expect(s.rows[0].closingCents).toBe(3451099);
    expect(s.totalInterestCents).toBe(657255);
    expect(s.rows).toHaveLength(60);
    expect(s.rows[59].closingCents).toBe(0);
  });
});

describe('amortization engine — solved from the payment (dealer paperwork case)', () => {
  // $10,000 at 12%, paying $500/month: n = −ln(1 − 100/500)/ln(1.01) ≈ 22.43
  // → 23 payments, the last one partial ($213.48).
  const s = buildSchedule({
    principalCents: 1_000_000,
    annualRatePct: 12,
    frequency: 'monthly',
    firstPaymentDate: '2026-02-01',
    paymentCents: 50000,
  });

  test('solves the term and lands the partial final payment', () => {
    expect(s.rows).toHaveLength(23);
    expect(s.rows[22].paymentCents).toBe(21348);
    expect(s.rows[22].closingCents).toBe(0);
    expect(s.totalInterestCents).toBe(121348);
  });

  test('a payment that does not cover interest is refused', () => {
    expect(() =>
      buildSchedule({
        principalCents: 1_000_000,
        annualRatePct: 12,
        frequency: 'monthly',
        firstPaymentDate: '2026-02-01',
        paymentCents: 10000, // exactly the first month's interest
      })
    ).toThrow(/never be repaid/);
  });

  test('neither payment nor term is refused', () => {
    expect(() =>
      buildSchedule({
        principalCents: 1_000_000,
        annualRatePct: 12,
        frequency: 'monthly',
        firstPaymentDate: '2026-02-01',
      })
    ).toThrow(/either a payment amount or a number of payments/);
  });
});

describe('amortization engine — conventions and edge cases', () => {
  test('zero rate splits principal evenly', () => {
    const s = buildSchedule({
      principalCents: 1_200_000,
      annualRatePct: 0,
      frequency: 'monthly',
      firstPaymentDate: '2026-02-01',
      numberOfPayments: 12,
    });
    expect(s.paymentCents).toBe(100000);
    expect(s.totalInterestCents).toBe(0);
    expect(s.rows[11].closingCents).toBe(0);
  });

  test('Canadian mortgage: semi-annual compounding converts to the known $581.60 payment', () => {
    // $100,000 at 5% nominal, compounded semi-annually, 25-year
    // amortization (300 monthly payments) — the standard Canadian figure.
    const s = buildSchedule({
      principalCents: 10_000_000,
      annualRatePct: 5,
      compoundingPerYear: 2,
      frequency: 'monthly',
      firstPaymentDate: '2026-02-01',
      numberOfPayments: 300,
    });
    expect(s.paymentCents).toBe(58160);
    expect(s.rows[0].interestCents).toBe(41239);
    expect(periodicRate(5, 2, 'monthly')).toBeCloseTo(0.004123915, 8);
  });

  test('balloon: the schedule closes at exactly the balloon amount', () => {
    const s = buildSchedule({
      principalCents: 2_000_000,
      annualRatePct: 10,
      frequency: 'monthly',
      firstPaymentDate: '2026-02-01',
      numberOfPayments: 24,
      balloonCents: 1_000_000,
    });
    expect(s.paymentCents).toBe(54478);
    expect(s.rows).toHaveLength(24);
    expect(s.rows[23].closingCents).toBe(1_000_000);
    expect(s.rows.reduce((sum, r) => sum + r.principalCents, 0)).toBe(1_000_000);
  });

  test('biweekly dates step 14 days and interest uses 26 periods a year', () => {
    const s = buildSchedule({
      principalCents: 1_000_000,
      annualRatePct: 12,
      frequency: 'biweekly',
      firstPaymentDate: '2026-02-06',
      numberOfPayments: 26,
    });
    expect(s.rows[0].date).toBe('2026-02-06');
    expect(s.rows[1].date).toBe('2026-02-20');
    expect(s.rows[0].interestCents).toBe(4615); // 10000 × 0.12/26 = $46.15
    expect(s.paymentCents).toBe(40904);
  });

  test('monthly dates keep the anchor day across short months', () => {
    expect(paymentDateAt('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(paymentDateAt('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(paymentDateAt('2026-01-31', 'monthly', 13)).toBe('2027-02-28');
  });

  test('balance-at-date and current portion read off the schedule', () => {
    const s = buildSchedule({
      principalCents: 1_000_000,
      annualRatePct: 12,
      frequency: 'monthly',
      firstPaymentDate: '2026-02-01',
      numberOfPayments: 12,
    });
    expect(scheduleBalanceAtCents(s.rows, 1_000_000, '2026-01-15')).toBe(1_000_000);
    expect(scheduleBalanceAtCents(s.rows, 1_000_000, '2026-02-01')).toBe(921151);
    // All 12 payments fall within the year after 2026-01-15 → the whole
    // principal is the current portion.
    expect(currentPortionCents(s.rows, '2026-01-15')).toBe(1_000_000);
    expect(currentPortionCents(s.rows, '2027-01-01')).toBe(0);
  });
});

describe('fiscal-year interest slicing', () => {
  // Muja's shape: Oct 1 year-end (anchor Oct 1). 24 monthly payments on
  // the 15th starting Nov 15, 2025: FY2025 (Oct 1 2025–Sep 30 2026)
  // holds 11 payments, FY2026 holds 12, FY2027 holds the last one.
  const s = buildSchedule({
    principalCents: 3_500_000,
    annualRatePct: 6.99,
    frequency: 'monthly',
    firstPaymentDate: '2025-11-15',
    numberOfPayments: 24,
  });
  const totals = fiscalYearTotals(s.rows, { month: 10, day: 1 });

  test('payments land in the corporation\u2019s fiscal years, not calendar years', () => {
    expect(totals.map((t) => [t.label, t.paymentCount])).toEqual([
      ['FY 2025', 11],
      ['FY 2026', 12],
      ['FY 2027', 1],
    ]);
    expect(totals[0].start).toBe('2025-10-01');
    expect(totals[0].end).toBe('2026-09-30');
  });

  test('the slices sum back to the schedule totals', () => {
    expect(totals.reduce((sum, t) => sum + t.interestCents, 0)).toBe(s.totalInterestCents);
    expect(totals.reduce((sum, t) => sum + t.principalCents, 0)).toBe(3_500_000);
  });
});

describe('split journal lines', () => {
  test('Dr principal / Dr interest / Cr bank, balanced to the cent', () => {
    const lines = buildSplitJournalLines({
      loanAccountCode: '2510',
      interestAccountCode: '6950',
      paymentAccountCode: '1010',
      principalCents: 48901,
      interestCents: 20387,
      description: 'Loan payment — Ford Credit (payment 1)',
    });
    expect(lines).toEqual([
      { glAccountCode: '2510', description: 'Loan payment — Ford Credit (payment 1) — principal', debit: 489.01, credit: 0 },
      { glAccountCode: '6950', description: 'Loan payment — Ford Credit (payment 1) — interest', debit: 203.87, credit: 0 },
      { glAccountCode: '1010', description: 'Loan payment — Ford Credit (payment 1)', debit: 0, credit: 692.88 },
    ]);
    expect(linesBalanceCents(lines)).toBe(0);
  });

  test('a zero-interest payment posts two lines', () => {
    const lines = buildSplitJournalLines({
      loanAccountCode: '2510',
      interestAccountCode: '6950',
      paymentAccountCode: '1010',
      principalCents: 100000,
      interestCents: 0,
      description: 'Loan payment',
    });
    expect(lines).toHaveLength(2);
    expect(linesBalanceCents(lines)).toBe(0);
  });

  test('interest with no interest account mapped is refused, not dropped', () => {
    expect(() =>
      buildSplitJournalLines({
        loanAccountCode: '2510',
        interestAccountCode: null,
        paymentAccountCode: '1010',
        principalCents: 100,
        interestCents: 50,
        description: 'x',
      })
    ).toThrow(/no interest expense account/);
  });

  test('an actual payment splits interest-first, the rest to principal', () => {
    expect(splitActualPayment(20387, 69288)).toEqual({ interestCents: 20387, principalCents: 48901 });
    // Paid less than the interest due: everything is interest, no principal.
    expect(splitActualPayment(20387, 10000)).toEqual({ interestCents: 10000, principalCents: 0 });
    // Extra payment: scheduled interest, everything above it to principal.
    expect(splitActualPayment(20387, 100000)).toEqual({ interestCents: 20387, principalCents: 79613 });
  });
});

describe('shareholder loans — s.15(2) deadlines', () => {
  const octoberAnchor = { month: 10, day: 1 }; // Muja: Sep 30 year-end

  test('deadline is one year after the end of the taxation year of the advance', () => {
    expect(shareholderDeadlineForAdvance('2026-03-15', octoberAnchor)).toBe('2027-09-30');
    // An advance on the year-end day itself belongs to the year just ending.
    expect(shareholderDeadlineForAdvance('2026-09-30', octoberAnchor)).toBe('2027-09-30');
    // The day after year-end starts a new taxation year.
    expect(shareholderDeadlineForAdvance('2026-10-01', octoberAnchor)).toBe('2028-09-30');
    // Calendar-year company.
    expect(shareholderDeadlineForAdvance('2026-06-15', { month: 1, day: 1 })).toBe('2027-12-31');
  });

  test('warning thresholds at 180 / 90 / 30 days and overdue', () => {
    expect(warningLevelFor(181)).toBeNull();
    expect(warningLevelFor(180)).toBe('watch');
    expect(warningLevelFor(91)).toBe('watch');
    expect(warningLevelFor(90)).toBe('warning');
    expect(warningLevelFor(31)).toBe('warning');
    expect(warningLevelFor(30)).toBe('critical');
    expect(warningLevelFor(0)).toBe('critical');
    expect(warningLevelFor(-1)).toBe('overdue');
  });

  test('days remaining counts whole days to the deadline', () => {
    const events: AdvanceEvent[] = [{ kind: 'advance', date: '2026-03-15', amountCents: 5_000_000 }];
    const at = (asOf: string) => advanceDeadlines(events, octoberAnchor, asOf)[0];
    expect(at('2027-04-02').daysRemaining).toBe(181);
    expect(at('2027-04-02').level).toBeNull();
    expect(at('2027-04-03').daysRemaining).toBe(180);
    expect(at('2027-04-03').level).toBe('watch');
    expect(at('2027-07-02').daysRemaining).toBe(90);
    expect(at('2027-07-02').level).toBe('warning');
    expect(at('2027-08-31').daysRemaining).toBe(30);
    expect(at('2027-08-31').level).toBe('critical');
    expect(at('2027-10-01').daysRemaining).toBe(-1);
    expect(at('2027-10-01').level).toBe('overdue');
  });

  test('repayments clear the oldest advance first (FIFO)', () => {
    const events: AdvanceEvent[] = [
      { kind: 'advance', date: '2026-01-10', amountCents: 5_000_000 },
      { kind: 'advance', date: '2026-03-01', amountCents: 3_000_000 },
      { kind: 'repayment', date: '2026-06-01', amountCents: 6_000_000 },
    ];
    const deadlines = advanceDeadlines(events, octoberAnchor, '2026-06-02');
    // The $50,000 advance is fully cleared; $20,000 of the second remains.
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].advance.date).toBe('2026-03-01');
    expect(deadlines[0].outstandingCents).toBe(2_000_000);
    expect(deadlines[0].deadline).toBe('2027-09-30');
    expect(shareholderBalanceAtCents(events, '2026-06-02')).toBe(2_000_000);
  });

  test('a fully repaid advance raises no deadline', () => {
    const events: AdvanceEvent[] = [
      { kind: 'advance', date: '2026-01-10', amountCents: 5_000_000 },
      { kind: 'repayment', date: '2026-05-01', amountCents: 5_000_000 },
    ];
    expect(advanceDeadlines(events, octoberAnchor, '2026-06-01')).toHaveLength(0);
  });
});

describe('shareholder loans — series of loans and repayments', () => {
  test('a repayment followed by a re-advance within 90 days is flagged', () => {
    const events: AdvanceEvent[] = [
      { kind: 'advance', date: '2026-01-10', amountCents: 5_000_000 },
      { kind: 'repayment', date: '2026-04-01', amountCents: 5_000_000 },
      { kind: 'advance', date: '2026-05-15', amountCents: 4_000_000 },
    ];
    const flags = detectSeriesPatterns(events);
    expect(flags).toHaveLength(1);
    expect(flags[0].gapDays).toBe(44);
    expect(flags[0].message).toMatch(/series of loans and repayments/);
  });

  test('a re-advance long after the repayment is not a series flag', () => {
    const events: AdvanceEvent[] = [
      { kind: 'advance', date: '2026-01-10', amountCents: 5_000_000 },
      { kind: 'repayment', date: '2026-04-01', amountCents: 5_000_000 },
      { kind: 'advance', date: '2026-08-15', amountCents: 4_000_000 },
    ];
    expect(detectSeriesPatterns(events)).toHaveLength(0);
  });
});

describe('shareholder loans — s.80.4 benefit estimate', () => {
  test('a full year at the prescribed rate on $100,000 is $5,000', () => {
    const events: AdvanceEvent[] = [{ kind: 'advance', date: '2026-01-01', amountCents: 10_000_000 }];
    expect(shareholderBenefitCents(events, 5, 0, '2026-01-01', '2027-01-01')).toBe(500000);
  });

  test('repayment mid-year stops the accrual: 181 days at $100,000 = $2,479.45', () => {
    const events: AdvanceEvent[] = [
      { kind: 'advance', date: '2026-01-01', amountCents: 10_000_000 },
      { kind: 'repayment', date: '2026-07-01', amountCents: 10_000_000 },
    ];
    // Jan 1 → Jul 1 is 181 days; 100000 × 5% × 181/365 = $2,479.4520…
    expect(shareholderBenefitCents(events, 5, 0, '2026-01-01', '2027-01-01')).toBe(247945);
  });

  test('no benefit when the loan rate meets the prescribed rate', () => {
    const events: AdvanceEvent[] = [{ kind: 'advance', date: '2026-01-01', amountCents: 10_000_000 }];
    expect(shareholderBenefitCents(events, 5, 5, '2026-01-01', '2027-01-01')).toBe(0);
    // Only the spread counts: 5% prescribed − 2% charged = 3%.
    expect(shareholderBenefitCents(events, 5, 2, '2026-01-01', '2027-01-01')).toBe(300000);
  });

  test('an advance before the window sets the opening balance', () => {
    const events: AdvanceEvent[] = [{ kind: 'advance', date: '2025-06-01', amountCents: 10_000_000 }];
    expect(shareholderBenefitCents(events, 5, 0, '2026-01-01', '2027-01-01')).toBe(500000);
  });
});

describe('loan tool migration', () => {
  const migration = readFileSync(
    resolve('prisma/migrations/20261120180000_loan_tool/migration.sql'),
    'utf8'
  );

  test('creates the register tables and the loan journal source', () => {
    expect(migration).toContain('CREATE TABLE "Loan"');
    expect(migration).toContain('CREATE TABLE "LoanPayment"');
    expect(migration).toContain('CREATE TABLE "LoanAdvance"');
    expect(migration).toContain('ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS \'loan\'');
    expect(migration).toContain('REFERENCES "Company"("id")');
    expect(migration).toContain('REFERENCES "Loan"("id") ON DELETE CASCADE');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
