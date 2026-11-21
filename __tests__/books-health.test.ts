/**
 * Phase 2 item 4 — books health: anomaly & duplicate radar +
 * per-company checklist. The pure engine runs over plain facts — no
 * DB. Every rule gets a positive case AND the negative case that
 * proves it does not cry wolf (two genuinely different payments to
 * the same payee must NOT flag), plus fingerprint stability and the
 * dismissal partition.
 */
import {
  evaluateHealth,
  partitionDismissals,
  type HealthFacts,
  type HealthPaymentFact,
} from '@/lib/health/engine';

// ── Fixtures ─────────────────────────────────────────────────────────

const AS_OF = '2026-09-30';

function baseFacts(): HealthFacts {
  return {
    asOf: AS_OF,
    payments: [],
    journalLines: [],
    accounts: [],
    suspense: [],
    uncategorized: [],
    bankAccounts: [],
    loans: [],
    gst: { registrationPresent: true, unfiledPeriods: [] },
  };
}

let seq = 0;
function payment(partial: Partial<HealthPaymentFact>): HealthPaymentFact {
  seq += 1;
  return {
    id: `pay-${seq}`,
    date: '2026-09-01',
    payee: 'Telus',
    description: 'Internet bill',
    amountCents: 12_345,
    accountName: 'TD Chequing',
    ...partial,
  };
}

function checkOf(facts: HealthFacts, id: string) {
  const report = evaluateHealth(facts);
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`check ${id} missing`);
  return { report, check };
}

// ── (a) Duplicate payments ───────────────────────────────────────────

describe('duplicate payments', () => {
  it('flags the same amount to the same payee within five days', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ date: '2026-09-10' }),
      payment({ date: '2026-09-12' }),
    ];
    const { check } = checkOf(facts, 'duplicate_payments');
    expect(check.status).toBe('attention');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].ruleId).toBe('duplicate_payment');
    expect(check.flags[0].detail).toContain('$123.45');
    expect(check.flags[0].items).toHaveLength(2);
  });

  it('does NOT flag two genuinely different payments to the same payee', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ date: '2026-09-01', amountCents: 200_000, description: 'Rent' }),
      payment({ date: '2026-09-03', amountCents: 35_000, description: 'Utilities' }),
    ];
    const { check } = checkOf(facts, 'duplicate_payments');
    expect(check.flags).toHaveLength(0);
    expect(check.status).toBe('healthy');
  });

  it('does NOT flag the same amount to different payees', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ date: '2026-09-10', payee: 'Telus' }),
      payment({ date: '2026-09-11', payee: 'Rogers' }),
    ];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });

  it('does NOT flag a regular weekly payment of a fixed amount', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ date: '2026-09-07', amountCents: 50_000 }),
      payment({ date: '2026-09-14', amountCents: 50_000 }),
      payment({ date: '2026-09-21', amountCents: 50_000 }),
    ];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });

  it('does NOT flag the same amount to the same payee a month apart', () => {
    const facts = baseFacts();
    facts.payments = [payment({ date: '2026-08-10' }), payment({ date: '2026-09-10' })];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });

  it('groups three close payments into one flag', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ date: '2026-09-10' }),
      payment({ date: '2026-09-11' }),
      payment({ date: '2026-09-13' }),
    ];
    const { check } = checkOf(facts, 'duplicate_payments');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].items).toHaveLength(3);
  });
});

// ── (a) Duplicate journal lines ──────────────────────────────────────

