/**
 * Phase 1 item 8 — year-end package (year-end-package/1): pre-flight
 * checks (Pass / Warn / Block / Not checked, never silent) and the
 * bundle assembly (shape, canonical hash, comparatives, the payroll
 * empty slot). The pure layer runs over plain facts — no DB.
 */
import {
  buildYearEndPackagePayload,
  evaluatePreflight,
  type BuildYearEndPackageInput,
  type PreflightCheck,
  type YearEndFacts,
} from '@/lib/year-end-package';
import { buildTbGifiPayload, type TbGifiPayload } from '@/lib/tb-gifi';

// ── Fixtures ─────────────────────────────────────────────────────────

function baseFacts(): YearEndFacts {
  return {
    fiscalYear: { start: '2025-10-01', end: '2026-09-30', label: 'FY 2025' },
    trialBalance: { totalDebitCents: 10_000_000, totalCreditCents: 10_000_000, accountCount: 40 },
    gifi: { total: 40, coded: 40, needsCode: [], decidedUnmapped: [] },
    suspense: [],
    suspenseAccountsExist: true,
    periodLock: { closed: true, postingsAfterCloseCount: 0 },
    loans: [],
    fixedAssets: {
      assetCount: 0,
      unmodelledClass: [],
      missingGlMapping: [],
      afuBeforeAcquisition: [],
      registerAdditionsCents: 0,
      glAdditionsCents: null,
      bookVsLedgerDifferenceCents: null,
      unpostedDepreciationCents: 0,
    },
    gst: {
      registrationPresent: true,
      periods: [
        { start: '2025-10-01', end: '2025-12-31', due: true, filed: true, confirmation: 'WS123456' },
        { start: '2026-01-01', end: '2026-03-31', due: true, filed: true, confirmation: 'WS123457' },
      ],
    },
    bank: { accounts: [{ name: 'Chequing', reconciledThrough: '2026-09-30' }] },
    payroll: { notCheckedReason: 'T4/PD7A tie-out lives in Nexvar Pay.' },
  };
}

function check(facts: YearEndFacts, id: string): PreflightCheck {
  const found = evaluatePreflight(facts).checks.find((c) => c.id === id);
  if (!found) throw new Error(`check ${id} missing`);
  return found;
}

function tbPayload(periodStart: string, periodEnd: string): TbGifiPayload {
  return buildTbGifiPayload({
    companyId: 'company-1',
    bn: '763203379RC0001',
    periodStart,
    periodEnd,
    postedThrough: `${periodEnd}T23:59:59.000Z`,
    periodLocked: false,
    accounts: [
      { accountId: 'a1', number: '1002', name: 'Cash', type: 'asset', gifiCode: '1002', debitCents: 500_00, creditCents: 0 },
      { accountId: 'a2', number: '3500', name: 'Share capital', type: 'equity', gifiCode: '3500', debitCents: 0, creditCents: 500_00 },
    ],
  }).payload;
}

