/**
 * Phase 3 item 4 — ask your books: executors against fixture books.
 *
 * Every intent executes over fixture data shaped exactly like the
 * modules' own inputs, and the figures asserted are the ones those
 * modules compute by hand from the same fixtures: P&L normal balances
 * over GL activity, the AR aging population rule, invoice/bill
 * subledger groupings, the loan tool's schedule summaries, the GST
 * worksheet lines passed through untouched, the CCA assembly's book
 * figures, bank balances grouped by currency, and the payroll-journal
 * aggregation.
 */
import { ASK_EXECUTORS, AskUnavailableError, defaultAskExecutorDeps, type AskContext, type AskExecutorDeps } from '@/lib/ask/executors';
import { validateSelection, type ValidatedParams } from '@/lib/ask/intents';
import type { PeriodContext } from '@/lib/ask/periods';

const mockChartFindMany = jest.fn();
const mockJournalLineFindMany = jest.fn();
const mockInvoiceFindMany = jest.fn();
const mockBillFindMany = jest.fn();
const mockFinancialFindMany = jest.fn();
const mockLoanFindMany = jest.fn();
const mockJournalEntryFindMany = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    chartOfAccount: { findMany: (...args: unknown[]) => mockChartFindMany(...args) },
    journalLine: { findMany: (...args: unknown[]) => mockJournalLineFindMany(...args) },
    invoice: { findMany: (...args: unknown[]) => mockInvoiceFindMany(...args) },
    bill: { findMany: (...args: unknown[]) => mockBillFindMany(...args) },
    financialAccount: { findMany: (...args: unknown[]) => mockFinancialFindMany(...args) },
    loan: { findMany: (...args: unknown[]) => mockLoanFindMany(...args) },
    journalEntry: { findMany: (...args: unknown[]) => mockJournalEntryFindMany(...args) },
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const PERIOD_CTX: PeriodContext = { today: '2026-11-20', fiscalYearStart: '2025-10-02', firstFiscalYearEnd: null };
const CTX: AskContext = { companyId: 'co-1', today: '2026-11-20', currency: 'CAD', periodCtx: PERIOD_CTX };

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const inRange = (date: Date, range?: { gte?: Date; lte?: Date }) =>
  (!range?.gte || date.getTime() >= range.gte.getTime()) && (!range?.lte || date.getTime() <= range.lte.getTime());

const ACCOUNTS = [
  { code: '4000', name: 'Product Sales', type: 'income', active: true },
  { code: '4100', name: 'Service Revenue', type: 'income', active: true },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', active: true },
  { code: '6120', name: 'Vehicle Fuel', type: 'expense', active: true },
  { code: '6130', name: 'Office Expenses', type: 'expense', active: true },
  { code: '6200', name: 'Wages & Salaries', type: 'expense', active: true },
  { code: '6210', name: 'Payroll Taxes', type: 'expense', active: true },
  { code: '2400', name: 'Payroll Liabilities', type: 'liability', active: true },
];

// GL activity: this quarter (Oct 1 – Nov 20, 2026) and last quarter.
const GL_LINES = [
  { glAccountCode: '4000', debit: 0, credit: 10000, _date: local(2026, 10, 15) },
  { glAccountCode: '4100', debit: 0, credit: 2000, _date: local(2026, 10, 16) },
  { glAccountCode: '6120', debit: 1200, credit: 0, _date: local(2026, 10, 20) },
  { glAccountCode: '6120', debit: 300, credit: 0, _date: local(2026, 11, 2) },
  { glAccountCode: '6130', debit: 450, credit: 0, _date: local(2026, 10, 5) },
  { glAccountCode: '4000', debit: 0, credit: 8000, _date: local(2026, 8, 10) },
  { glAccountCode: '6120', debit: 900, credit: 0, _date: local(2026, 7, 15) },
];