describe('duplicate journal lines', () => {
  const line = (entryId: string, entryDate: string, id: string) => ({
    id,
    entryId,
    entryDate,
    entryDescription: 'Manual journal',
    glAccountCode: '6410',
    description: 'Office supplies',
    debitCents: 50_000,
    creditCents: 0,
  });

  it('flags the same line in two different entries close together', () => {
    const facts = baseFacts();
    facts.journalLines = [line('e1', '2026-09-05', 'l1'), line('e2', '2026-09-06', 'l2')];
    const { check } = checkOf(facts, 'duplicate_payments');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].ruleId).toBe('duplicate_journal_line');
  });

  it('does NOT flag identical lines inside one entry (split postings)', () => {
    const facts = baseFacts();
    facts.journalLines = [line('e1', '2026-09-05', 'l1'), line('e1', '2026-09-05', 'l2')];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });

  it('does NOT flag the same line in entries a month apart (recurring journal)', () => {
    const facts = baseFacts();
    facts.journalLines = [line('e1', '2026-08-05', 'l1'), line('e2', '2026-09-05', 'l2')];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });

  it('does NOT flag same account and amount with different descriptions', () => {
    const facts = baseFacts();
    facts.journalLines = [
      line('e1', '2026-09-05', 'l1'),
      { ...line('e2', '2026-09-06', 'l2'), description: 'Printer paper' },
    ];
    expect(checkOf(facts, 'duplicate_payments').check.flags).toHaveLength(0);
  });
});

// ── (b) Amount outliers ──────────────────────────────────────────────

describe('amount outliers', () => {
  const history = (amounts: number[]) =>
    amounts.map((amountCents, i) =>
      payment({ payee: 'Staples', amountCents, date: `2026-0${(i % 8) + 1}-15`, description: 'Supplies' })
    );

  it('flags a payment at 10x the payee median', () => {
    const facts = baseFacts();
    facts.payments = history([10_000, 10_000, 10_000, 10_000, 100_000]);
    const { check } = checkOf(facts, 'amount_outliers');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].ruleId).toBe('amount_outlier');
    expect(check.flags[0].detail).toContain('10.0×');
  });

  it('does NOT flag a multiple that stays under the $500 floor', () => {
    const facts = baseFacts();
    facts.payments = history([1_000, 1_000, 1_000, 1_000, 20_000]); // $200 = 20x of $10
    expect(checkOf(facts, 'amount_outliers').check.flags).toHaveLength(0);
  });

  it('does NOT flag without enough payee history', () => {
    const facts = baseFacts();
    facts.payments = history([10_000, 10_000, 10_000, 500_000]);
    expect(checkOf(facts, 'amount_outliers').check.flags).toHaveLength(0);
  });

  it('does NOT flag a payment only 2.5x the median', () => {
    const facts = baseFacts();
    facts.payments = history([40_000, 40_000, 40_000, 40_000, 100_000]);
    expect(checkOf(facts, 'amount_outliers').check.flags).toHaveLength(0);
  });
});

// ── (c) Round-number clusters ────────────────────────────────────────

describe('round-number clusters', () => {
  it('flags three exact round payments to one payee', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ payee: 'ABC Consulting', amountCents: 100_000, date: '2026-07-10' }),
      payment({ payee: 'ABC Consulting', amountCents: 200_000, date: '2026-08-10' }),
      payment({ payee: 'ABC Consulting', amountCents: 50_000, date: '2026-09-10' }),
    ];
    const { check } = checkOf(facts, 'round_numbers');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].figures).toContainEqual({ label: 'Total', value: '$3,500.00' });
  });

  it('does NOT flag only two round payments', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ payee: 'ABC Consulting', amountCents: 100_000, date: '2026-08-10' }),
      payment({ payee: 'ABC Consulting', amountCents: 200_000, date: '2026-09-10' }),
    ];
    expect(checkOf(facts, 'round_numbers').check.flags).toHaveLength(0);
  });

  it('does NOT count a near-round amount toward the cluster', () => {
    const facts = baseFacts();
    facts.payments = [
      payment({ payee: 'ABC Consulting', amountCents: 100_000, date: '2026-07-10' }),
      payment({ payee: 'ABC Consulting', amountCents: 200_000, date: '2026-08-10' }),
      payment({ payee: 'ABC Consulting', amountCents: 150_050, date: '2026-09-10' }),
    ];
    expect(checkOf(facts, 'round_numbers').check.flags).toHaveLength(0);
  });
});