function basePackageInput(): BuildYearEndPackageInput {
  const facts = baseFacts();
  return {
    companyId: 'company-1',
    companyName: '2751623 Alberta Corp.',
    bn: '763203379RC0001',
    gstNumber: '763203379RT0001',
    fiscalYear: { start: '2025-10-01', end: '2026-09-30', label: 'FY 2025' },
    generatedAt: '2026-10-05T12:00:00.000Z',
    coverSheet: evaluatePreflight(facts),
    mappingHealth: { total: 40, coded: 40, undecidedCount: 0, decidedUnmappedCount: 0, scorePct: 100 },
    trialBalance: {
      current: tbPayload('2025-10-01', '2026-09-30'),
      priorYear: tbPayload('2024-10-01', '2025-09-30'),
    },
    glDetail: {
      accounts: [
        { code: '1002', name: 'Cash', type: 'asset', openingCents: 100_00, debitCents: 900_00, creditCents: 500_00, closingCents: 500_00 },
        { code: '8000', name: 'Sales', type: 'income', openingCents: 0, debitCents: 0, creditCents: 12345_67, closingCents: -12345_67 },
      ],
      journalSummaryBySource: [
        { source: 'manual', entryCount: 12, debitCents: 5000_00 },
        { source: 'payroll', entryCount: 6, debitCents: 7000_00 },
      ],
    },
    ccaRegister: { contractVersion: 'cca-register/1', hash: 'cca-hash' },
    loans: [
      {
        loanId: 'loan-1',
        kind: 'term',
        status: 'active',
        lenderName: 'Ford Credit',
        purpose: 'Vehicle',
        principalCents: 40000_00,
        annualRatePct: 6.99,
        startDate: '2026-01-15',
        loanAccountCode: '2520',
        schedule: [
          { period: 1, date: '2026-02-15', openingCents: 40000_00, paymentCents: 775_00, interestCents: 233_00, principalCents: 542_00, closingCents: 39458_00, status: 'posted' },
        ],
        fiscalYearTotals: [
          { label: 'FY 2025', start: '2025-10-01', end: '2026-09-30', interestCents: 1800_00, principalCents: 4300_00, paymentsCents: 6100_00, paymentCount: 8 },
        ],
        proof: {
          asOf: '2026-09-30',
          scheduleBalanceCents: 35700_00,
          glBalanceCents: 35700_00,
          statementBalanceCents: null,
          statementBalanceDate: null,
          scheduleVsGlCents: 0,
          scheduleVsStatementCents: null,
          tiesOut: true,
        },
        shareholder: null,
      },
    ],
    gstWorksheets: [
      { periodStart: '2025-10-01', periodEnd: '2025-12-31', payload: { contractVersion: 'gst-worksheet/1', hash: 'gst-hash-1' } },
    ],
    payroll: {
      status: 'no_payroll_journals',
      runCount: 0,
      accounts: [],
      attachFromNexvarPay: ['T4 slips and T4 Summary', 'PD7A annual reconciliation'],
    },
  };
}

// ── Pre-flight: the happy path ───────────────────────────────────────

describe('evaluatePreflight — clean books', () => {
  it('passes every runnable check; payroll is honestly not_checked', () => {
    const { checks, summary } = evaluatePreflight(baseFacts());
    expect(checks).toHaveLength(9);
    for (const c of checks) {
      if (c.id === 'payroll_tie_out') {
        expect(c.status).toBe('not_checked');
        expect(c.detail).toContain('Nexvar Pay');
      } else {
        expect(c.status).toBe('pass');
      }
    }
    expect(summary).toEqual({ pass: 8, warn: 0, block: 0, notChecked: 1, overall: 'pass' });
  });
});

// ── Trial balance ────────────────────────────────────────────────────

describe('trial_balance_balances', () => {
  it('blocks when debits and credits disagree, naming the difference', () => {
    const facts = baseFacts();
    facts.trialBalance.totalCreditCents -= 125_50;
    const c = check(facts, 'trial_balance_balances');
    expect(c.status).toBe('block');
    expect(c.detail).toContain('125.50');
    expect(evaluatePreflight(facts).summary.overall).toBe('block');
  });
});

// ── GIFI decisions ───────────────────────────────────────────────────

describe('gifi_decisions', () => {
  it('warns on undecided accounts and names them with balances (gate, not a wall)', () => {
    const facts = baseFacts();
    facts.gifi = {
      total: 40,
      coded: 38,
      needsCode: [{ code: '6990', name: 'Miscellaneous Expense', balanceCents: 250_00 }],
      decidedUnmapped: [{ code: '5410', name: 'Motor Vehicle — Ford Credit Payments' }],
    };
    const c = check(facts, 'gifi_decisions');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('6990');
    expect(c.items.join(' ')).toContain('250.00');
    expect(c.items.join(' ')).toContain('left unmapped by choice');
  });

  it('passes when the only unmapped accounts are decided ones, and still lists them', () => {
    const facts = baseFacts();
    facts.gifi = {
      total: 40,
      coded: 39,
      needsCode: [],
      decidedUnmapped: [{ code: '5410', name: 'Motor Vehicle — Ford Credit Payments' }],
    };
    const c = check(facts, 'gifi_decisions');
    expect(c.status).toBe('pass');
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toContain('5410');
  });
});

