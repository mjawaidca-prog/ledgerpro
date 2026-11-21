/**
 * Phase 3 item 2 — cash-flow outlook: 13-week lookahead. The pure
 * engine runs over plain facts — no DB. Every figure must trace to a
 * source item, so alongside the placement tests (invoice in week 3,
 * loan payment on its real date, GST on its CRA due date) the suite
 * proves the drill-down identity: each week's items sum exactly to
 * the week's in/out totals.
 *
 * Calendar anchor: asOf Friday 2026-11-20. Window = Mon 2026-11-16
 * through Sun 2027-02-14. Week 3 = Nov 30–Dec 6, week 5 = Dec 14–20,
 * week 7 = Dec 28–Jan 3, week 9 = Jan 11–17.
 */
import {
  buildCashflowOutlook,
  gstDueDate,
  type CashflowFacts,
  type CashflowItem,
} from '@/lib/cashflow/engine';

const AS_OF = '2026-11-20';

function baseFacts(): CashflowFacts {
  return {
    asOf: AS_OF,
    accounts: [{ name: 'TD Chequing', kind: 'checking', balanceCents: 1_000_000 }],
    invoices: [],
    bills: [],
    loanPayments: [],
    recurring: [],
    payrollRuns: [],
    remittancePaidMonths: [],
    gstRegistrationPresent: false,
    gstPeriods: [],
  };
}

function itemsOf(facts: CashflowFacts, kind: CashflowItem['kind']): CashflowItem[] {
  const outlook = buildCashflowOutlook(facts);
  return [...outlook.weeks.flatMap((w) => w.items), ...outlook.afterWindow].filter(
    (i) => i.kind === kind
  );
}

// ── Invoices & bills ────────────────────────────────────────────────