// ── (d) Uncoded accounts, ranked by volume ───────────────────────────

describe('uncoded accounts', () => {
  it('ranks by dollar volume and grades severity by the $10,000 line', () => {
    const facts = baseFacts();
    facts.accounts = [
      { code: '6990', name: 'Miscellaneous', balanceCents: 0, activityCents: 500_000, gifiStatus: 'undecided' },
      { code: '5410', name: 'Vehicle', balanceCents: 0, activityCents: 2_000_000, gifiStatus: 'undecided' },
      { code: '1010', name: 'Bank', balanceCents: 5_000_000, activityCents: 9_000_000, gifiStatus: 'coded' },
      { code: '3000', name: "Owner's Capital", balanceCents: 0, activityCents: 100_000, gifiStatus: 'decided_unmapped' },
    ];
    const { check } = checkOf(facts, 'gifi_coding');
    expect(check.flags).toHaveLength(2);
    expect(check.flags[0].title).toContain('5410');
    expect(check.flags[0].severity).toBe('attention');
    expect(check.flags[1].title).toContain('6990');
    expect(check.flags[1].severity).toBe('look');
  });

  it('flags an invalid stored code as invalid, not as undecided', () => {
    const facts = baseFacts();
    facts.accounts = [
      { code: '6600', name: 'Repairs', balanceCents: 0, activityCents: 10_000, gifiStatus: 'invalid' },
    ];
    const { check } = checkOf(facts, 'gifi_coding');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].title).toContain('invalid GIFI code');
  });
});

// ── (d) Stale uncategorized transactions ─────────────────────────────

describe('uncategorized transactions', () => {
  it('flags the stale backlog with count, total, and oldest date', () => {
    const facts = baseFacts();
    facts.uncategorized = [
      { id: 't1', date: '2026-08-01', description: 'POS purchase', amountCents: -25_000 },
      { id: 't2', date: '2026-08-20', description: 'E-transfer', amountCents: -40_000 },
      { id: 't3', date: '2026-09-25', description: 'Fresh row', amountCents: -10_000 },
    ];
    const { check } = checkOf(facts, 'uncategorized');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].figures).toContainEqual({ label: 'Transactions', value: '2' });
    expect(check.flags[0].figures).toContainEqual({ label: 'Oldest', value: '2026-08-01' });
  });

  it('does NOT flag transactions still inside the 14-day grace window', () => {
    const facts = baseFacts();
    facts.uncategorized = [
      { id: 't1', date: '2026-09-25', description: 'Fresh row', amountCents: -10_000 },
    ];
    expect(checkOf(facts, 'uncategorized').check.flags).toHaveLength(0);
  });
});

// ── (e) Suspense balances ────────────────────────────────────────────

describe('suspense balances', () => {
  it('flags a non-zero suspense balance as needs attention', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '1090', name: 'Suspense — Unidentified Deposits', balanceCents: -1_993_250 }];
    const { check } = checkOf(facts, 'suspense');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].severity).toBe('attention');
    expect(check.flags[0].detail).toContain('-$19,932.50');
  });

  it('does NOT flag a zero balance even if one slips through', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '1090', name: 'Suspense', balanceCents: 0 }];
    expect(checkOf(facts, 'suspense').check.flags).toHaveLength(0);
  });
});

// ── (f) Bank reconciliation staleness ────────────────────────────────