// ── Suspense ─────────────────────────────────────────────────────────

describe('suspense_zero', () => {
  it('blocks on a non-zero suspense balance at year-end', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '9990', name: 'Unidentified Deposits', balanceCents: -19932_50 }];
    const c = check(facts, 'suspense_zero');
    expect(c.status).toBe('block');
    expect(c.items[0]).toContain('Unidentified Deposits');
  });

  it('passes when the chart has no suspense accounts at all', () => {
    const facts = baseFacts();
    facts.suspenseAccountsExist = false;
    expect(check(facts, 'suspense_zero').status).toBe('pass');
  });
});

// ── Period lock ──────────────────────────────────────────────────────

describe('period_lock', () => {
  it('warns when the year was never closed', () => {
    const facts = baseFacts();
    facts.periodLock = { closed: false, postingsAfterCloseCount: 0 };
    expect(check(facts, 'period_lock').status).toBe('warn');
  });

  it('blocks when entries were posted into the year after it closed', () => {
    const facts = baseFacts();
    facts.periodLock = { closed: true, postingsAfterCloseCount: 3 };
    const c = check(facts, 'period_lock');
    expect(c.status).toBe('block');
    expect(c.detail).toContain('3 journal entries were');
  });
});

// ── Loans ────────────────────────────────────────────────────────────

describe('loans_tie_out', () => {
  const loanFact = (patch: Partial<YearEndFacts['loans'][number]>): YearEndFacts['loans'][number] => ({
    id: 'l1',
    lenderName: 'Ford Credit',
    kind: 'term',
    unpostedDueCount: 0,
    scheduleVsGlCents: 0,
    scheduleVsStatementCents: null,
    shareholderDeadlines: [],
    ...patch,
  });

  it('passes a clean loan', () => {
    const facts = baseFacts();
    facts.loans = [loanFact({})];
    expect(check(facts, 'loans_tie_out').status).toBe('pass');
  });

  it('warns on unposted due payments', () => {
    const facts = baseFacts();
    facts.loans = [loanFact({ unpostedDueCount: 2 })];
    const c = check(facts, 'loans_tie_out');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('never posted');
  });

  it('warns when the schedule and the GL disagree', () => {
    const facts = baseFacts();
    facts.loans = [loanFact({ scheduleVsGlCents: -45_00 })];
    const c = check(facts, 'loans_tie_out');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('45.00');
  });

  it('warns on an s.15(2) deadline inside the next 12 months, and names an overdue one as passed', () => {
    const facts = baseFacts();
    facts.loans = [
      loanFact({
        kind: 'shareholder_advance',
        lenderName: 'Shareholder — Syed',
        shareholderDeadlines: [
          { advanceDate: '2025-11-01', deadline: '2027-09-30', daysRemaining: 200, outstandingCents: 5000_00 },
          { advanceDate: '2024-06-01', deadline: '2026-09-30', daysRemaining: -12, outstandingCents: 1000_00 },
        ],
      }),
    ];
    const c = check(facts, 'loans_tie_out');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('must be repaid by 2027-09-30');
    expect(c.items.join(' ')).toContain('passed its 2026-09-30 repayment deadline');
  });

  it('ignores an s.15(2) deadline more than 12 months out', () => {
    const facts = baseFacts();
    facts.loans = [
      loanFact({
        kind: 'shareholder_advance',
        shareholderDeadlines: [
          { advanceDate: '2026-08-01', deadline: '2028-09-30', daysRemaining: 700, outstandingCents: 5000_00 },
        ],
      }),
    ];
    expect(check(facts, 'loans_tie_out').status).toBe('pass');
  });
});

// ── Fixed assets ─────────────────────────────────────────────────────