const INVOICES = [
  { id: 'inv1', customerId: 'c1', customer: { name: 'Acme Contact', companyName: 'Acme Corp' }, total: 5000, paidAmount: 1000, dueDate: local(2026, 8, 1), issueDate: local(2026, 7, 1), status: 'sent' },
  { id: 'inv2', customerId: 'c2', customer: { name: 'Beta', companyName: 'Beta Ltd' }, total: 2000, paidAmount: 0, dueDate: local(2026, 11, 10), issueDate: local(2026, 10, 10), status: 'overdue' },
  { id: 'inv3', customerId: 'c1', customer: { name: 'Acme Contact', companyName: 'Acme Corp' }, total: 3000, paidAmount: 3000, dueDate: local(2026, 6, 1), issueDate: local(2026, 5, 1), status: 'sent' },
  { id: 'inv4', customerId: 'c3', customer: { name: 'Gamma', companyName: 'Gamma Inc' }, total: 750, paidAmount: 0, dueDate: local(2026, 9, 15), issueDate: local(2026, 8, 15), status: 'sent' },
  { id: 'inv5', customerId: 'c2', customer: { name: 'Beta', companyName: 'Beta Ltd' }, total: 99999, paidAmount: 0, dueDate: local(2026, 1, 1), issueDate: local(2026, 1, 1), status: 'draft' },
];

const BILLS = [
  { id: 'b1', vendorId: 'v1', vendor: { name: 'Shell Canada', companyName: null }, total: 2600, billDate: local(2026, 10, 12), status: 'open' },
  { id: 'b2', vendorId: 'v1', vendor: { name: 'Shell Canada', companyName: null }, total: 1400, billDate: local(2026, 11, 1), status: 'paid' },
  { id: 'b3', vendorId: 'v2', vendor: { name: 'Staples', companyName: null }, total: 900, billDate: local(2026, 10, 20), status: 'open' },
  { id: 'b4', vendorId: 'v2', vendor: { name: 'Staples', companyName: null }, total: 7777, billDate: local(2026, 10, 21), status: 'draft' },
];

const BANK_ACCOUNTS = [
  { id: 'fa1', name: 'TD Chequing', currency: 'CAD', currentBalance: 15234.56, mask: '6789', glAccountCode: '1010', isActive: true },
  { id: 'fa2', name: 'US Savings', currency: 'USD', currentBalance: 2000, mask: '1234', glAccountCode: '1020', isActive: true },
  { id: 'fa3', name: 'Closed Account', currency: 'CAD', currentBalance: 500, mask: null, glAccountCode: null, isActive: false },
];

const LOANS = [
  {
    id: 'l1', kind: 'term', status: 'active', lenderName: 'Ford Credit', purpose: '2023 Ford F-150',
    principal: 30000, annualRatePct: 6.99, prescribedRatePct: null,
    payments: [
      { id: 'p1', periodNumber: 1, dueDate: local(2026, 2, 15), openingBalance: 30000, paymentAmount: 600, interestPortion: 174.75, principalPortion: 425.25, closingBalance: 29574.75, status: 'posted' },
      { id: 'p2', periodNumber: 2, dueDate: local(2026, 3, 15), openingBalance: 29574.75, paymentAmount: 600, interestPortion: 172.27, principalPortion: 427.73, closingBalance: 29147.02, status: 'posted' },
      { id: 'p3', periodNumber: 3, dueDate: local(2026, 12, 15), openingBalance: 29147.02, paymentAmount: 600, interestPortion: 169.78, principalPortion: 430.22, closingBalance: 28716.8, status: 'scheduled' },
    ],
    advances: [],
  },
  {
    id: 'l2', kind: 'shareholder_advance', status: 'active', lenderName: 'Syed Abbas', purpose: null,
    principal: 0, annualRatePct: 0, prescribedRatePct: null,
    payments: [],
    advances: [
      { id: 'a1', kind: 'advance', advanceDate: local(2026, 5, 1), amount: 20000 },
      { id: 'a2', kind: 'repayment', advanceDate: local(2026, 9, 1), amount: 5000 },
    ],
  },
];

const PAYROLL_ENTRIES = [
  {
    id: 'e1', entryDate: local(2026, 10, 31), sourceType: 'payroll',
    lines: [
      { glAccountCode: '6200', debit: 8000, credit: 0 },
      { glAccountCode: '6210', debit: 450, credit: 0 },
      { glAccountCode: '2400', debit: 0, credit: 8450 },
    ],
  },
  {
    id: 'e2', entryDate: local(2026, 11, 15), sourceType: 'payroll',
    lines: [
      { glAccountCode: '6200', debit: 8000, credit: 0 },
      { glAccountCode: '6210', debit: 450, credit: 0 },
      { glAccountCode: '2400', debit: 0, credit: 8450 },
    ],
  },
  {
    id: 'e3', entryDate: local(2026, 8, 15), sourceType: 'payroll',
    lines: [{ glAccountCode: '6200', debit: 9999, credit: 0 }],
  },
];