describe('bank reconciliation staleness', () => {
  const acct = (partial: Partial<HealthFacts['bankAccounts'][number]>) => ({
    id: 'ba1',
    name: 'TD Chequing',
    reconciledThrough: '2026-09-20',
    hasTransactions: true,
    ...partial,
  });

  it('flags an account that has never been reconciled', () => {
    const facts = baseFacts();
    facts.bankAccounts = [acct({ reconciledThrough: null })];
    const { check } = checkOf(facts, 'bank_reconciliation');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].severity).toBe('attention');
  });

  it('flags 60 days stale as worth a look, 100 days as needs attention', () => {
    const facts = baseFacts();
    facts.bankAccounts = [acct({ reconciledThrough: '2026-08-01' })]; // 60 days
    expect(checkOf(facts, 'bank_reconciliation').check.flags[0].severity).toBe('look');
    facts.bankAccounts = [acct({ reconciledThrough: '2026-06-22' })]; // 100 days
    expect(checkOf(facts, 'bank_reconciliation').check.flags[0].severity).toBe('attention');
  });

  it('does NOT flag a recently reconciled account, or an unused one', () => {
    const facts = baseFacts();
    facts.bankAccounts = [acct({})];
    expect(checkOf(facts, 'bank_reconciliation').check.flags).toHaveLength(0);
    facts.bankAccounts = [acct({ reconciledThrough: null, hasTransactions: false })];
    expect(checkOf(facts, 'bank_reconciliation').check.flags).toHaveLength(0);
  });
});

// ── (g) Loans: proofs and s.15(2) deadlines ──────────────────────────

describe('loan flags', () => {
  it('flags a schedule-vs-ledger proof difference with all three figures', () => {
    const facts = baseFacts();
    facts.loans = [{
      id: 'loan1',
      lenderName: 'Ford Credit',
      kind: 'term',
      proofDifferences: [
        { leg: 'schedule_vs_gl', scheduleCents: 2_500_000, otherCents: 2_450_000, differenceCents: 50_000 },
      ],
      deadlines: [],
    }];
    const { check } = checkOf(facts, 'loan_proofs');
    expect(check.flags).toHaveLength(1);
    expect(check.flags[0].detail).toContain('$500.00');
  });

  it('grades s.15(2) deadlines: 45 days look, 20 days attention, overdue attention, 120 days silent', () => {
    const mk = (daysRemaining: number) => {
      const facts = baseFacts();
      facts.loans = [{
        id: 'loan2',
        lenderName: 'Shareholder — Syed',
        kind: 'shareholder_advance',
        proofDifferences: [],
        deadlines: [{ advanceDate: '2025-10-15', deadline: '2027-09-30', daysRemaining, outstandingCents: 2_004_500 }],
      }];
      return checkOf(facts, 'shareholder_deadlines').check;
    };
    expect(mk(45).flags[0].severity).toBe('look');
    expect(mk(20).flags[0].severity).toBe('attention');
    expect(mk(-5).flags[0].severity).toBe('attention');
    expect(mk(-5).flags[0].detail).toContain('was not repaid by');
    expect(mk(120).flags).toHaveLength(0);
  });
});

// ── (h) GST periods ended but unfiled ────────────────────────────────

describe('GST unfiled periods', () => {
  it('flags an old unfiled period as attention and a just-ended one as look', () => {
    const facts = baseFacts();
    facts.gst.unfiledPeriods = [
      { start: '2026-07-01', end: '2026-07-31' }, // ended 61 days ago
      { start: '2026-09-01', end: '2026-09-30' }, // ended today
    ];
    const { check } = checkOf(facts, 'gst_filings');
    expect(check.flags).toHaveLength(2);
    expect(check.flags[0].severity).toBe('attention');
    expect(check.flags[1].severity).toBe('look');
  });

  it('is healthy when every ended period is filed', () => {
    const { check } = checkOf(baseFacts(), 'gst_filings');
    expect(check.status).toBe('healthy');
  });
});

// ── Fingerprints ─────────────────────────────────────────────────────