describe('invoices and bills', () => {
  it('places an invoice due in week 3 in week 3', () => {
    const facts = baseFacts();
    facts.invoices = [
      { id: 'inv-1', customerName: 'Acme Corp', dueDate: '2026-12-02', outstandingCents: 250_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.weeks[2].inflowCents).toBe(250_000);
    expect(outlook.weeks[2].items).toHaveLength(1);
    expect(outlook.weeks[2].items[0].label).toContain('Acme Corp');
    expect(outlook.weeks[0].inflowCents).toBe(0);
    expect(outlook.weeks[1].inflowCents).toBe(0);
  });

  it('shows an overdue invoice in week 1, flagged past due', () => {
    const facts = baseFacts();
    facts.invoices = [
      { id: 'inv-1', customerName: 'Slow Payer Ltd', dueDate: '2026-11-02', outstandingCents: 90_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.weeks[0].inflowCents).toBe(90_000);
    expect(outlook.weeks[0].items[0].pastDue).toBe(true);
  });

  it('places a bill on its due date and a no-due-date bill in week 1', () => {
    const facts = baseFacts();
    facts.bills = [
      { id: 'b-1', vendorName: 'Telus', referenceNo: 'T-991', dueDate: '2026-12-15', outstandingCents: 12_000 },
      { id: 'b-2', vendorName: 'Landlord', referenceNo: null, dueDate: null, outstandingCents: 300_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.weeks[4].outflowCents).toBe(12_000);
    expect(outlook.weeks[4].items[0].label).toContain('T-991');
    expect(outlook.weeks[0].outflowCents).toBe(300_000);
    expect(outlook.weeks[0].items[0].detail).toBe('No due date set');
  });
});

// ── Loans ───────────────────────────────────────────────────────────

describe('loan payments', () => {
  it('lands a scheduled payment on its real schedule date', () => {
    const facts = baseFacts();
    facts.loanPayments = [
      {
        loanId: 'loan-1',
        lenderName: 'Ford Credit',
        purpose: '2023 Ford F-150',
        dueDate: '2026-12-15',
        amountCents: 58_160,
      },
    ];
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.weeks[4].outflowCents).toBe(58_160); // week 5: Dec 14–20
    expect(outlook.weeks[4].items[0].label).toContain('Ford Credit');
    expect(outlook.weeks[4].items[0].label).toContain('2023 Ford F-150');
  });
});

// ── Recurring templates ─────────────────────────────────────────────

describe('recurring templates', () => {
  it('projects a monthly template forward from a past next date, on cadence', () => {
    const facts = baseFacts();
    facts.recurring = [
      {
        templateId: 't-1',
        name: 'Monthly Rent',
        frequency: 'monthly',
        nextPostDate: '2026-11-05',
        endDate: null,
        bankAmountCents: -250_000,
      },
    ];
    const items = itemsOf(facts, 'recurring');
    expect(items.map((i) => i.date)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(items.every((i) => i.direction === 'out' && i.amountCents === 250_000)).toBe(true);
  });

  it('respects the template end date', () => {
    const facts = baseFacts();
    facts.recurring = [
      {
        templateId: 't-1',
        name: 'Weekly Cleaning',
        frequency: 'weekly',
        nextPostDate: '2026-11-21',
        endDate: '2026-12-05',
        bankAmountCents: -18_000,
      },
    ];
    const items = itemsOf(facts, 'recurring');
    expect(items.map((i) => i.date)).toEqual(['2026-11-21', '2026-11-28', '2026-12-05']);
  });
});

// ── Payroll cadence + CRA remittances ───────────────────────────────

describe('payroll', () => {
  const semiMonthlyRuns = [
    { date: '2026-10-15', payAmountCents: 800_000, remittanceAmountCents: 200_000 },
    { date: '2026-10-31', payAmountCents: 820_000, remittanceAmountCents: 205_000 },
    { date: '2026-11-15', payAmountCents: 810_000, remittanceAmountCents: 195_000 },
  ];

  it('infers a semi-monthly pattern from the 15th and month-end runs', () => {
    const facts = baseFacts();
    facts.payrollRuns = semiMonthlyRuns;
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.payrollPattern?.cadence).toBe('semi-monthly');
    expect(outlook.payrollPattern?.avgPayCents).toBe(810_000);
    expect(outlook.payrollPattern?.avgRemittanceCents).toBe(200_000);
  });

  it('projects pay dates on the pattern at the average amount', () => {
    const facts = baseFacts();
    facts.payrollRuns = semiMonthlyRuns;
    const payItems = itemsOf(facts, 'payroll');
    expect(payItems.map((i) => i.date)).toEqual([
      '2026-11-30',
      '2026-12-15',
      '2026-12-31',
      '2027-01-15',
      '2027-01-31',
    ]);
    expect(payItems.every((i) => i.amountCents === 810_000 && i.projected)).toBe(true);
  });

  it('places each month\u2019s remittance on the 15th of the following month, aggregated by month', () => {
    const facts = baseFacts();
    facts.payrollRuns = semiMonthlyRuns;
    const outlook = buildCashflowOutlook(facts);
    const remittances = [...outlook.weeks.flatMap((w) => w.items), ...outlook.afterWindow].filter(
      (i) => i.kind === 'remittance'
    );
    const byDate = new Map(remittances.map((i) => [i.date, i.amountCents]));
    // October's actual runs (200,000 + 205,000), due Nov 15 — already
    // past when the window opens, so it sits in week 1 flagged.
    expect(byDate.get('2026-11-15')).toBe(405_000);
    expect(outlook.weeks[0].items.find((i) => i.kind === 'remittance')?.pastDue).toBe(true);
    // November: the actual Nov 15 run plus the projected Nov 30 run.
    expect(byDate.get('2026-12-15')).toBe(195_000 + 200_000);
    // December: two projected runs at the average.
    expect(byDate.get('2027-01-15')).toBe(400_000);
    // January's remittance is real but lands beyond the 13 weeks.
    expect(byDate.get('2027-02-15')).toBe(400_000);
    expect(outlook.afterWindow.some((i) => i.kind === 'remittance' && i.date === '2027-02-15')).toBe(true);
  });

  it('drops a remittance month the server marked paid', () => {
    const facts = baseFacts();
    facts.payrollRuns = semiMonthlyRuns;
    facts.remittancePaidMonths = ['2026-10'];
    const remittances = itemsOf(facts, 'remittance');
    expect(remittances.some((i) => i.date === '2026-11-15')).toBe(false);
    expect(remittances.some((i) => i.date === '2026-12-15')).toBe(true);
  });

  it('infers monthly and weekly patterns', () => {
    const monthly = baseFacts();
    monthly.payrollRuns = [
      { date: '2026-08-31', payAmountCents: 500_000, remittanceAmountCents: 0 },
      { date: '2026-09-30', payAmountCents: 500_000, remittanceAmountCents: 0 },
      { date: '2026-10-31', payAmountCents: 500_000, remittanceAmountCents: 0 },
    ];
    const monthlyOutlook = buildCashflowOutlook(monthly);
    expect(monthlyOutlook.payrollPattern?.cadence).toBe('monthly');
    expect(itemsOf(monthly, 'payroll').map((i) => i.date)).toEqual([
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ]);

    const weekly = baseFacts();
    weekly.payrollRuns = [
      { date: '2026-11-06', payAmountCents: 120_000, remittanceAmountCents: 0 },
      { date: '2026-11-13', payAmountCents: 120_000, remittanceAmountCents: 0 },
      { date: '2026-11-20', payAmountCents: 120_000, remittanceAmountCents: 0 },
    ];
    const weeklyOutlook = buildCashflowOutlook(weekly);
    expect(weeklyOutlook.payrollPattern?.cadence).toBe('weekly');
    expect(itemsOf(weekly, 'payroll')[0].date).toBe('2026-11-27');
  });

  it('does not project when the journals do not split source deductions', () => {
    const facts = baseFacts();
    facts.payrollRuns = semiMonthlyRuns.map((r) => ({ ...r, remittanceAmountCents: 0 }));
    const outlook = buildCashflowOutlook(facts);
    expect(itemsOf(facts, 'remittance')).toHaveLength(0);
    expect(outlook.assumptions.some((a) => a.includes('do not separate source deductions'))).toBe(true);
  });

  it('does not project payroll from fewer than three journals, or a stale pattern', () => {
    const two = baseFacts();
    two.payrollRuns = semiMonthlyRuns.slice(0, 2);
    expect(buildCashflowOutlook(two).payrollPattern).toBeNull();
    expect(itemsOf(two, 'payroll')).toHaveLength(0);

    const stale = baseFacts();
    stale.payrollRuns = [
      { date: '2026-07-15', payAmountCents: 800_000, remittanceAmountCents: 200_000 },
      { date: '2026-07-31', payAmountCents: 800_000, remittanceAmountCents: 200_000 },
      { date: '2026-08-15', payAmountCents: 800_000, remittanceAmountCents: 200_000 },
    ];
    const staleOutlook = buildCashflowOutlook(stale);
    expect(staleOutlook.payrollPattern).toBeNull();
    expect(staleOutlook.assumptions.some((a) => a.includes('looks stopped'))).toBe(true);
  });
});

// ── GST/HST ─────────────────────────────────────────────────────────

describe('GST/HST remittances', () => {
  it('computes CRA due dates: month after period end, or +3 months for annual filers', () => {
    expect(gstDueDate({ periodStart: '2026-10-01', periodEnd: '2026-10-31', filingFrequency: 'monthly', netOwingCents: 1 })).toBe('2026-11-30');
    expect(gstDueDate({ periodStart: '2026-07-01', periodEnd: '2026-09-30', filingFrequency: 'quarterly', netOwingCents: 1 })).toBe('2026-10-31');
    expect(gstDueDate({ periodStart: '2026-01-01', periodEnd: '2026-12-31', filingFrequency: 'annual', netOwingCents: 1 })).toBe('2027-03-31');
  });

  it('places the net owing for a period ending inside the window on its due date', () => {
    const facts = baseFacts();
    facts.gstRegistrationPresent = true;
    facts.gstPeriods = [
      { periodStart: '2026-11-01', periodEnd: '2026-11-30', filingFrequency: 'monthly', netOwingCents: 175_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    const gst = itemsOf(facts, 'gst');
    expect(gst).toHaveLength(1);
    expect(gst[0].date).toBe('2026-12-31');
    expect(outlook.weeks[6].outflowCents).toBe(175_000); // week 7: Dec 28–Jan 3
    expect(gst[0].label).toContain('2026-11-01');
  });

  it('places an annual filer\u2019s remittance beyond the window in the after-window list', () => {
    const facts = baseFacts();
    facts.gstRegistrationPresent = true;
    facts.gstPeriods = [
      { periodStart: '2026-01-01', periodEnd: '2026-12-31', filingFrequency: 'annual', netOwingCents: 900_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    expect(outlook.afterWindow.some((i) => i.kind === 'gst' && i.date === '2027-03-31')).toBe(true);
    expect(outlook.weeks.every((w) => w.items.every((i) => i.kind !== 'gst'))).toBe(true);
  });
});

// ── Negative-balance warning + drill-down identity ──────────────────

describe('the projection as a whole', () => {
  it('calls out the first dip below zero with its week, date and amount — even mid-week', () => {
    const facts = baseFacts();
    facts.accounts = [{ name: 'TD Chequing', kind: 'checking', balanceCents: 100_000 }];
    facts.bills = [
      { id: 'b-1', vendorName: 'Supplier', referenceNo: null, dueDate: '2026-11-18', outstandingCents: 150_000 },
    ];
    facts.invoices = [
      { id: 'inv-1', customerName: 'Acme Corp', dueDate: '2026-11-20', outstandingCents: 200_000 },
    ];
    const outlook = buildCashflowOutlook(facts);
    // Week 1 closes positive (+150,000) but the balance dips on Nov 18.
    expect(outlook.weeks[0].closingCents).toBe(150_000);
    expect(outlook.firstNegative).toEqual({
      weekIndex: 0,
      date: '2026-11-18',
      closingCents: -50_000,
    });
  });

  it('reports no warning when the balance never goes negative', () => {
    const facts = baseFacts();
    facts.bills = [
      { id: 'b-1', vendorName: 'Telus', referenceNo: null, dueDate: '2026-12-01', outstandingCents: 50_000 },
    ];
    expect(buildCashflowOutlook(facts).firstNegative).toBeNull();
  });

  it('drill-down items sum exactly to every week\u2019s totals, and the weeks chain to the closing balance', () => {
    const facts = baseFacts();
    facts.invoices = [
      { id: 'inv-1', customerName: 'Acme Corp', dueDate: '2026-12-02', outstandingCents: 250_000 },
      { id: 'inv-2', customerName: 'Beta Inc', dueDate: '2026-11-01', outstandingCents: 75_000 },
    ];
    facts.bills = [
      { id: 'b-1', vendorName: 'Telus', referenceNo: 'T-1', dueDate: '2026-11-25', outstandingCents: 40_000 },
      { id: 'b-2', vendorName: 'Landlord', referenceNo: null, dueDate: null, outstandingCents: 300_000 },
    ];
    facts.loanPayments = [
      { loanId: 'l-1', lenderName: 'Ford Credit', purpose: null, dueDate: '2026-12-15', amountCents: 58_160 },
      { loanId: 'l-1', lenderName: 'Ford Credit', purpose: null, dueDate: '2027-01-15', amountCents: 58_160 },
    ];
    facts.recurring = [
      {
        templateId: 't-1',
        name: 'Monthly Rent',
        frequency: 'monthly',
        nextPostDate: '2026-12-01',
        endDate: null,
        bankAmountCents: -250_000,
      },
    ];
    facts.payrollRuns = [
      { date: '2026-10-15', payAmountCents: 800_000, remittanceAmountCents: 200_000 },
      { date: '2026-10-31', payAmountCents: 820_000, remittanceAmountCents: 205_000 },
      { date: '2026-11-15', payAmountCents: 810_000, remittanceAmountCents: 195_000 },
    ];
    facts.gstRegistrationPresent = true;
    facts.gstPeriods = [
      { periodStart: '2026-11-01', periodEnd: '2026-11-30', filingFrequency: 'monthly', netOwingCents: 175_000 },
    ];

    const outlook = buildCashflowOutlook(facts);
    expect(outlook.windowStart).toBe('2026-11-16');
    expect(outlook.windowEnd).toBe('2027-02-14');
    expect(outlook.weeks).toHaveLength(13);

    let running = outlook.openingCents;
    for (const week of outlook.weeks) {
      const itemIn = week.items.filter((i) => i.direction === 'in').reduce((s, i) => s + i.amountCents, 0);
      const itemOut = week.items.filter((i) => i.direction === 'out').reduce((s, i) => s + i.amountCents, 0);
      expect(itemIn).toBe(week.inflowCents);
      expect(itemOut).toBe(week.outflowCents);
      running += week.netCents;
      expect(week.closingCents).toBe(running);
    }
    expect(outlook.totalInflowCents).toBe(outlook.weeks.reduce((s, w) => s + w.inflowCents, 0));
    expect(outlook.totalOutflowCents).toBe(outlook.weeks.reduce((s, w) => s + w.outflowCents, 0));
    expect(outlook.openingCents).toBe(1_000_000);
  });
});