function wireDb() {
  mockChartFindMany.mockImplementation(async (args: { where?: { type?: string } }) =>
    ACCOUNTS.filter((a) => !args?.where?.type || a.type === args.where.type),
  );
  mockJournalLineFindMany.mockImplementation(async (args: { where: { journalEntry: { entryDate: { gte?: Date; lte?: Date } } } }) =>
    GL_LINES.filter((l) => inRange(l._date, args.where.journalEntry.entryDate)).map(({ _date, ...line }) => line),
  );
  mockInvoiceFindMany.mockImplementation(async (args: { where: { status: { in: string[] }; issueDate?: { gte?: Date; lte?: Date } } }) =>
    INVOICES.filter(
      (inv) => args.where.status.in.includes(inv.status) && (!args.where.issueDate || inRange(inv.issueDate, args.where.issueDate)),
    ),
  );
  mockBillFindMany.mockImplementation(async (args: { where: { status: { in: string[] }; billDate?: { gte?: Date; lte?: Date } } }) =>
    BILLS.filter(
      (b) => args.where.status.in.includes(b.status) && (!args.where.billDate || inRange(b.billDate, args.where.billDate)),
    ),
  );
  mockFinancialFindMany.mockImplementation(async (args: { where?: { isActive?: boolean } }) =>
    BANK_ACCOUNTS.filter((a) => args?.where?.isActive === undefined || a.isActive === args.where.isActive),
  );
  mockLoanFindMany.mockResolvedValue(LOANS);
  mockJournalEntryFindMany.mockImplementation(async (args: { where: { sourceType: string; entryDate: { gte?: Date; lte?: Date } } }) =>
    PAYROLL_ENTRIES.filter((e) => e.sourceType === args.where.sourceType && inRange(e.entryDate, args.where.entryDate)),
  );
}

function paramsFor(intentId: string, params: Record<string, unknown>): ValidatedParams {
  const v = validateSelection({ intentId, params }, PERIOD_CTX);
  if (!v.ok) throw new Error(`fixture params invalid: ${v.error}`);
  return v.params;
}

beforeEach(() => {
  jest.clearAllMocks();
  wireDb();
});

// ── P&L executors ────────────────────────────────────────────────────