describe('fixed_assets_facts', () => {
  const assetFacts = (patch: Partial<YearEndFacts['fixedAssets']>): YearEndFacts['fixedAssets'] => ({
    assetCount: 3,
    unmodelledClass: [],
    missingGlMapping: [],
    afuBeforeAcquisition: [],
    registerAdditionsCents: 20000_00,
    glAdditionsCents: 20000_00,
    bookVsLedgerDifferenceCents: 0,
    unpostedDepreciationCents: 0,
    ...patch,
  });

  it('blocks on a CCA class Nexvar Tax does not model', () => {
    const facts = baseFacts();
    facts.fixedAssets = assetFacts({ unmodelledClass: [{ description: 'Old truck', ccaClass: '99' }] });
    const c = check(facts, 'fixed_assets_facts');
    expect(c.status).toBe('block');
    expect(c.items[0]).toContain('Old truck');
  });

  it('warns on missing GL mapping, register-vs-GL additions difference, and unposted depreciation', () => {
    const facts = baseFacts();
    facts.fixedAssets = assetFacts({
      missingGlMapping: ['Delivery van'],
      glAdditionsCents: 15000_00,
      unpostedDepreciationCents: 1200_00,
    });
    const c = check(facts, 'fixed_assets_facts');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('Delivery van');
    expect(c.items.join(' ')).toContain('differ');
    expect(c.items.join(' ')).toContain('not yet posted');
  });

  it('warns on a book-vs-ledger depreciation difference', () => {
    const facts = baseFacts();
    facts.fixedAssets = assetFacts({ bookVsLedgerDifferenceCents: 75_25 });
    const c = check(facts, 'fixed_assets_facts');
    expect(c.status).toBe('warn');
    expect(c.items.join(' ')).toContain('75.25');
  });

  it('passes an empty register', () => {
    expect(check(baseFacts(), 'fixed_assets_facts').status).toBe('pass');
  });
});

// ── GST periods ──────────────────────────────────────────────────────

describe('gst_periods_filed', () => {
  it('is not_checked without a registration, with the reason stated', () => {
    const facts = baseFacts();
    facts.gst = { registrationPresent: false, periods: [] };
    const c = check(facts, 'gst_periods_filed');
    expect(c.status).toBe('not_checked');
    expect(c.detail).toContain('No GST/HST registration');
  });

  it('warns on a due period with no filing recorded, naming the period', () => {
    const facts = baseFacts();
    facts.gst.periods[1].filed = false;
    const c = check(facts, 'gst_periods_filed');
    expect(c.status).toBe('warn');
    expect(c.items).toEqual(['2026-01-01 to 2026-03-31 — no filing recorded']);
  });

  it('does not demand filing for a period that has not ended by year-end', () => {
    const facts = baseFacts();
    facts.gst.periods.push({ start: '2026-07-01', end: '2026-12-31', due: false, filed: false, confirmation: null });
    expect(check(facts, 'gst_periods_filed').status).toBe('pass');
  });
});

// ── Bank reconciliation ──────────────────────────────────────────────

describe('bank_reconciled', () => {
  it('is not_checked when the company has no bank accounts in LedgerPro', () => {
    const facts = baseFacts();
    facts.bank = { accounts: null };
    expect(check(facts, 'bank_reconciled').status).toBe('not_checked');
  });

  it('warns on an account reconciled only part-way through the year', () => {
    const facts = baseFacts();
    facts.bank = {
      accounts: [
        { name: 'Chequing', reconciledThrough: '2026-09-30' },
        { name: 'Visa', reconciledThrough: '2026-06-30' },
      ],
    };
    const c = check(facts, 'bank_reconciled');
    expect(c.status).toBe('warn');
    expect(c.items).toEqual(['Visa — reconciled through 2026-06-30 (year-end 2026-09-30)']);
  });

  it('warns on an account never reconciled', () => {
    const facts = baseFacts();
    facts.bank = { accounts: [{ name: 'Chequing', reconciledThrough: null }] };
    const c = check(facts, 'bank_reconciled');
    expect(c.status).toBe('warn');
    expect(c.items[0]).toContain('never');
  });
});

// ── Package assembly ─────────────────────────────────────────────────