describe('fingerprints', () => {
  it('are stable across runs over the same facts', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '1090', name: 'Suspense', balanceCents: -500 }];
    const a = evaluateHealth(facts).checks.flatMap((c) => c.flags.map((f) => f.fingerprint));
    const b = evaluateHealth(facts).checks.flatMap((c) => c.flags.map((f) => f.fingerprint));
    expect(a).toEqual(b);
  });

  it('change when the underlying item changes (suspense balance moves)', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '1090', name: 'Suspense', balanceCents: -500 }];
    const before = evaluateHealth(facts).checks.flatMap((c) => c.flags)[0].fingerprint;
    facts.suspense = [{ code: '1090', name: 'Suspense', balanceCents: -700 }];
    const after = evaluateHealth(facts).checks.flatMap((c) => c.flags)[0].fingerprint;
    expect(after).not.toBe(before);
  });

  it('change when an aggregate item set changes (uncategorized backlog grows)', () => {
    const facts = baseFacts();
    facts.uncategorized = [{ id: 't1', date: '2026-08-01', description: 'X', amountCents: -100 }];
    const before = evaluateHealth(facts).checks
      .find((c) => c.id === 'uncategorized')!.flags[0].fingerprint;
    facts.uncategorized.push({ id: 't2', date: '2026-08-02', description: 'Y', amountCents: -200 });
    const after = evaluateHealth(facts).checks
      .find((c) => c.id === 'uncategorized')!.flags[0].fingerprint;
    expect(after).not.toBe(before);
  });
});

// ── Dismissals ───────────────────────────────────────────────────────

describe('dismissal partition', () => {
  it('removes the dismissed flag, heals its check, and returns it with its reason', () => {
    const facts = baseFacts();
    facts.payments = [payment({ date: '2026-09-10' }), payment({ date: '2026-09-12' })];
    const report = evaluateHealth(facts);
    const flag = report.checks.find((c) => c.id === 'duplicate_payments')!.flags[0];

    const dismissals = new Map([
      [flag.fingerprint, { fingerprint: flag.fingerprint, reason: 'Both are real — two sites.', dismissedAt: '2026-10-01T00:00:00.000Z' }],
    ]);
    const { report: active, dismissed } = partitionDismissals(report, dismissals);

    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].reason).toBe('Both are real — two sites.');
    const check = active.checks.find((c) => c.id === 'duplicate_payments')!;
    expect(check.flags).toHaveLength(0);
    expect(check.status).toBe('healthy');
    expect(active.summary.attention).toBe(report.summary.attention - 1);
  });

  it('leaves other flags untouched', () => {
    const facts = baseFacts();
    facts.suspense = [{ code: '1090', name: 'Suspense', balanceCents: -500 }];
    const report = evaluateHealth(facts);
    const { report: active, dismissed } = partitionDismissals(
      report,
      new Map([['duplicate_payment:deadbeef', { fingerprint: 'duplicate_payment:deadbeef', reason: 'n/a', dismissedAt: '2026-10-01T00:00:00.000Z' }]])
    );
    expect(dismissed).toHaveLength(0);
    expect(active.summary.attention).toBe(1);
  });
});

// ── Summary aggregation ──────────────────────────────────────────────

describe('health summary', () => {
  it('counts severities and healthy checks across all ten checks', () => {
    const facts = baseFacts();
    facts.payments = [payment({ date: '2026-09-10' }), payment({ date: '2026-09-12' })]; // 1 attention
    facts.gst.unfiledPeriods = [{ start: '2026-09-01', end: '2026-09-30' }]; // 1 look
    const report = evaluateHealth(facts);
    expect(report.checks).toHaveLength(10);
    expect(report.summary).toEqual({
      attention: 1,
      look: 1,
      healthyChecks: 8,
      totalChecks: 10,
      overall: 'attention',
    });
  });

  it('reports a clean set of books as fully healthy', () => {
    const report = evaluateHealth(baseFacts());
    expect(report.summary.overall).toBe('healthy');
    expect(report.summary.healthyChecks).toBe(10);
    expect(report.checks.every((c) => c.status === 'healthy')).toBe(true);
  });
});