describe('spend and revenue over GL activity', () => {
  it('spend totals match the hand-computed normal balances, with prior-period comparison', async () => {
    const answer = await ASK_EXECUTORS.spend_by_category(CTX, paramsFor('spend_by_category', { period: { named: 'this_quarter' } }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([
      { label: 'Total spending', amount: 1950 },
      { label: expect.stringContaining('Prior period'), amount: 900 },
    ]);
    expect(answer.rows).toEqual([
      { label: '6120 Vehicle Fuel', amount: 1500, detail: 'Prior period: $900.00' },
      { label: '6130 Office Expenses', amount: 450, detail: 'Prior period: $—' }, // N() renders zero as —
    ]);
    expect(answer.headline).toContain('$1,950.00');
    expect(answer.sourceReport.href).toBe('/reports/profit-loss');
  });

  it('a category filter narrows to matching accounts; an unknown category is an honest miss, not a zero', async () => {
    const fuel = await ASK_EXECUTORS.spend_by_category(CTX, paramsFor('spend_by_category', { period: { named: 'this_quarter' }, category: 'fuel' }), defaultAskExecutorDeps);
    expect(fuel.figures[0]).toEqual({ label: 'Matching spending', amount: 1500 });
    expect(fuel.rows).toHaveLength(1);

    const miss = await ASK_EXECUTORS.spend_by_category(CTX, paramsFor('spend_by_category', { period: { named: 'this_quarter' }, category: 'helicopter' }), defaultAskExecutorDeps);
    expect(miss.figures).toEqual([]);
    expect(miss.headline).toContain('No expense account');
    expect(miss.headline).toContain('helicopter');
  });

  it('revenue totals and net income match the reporting primitives', async () => {
    const answer = await ASK_EXECUTORS.revenue_for_period(CTX, paramsFor('revenue_for_period', { period: { named: 'this_quarter' } }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([
      { label: 'Total revenue', amount: 12000 },
      { label: 'Net income', amount: 10050 },
      { label: expect.stringContaining('Prior-period revenue'), amount: 8000 },
    ]);
    expect(answer.rows).toEqual([
      { label: '4000 Product Sales', amount: 10000 },
      { label: '4100 Service Revenue', amount: 2000 },
    ]);
  });
});

// ── Receivables / top customers / top vendors ────────────────────────

describe('receivables and subledger rankings', () => {
  it('receivables apply the aging population rule: open only, remaining balance, days past due', async () => {
    const answer = await ASK_EXECUTORS.receivables_overdue(CTX, paramsFor('receivables_overdue', { days: 60 }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([{ label: 'Over 60 days past due', amount: 4750 }]);
    expect(answer.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Acme Corp', 4000],
      ['Gamma Inc', 750],
    ]);
    expect(answer.rows[0].detail).toContain('111 days overdue');
    expect(answer.workings).toContain('$6,750.00'); // total outstanding incl. the 10-day invoice

    const all = await ASK_EXECUTORS.receivables_overdue(CTX, paramsFor('receivables_overdue', { days: 0 }), defaultAskExecutorDeps);
    expect(all.figures[0].amount).toBe(6750);
    expect(all.rows).toHaveLength(3);
  });

  it('top customers group issued invoices by customer', async () => {
    const answer = await ASK_EXECUTORS.top_customers(CTX, paramsFor('top_customers', { period: { named: 'last_fiscal_year' } }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([{ label: 'Total invoiced in period', amount: 8750 }]);
    expect(answer.rows).toEqual([
      { label: 'Acme Corp', amount: 8000, detail: '2 invoices' },
      { label: 'Gamma Inc', amount: 750, detail: '1 invoice' },
    ]);
  });

  it('top vendors group recorded bills by vendor, drafts excluded', async () => {
    const answer = await ASK_EXECUTORS.top_vendors(CTX, paramsFor('top_vendors', { period: { named: 'this_quarter' } }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([{ label: 'Total billed in period', amount: 4900 }]);
    expect(answer.rows).toEqual([
      { label: 'Shell Canada', amount: 4000, detail: '2 bills' },
      { label: 'Staples', amount: 900, detail: '1 bill' },
    ]);
  });
});

// ── Loans / cash / payroll ───────────────────────────────────────────

describe('loans, cash, and payroll', () => {
  it('loan balances come from the loan tool summaries, directions kept separate', async () => {
    const answer = await ASK_EXECUTORS.loan_balances(CTX, paramsFor('loan_balances', {}), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([
      { label: 'Term-loan balances', amount: 29147.02 },
      { label: 'Due from shareholder', amount: 15000 },
    ]);
    const ford = answer.rows.find((r) => r.label.includes('Ford Credit'));
    expect(ford?.amount).toBe(29147.02);
    expect(ford?.detail).toContain('Next payment $600.00 on 2026-12-15');
    expect(answer.headline).toContain('2 active loans');
  });

  it('cash totals are grouped by currency, never added across currencies', async () => {
    const answer = await ASK_EXECUTORS.cash_by_account(CTX, paramsFor('cash_by_account', {}), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([
      { label: 'Total (CAD)', amount: 15234.56 },
      { label: 'Total (USD)', amount: 2000 },
    ]);
    expect(answer.rows).toHaveLength(2); // the inactive account is excluded
    expect(answer.workings).toContain('never added together');
  });

  it('payroll cost aggregates the expense lines of payroll journals only', async () => {
    const answer = await ASK_EXECUTORS.payroll_cost(CTX, paramsFor('payroll_cost', { period: { named: 'this_quarter' } }), defaultAskExecutorDeps);
    expect(answer.figures).toEqual([{ label: 'Total payroll cost', amount: 16900 }]);
    expect(answer.rows).toEqual([
      { label: '6200 Wages & Salaries', amount: 16000 },
      { label: '6210 Payroll Taxes', amount: 900 },
    ]);
    expect(answer.headline).toContain('2 posted payroll journals');

    const empty = await ASK_EXECUTORS.payroll_cost(CTX, paramsFor('payroll_cost', { period: { start: '2026-03-01', end: '2026-03-31' } }), defaultAskExecutorDeps);
    expect(empty.figures).toEqual([]);
    expect(empty.headline).toContain('No payroll journals');
  });
});

// ── GST / CCA via injected engine deps ───────────────────────────────

const GST_VIEW = {
  periodStart: '2026-10-01',
  periodEnd: '2026-11-20',
  filed: null,
  worksheet: {
    lines: [
      { line: '101', amount: 171595 },
      { line: '103', amount: 4979.05 },
      { line: '106', amount: 0 },
      { line: '109', amount: 4979.05 },
    ],
    netfile: { outcome: 'payment', keyedNumbers: [{ line: '115', label: 'Balance owing', amount: 4979.05 }] },
  },
};

const CCA_ASSEMBLED = {
  result: {
    payload: {
      classes: [
        { ccaClass: '43', label: 'Manufacturing equipment', ratePct: 30, closingCapitalCost: '50000.00', book: { accumulatedDepreciation: '12000.00', netBookValue: '38000.00', depreciationExpenseForYear: '5000.00' } },
        { ccaClass: '50', label: 'Computer equipment', ratePct: 55, closingCapitalCost: '8000.00', book: { accumulatedDepreciation: '3000.00', netBookValue: '5000.00', depreciationExpenseForYear: '1500.00' } },
      ],
    },
    assetCount: 3,
    classCount: 2,
    bookVsLedgerDifferenceCents: 0,
  },
  fiscalYear: { start: '2026-10-02', end: '2027-10-01', label: 'FY2027', labelYear: 2027 },
};

function depsWith(overrides: Partial<AskExecutorDeps>): AskExecutorDeps {
  return {
    computeGstReturn: (async () => GST_VIEW) as unknown as AskExecutorDeps['computeGstReturn'],
    assembleCcaRegisterExport: (async () => CCA_ASSEMBLED) as unknown as AskExecutorDeps['assembleCcaRegisterExport'],
    ...overrides,
  };
}

describe('GST and CCA pass the engine figures through untouched', () => {
  it('GST figures are the worksheet lines exactly as the engine computed them', async () => {
    const answer = await ASK_EXECUTORS.gst_position(CTX, paramsFor('gst_position', { period: { named: 'this_quarter' } }), depsWith({}));
    expect(answer.figures).toEqual([
      { label: 'Line 101 — Total sales and other revenue', amount: 171595 },
      { label: 'Line 103 — GST/HST collected', amount: 4979.05 },
      { label: 'Line 106 — Input tax credits', amount: 0 },
      { label: 'Line 109 — Net tax', amount: 4979.05 },
      { label: 'Line 115 — Balance owing', amount: 4979.05 },
    ]);
    expect(answer.headline).toContain('$4,979.05');
    expect(answer.workings).toContain('not yet recorded as filed');
  });

  it('a GST engine failure becomes an honest unavailable answer, not a figure', async () => {
    const deps = depsWith({
      computeGstReturn: (async () => {
        throw new Error('No GST/HST registration number on file');
      }) as unknown as AskExecutorDeps['computeGstReturn'],
    });
    await expect(
      ASK_EXECUTORS.gst_position(CTX, paramsFor('gst_position', { period: { named: 'this_quarter' } }), deps),
    ).rejects.toThrow(AskUnavailableError);
  });

  it('CCA rows are the assembly’s book figures, and the workings name where UCC lives', async () => {
    const answer = await ASK_EXECUTORS.cca_by_class(CTX, paramsFor('cca_by_class', {}), depsWith({}));
    expect(answer.figures).toEqual([{ label: 'Total net book value (book)', amount: 43000 }]);
    expect(answer.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Class 43 — Manufacturing equipment', 38000],
      ['Class 50 — Computer equipment', 5000],
    ]);
    expect(answer.workings).toContain('Nexvar Tax');
    expect(answer.workings).toContain('no shadow tax UCC');
  });

  it('a missing business number surfaces as unavailable with the engine’s own reason', async () => {
    const deps = depsWith({
      assembleCcaRegisterExport: (async () => {
        throw new Error('This company has no business number on file — add it before assembling the register.');
      }) as unknown as AskExecutorDeps['assembleCcaRegisterExport'],
    });
    await expect(ASK_EXECUTORS.cca_by_class(CTX, paramsFor('cca_by_class', {}), deps)).rejects.toThrow(/business number/);
  });
});