describe('buildYearEndPackagePayload', () => {
  it('builds the full contract shape with money as decimal strings', () => {
    const { payload } = buildYearEndPackagePayload(basePackageInput());
    expect(payload.contractVersion).toBe('year-end-package/1');
    expect(payload.companyId).toBe('company-1');
    expect(payload.bn).toBe('763203379RC0001');
    expect(payload.fiscalYearLabel).toBe('FY 2025');

    const cover = payload.coverSheet as any;
    expect(cover.checks).toHaveLength(9);
    expect(cover.counts).toEqual({ pass: 8, warn: 0, block: 0, notChecked: 1 });
    expect(cover.mappingHealth.scorePct).toBe(100);

    const gl = payload.glDetail as any;
    expect(gl.accounts[0]).toEqual({
      code: '1002', name: 'Cash', type: 'asset',
      opening: '100.00', debits: '900.00', credits: '500.00', closing: '500.00',
    });
    expect(gl.accounts[1].closing).toBe('-12345.67');
    expect(gl.journalSummaryBySource[0]).toEqual({ source: 'manual', entryCount: 12, debits: '5000.00' });

    const loans = payload.loans as any[];
    expect(loans[0].principal).toBe('40000.00');
    expect(loans[0].schedule[0].interest).toBe('233.00');
    expect(loans[0].fiscalYearTotals[0].interest).toBe('1800.00');
    expect(loans[0].proof.tiesOut).toBe(true);

    expect((payload.ccaRegister as any).contractVersion).toBe('cca-register/1');
    expect((payload.gstWorksheets as any[])[0].periodStart).toBe('2025-10-01');
  });

  it('carries the comparative as the prior year’s own tb-gifi/1 payload, and null for a first year', () => {
    const input = basePackageInput();
    const { payload } = buildYearEndPackagePayload(input);
    const tb = payload.trialBalance as any;
    expect(tb.current.hash).toBe(input.trialBalance.current.hash);
    expect(tb.priorYear.hash).toBe(input.trialBalance.priorYear!.hash);
    expect(tb.priorYear.periodStart).toBe('2024-10-01');

    const firstYear = basePackageInput();
    firstYear.trialBalance.priorYear = null;
    const { payload: p2 } = buildYearEndPackagePayload(firstYear);
    expect((p2.trialBalance as any).priorYear).toBeNull();
  });

  it('hash is stable for identical input and changes when a figure changes', () => {
    const a = buildYearEndPackagePayload(basePackageInput()).payload;
    const b = buildYearEndPackagePayload(basePackageInput()).payload;
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);

    const changed = basePackageInput();
    changed.glDetail.accounts[0].debitCents += 1;
    const c = buildYearEndPackagePayload(changed).payload;
    expect(c.hash).not.toBe(a.hash);
  });

  it('payroll empty slot names what to attach from Nexvar Pay instead of inventing figures', () => {
    const { payload } = buildYearEndPackagePayload(basePackageInput());
    const payroll = payload.payroll as any;
    expect(payroll.status).toBe('no_payroll_journals');
    expect(payroll.runCount).toBe(0);
    expect(payroll.accounts).toEqual([]);
    expect(payroll.source).toContain('attach the items listed below');
    expect(payroll.attachFromNexvarPay).toContain('T4 slips and T4 Summary');
  });

  it('payroll section carries posted journal totals when payroll reached the books', () => {
    const input = basePackageInput();
    input.payroll = {
      status: 'ledgerpro_journals',
      runCount: 6,
      accounts: [{ code: '9060', name: 'Salaries and wages', debitCents: 50000_00, creditCents: 0 }],
      attachFromNexvarPay: ['T4 slips and T4 Summary'],
    };
    const { payload } = buildYearEndPackagePayload(input);
    const payroll = payload.payroll as any;
    expect(payroll.status).toBe('ledgerpro_journals');
    expect(payroll.accounts[0]).toEqual({ code: '9060', name: 'Salaries and wages', debits: '50000.00', credits: '0.00' });
    expect(payroll.source).toContain('NOT in this package');
  });
});
