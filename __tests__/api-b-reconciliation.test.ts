// The API-B gate: "API results reconcile with dashboard reports."
//
// The v1 report handlers and the dashboard report handlers are driven with
// the SAME seeded database mock and their outputs are compared row-by-row
// and total-by-total. The builders additionally get hand-computed fixtures
// so a shared bug can't make both sides agree on a wrong number.

const seedAccounts = [
  { id: 'a-1010', code: '1010', name: 'Chequing', type: 'asset', subType: 'current_asset', detailType: null, gifiCode: null, active: true },
  { id: 'a-2100', code: '2100', name: 'HST Payable', type: 'liability', subType: 'current_liability', detailType: null, gifiCode: null, active: true },
  { id: 'a-3100', code: '3100', name: 'Owner Equity', type: 'equity', subType: 'owners_equity', detailType: null, gifiCode: null, active: true },
  { id: 'a-4000', code: '4000', name: 'Sales', type: 'income', subType: null, detailType: null, gifiCode: null, active: true },
  { id: 'a-5000', code: '5000', name: 'Cost of Goods Sold', type: 'expense', subType: null, detailType: 'cogs', gifiCode: null, active: true },
  { id: 'a-6000', code: '6000', name: 'Office Supplies', type: 'expense', subType: null, detailType: null, gifiCode: null, active: true },
];

const seedLines = [
  { glAccountCode: '1010', debit: 1000, credit: 0 },  // sale receipt
  { glAccountCode: '4000', debit: 0, credit: 1000 },  // sale
  { glAccountCode: '5000', debit: 300, credit: 0 },   // cogs purchase
  { glAccountCode: '1010', debit: 0, credit: 300 },   // cogs payment
  { glAccountCode: '6000', debit: 200, credit: 0 },   // office expense
  { glAccountCode: '1010', debit: 0, credit: 200 },   // office payment
];

const seedInvoices = [
  { id: 'inv-1', companyId: 'co-1', customerId: 'c-1', customer: { name: 'Cust A' }, dueDate: new Date(Date.now() - 20 * 86400000), total: 1000, paidAmount: 0, status: 'sent' },
  { id: 'inv-2', companyId: 'co-1', customerId: 'c-2', customer: { name: 'Cust B' }, dueDate: new Date(Date.now() - 100 * 86400000), total: 500, paidAmount: 200, status: 'overdue' },
];

const mockJournalFindMany = jest.fn();
const mockCoaFindMany = jest.fn();
const mockCompanyFindUnique = jest.fn();
const mockInvoiceFindMany = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    journalLine: { findMany: (...args: unknown[]) => mockJournalFindMany(...args) },
    chartOfAccount: { findMany: (...args: unknown[]) => mockCoaFindMany(...args) },
    company: { findUnique: (...args: unknown[]) => mockCompanyFindUnique(...args), findUniqueOrThrow: (...args: unknown[]) => mockCompanyFindUnique(...args) },
    invoice: { findMany: (...args: unknown[]) => mockInvoiceFindMany(...args) },
  },
}));

jest.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: jest.fn().mockResolvedValue({
    context: { apiKeyId: 'k', apiKeyName: 'n', companyId: 'co-1', permissions: ['read'] },
    error: null,
  }),
}));

jest.mock('@/lib/api-helpers', () => ({
  requireCompany: jest.fn().mockResolvedValue({ companyId: 'co-1', userId: 'u-1', error: null }),
  auditLog: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET as dashboardTb } from '@/app/api/reports/trial-balance/route';
import { GET as v1Tb } from '@/app/api/v1/reports/trial-balance/route';
import { GET as dashboardAr } from '@/app/api/reports/ar-aging/route';
import { GET as v1Ar } from '@/app/api/v1/reports/ar-aging/route';
import { buildProfitLoss, buildBalanceSheet } from '@/lib/api/reports';

/** Deep-search a JSON tree for every object carrying a `code` field. */
function rowsByCode(json: unknown): Map<string, Record<string, unknown>> {
  const found = new Map<string, Record<string, unknown>>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (typeof obj.code === 'string') found.set(obj.code, obj);
      Object.values(obj).forEach(walk);
    }
  };
  walk(json);
  return found;
}

describe('API-B reconciliation — trial balance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJournalFindMany.mockResolvedValue(seedLines);
    mockCoaFindMany.mockResolvedValue(seedAccounts);
    mockCompanyFindUnique.mockResolvedValue({
      id: 'co-1', name: 'Co', legalName: 'Co Ltd', currency: 'CAD',
      fiscalYearStart: new Date('2026-01-01'),
    });
  });

  const url = 'http://localhost/api/v1/reports/trial-balance?asOf=2026-09-10';

  test('v1 trial balance rows equal the dashboard trial balance rows', async () => {
    const [v1Res, dashRes] = await Promise.all([
      v1Tb(new NextRequest(url)),
      dashboardTb(new NextRequest(url)),
    ]);

    expect(v1Res.status).toBe(200);
    expect(dashRes.status).toBe(200);

    const v1Body = await v1Res.json();
    const dashBody = await dashRes.json();
    const dashRows = rowsByCode(dashBody);

    // Reconciliation compares NUMBERS: the dashboard emits JSON numbers while
    // v1 deliberately emits decimal strings — the values must be identical.
    for (const row of v1Body.data.rows) {
      const dash = dashRows.get(row.code);
      expect(dash).toBeDefined();
      expect(Number(row.debit)).toBe(Number(dash!.debit ?? 0));
      expect(Number(row.credit)).toBe(Number(dash!.credit ?? 0));
    }
  });

  test('trial balance matches the hand-computed fixture', async () => {
    const res = await v1Tb(new NextRequest(url));
    const body = await res.json();

    const byCode = new Map(body.data.rows.map((r: any) => [r.code, r]));
    expect(byCode.get('1010')).toMatchObject({ debit: '500.00', credit: '0.00' });
    expect(byCode.get('4000')).toMatchObject({ debit: '0.00', credit: '1000.00' });
    expect(byCode.get('5000')).toMatchObject({ debit: '300.00', credit: '0.00' });
    expect(byCode.get('6000')).toMatchObject({ debit: '200.00', credit: '0.00' });
    expect(body.data.totalDebit).toBe('1000.00');
    expect(body.data.totalCredit).toBe('1000.00');
    expect(body.data.meta).toMatchObject({ accountingBasis: 'accrual', currency: 'CAD' });
  });

  test('profit-loss matches the hand-computed fixture', async () => {
    const pl = await buildProfitLoss('co-1', new Date('2026-01-01'), new Date('2026-09-10'));
    expect(pl.income.total).toBe('1000.00');
    expect(pl.costOfGoodsSold.total).toBe('300.00');
    expect(pl.grossProfit).toBe('700.00');
    expect(pl.operatingExpenses.total).toBe('200.00');
    expect(pl.netIncome).toBe('500.00');
  });

  test('balance sheet matches the hand-computed fixture and balances', async () => {
    const bs = await buildBalanceSheet('co-1', new Date('2026-09-10'));
    expect(bs.totalAssets).toBe('500.00');
    expect(bs.totalLiabilities).toBe('0.00');
    expect(bs.currentYearEarnings).toBe('500.00');
    expect(bs.totalEquity).toBe('500.00');
    expect(bs.isBalanced).toBe(true);
  });
});

describe('API-B reconciliation — AR aging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoiceFindMany.mockResolvedValue(seedInvoices);
    mockCompanyFindUnique.mockResolvedValue({ id: 'co-1', name: 'Co', legalName: 'Co Ltd', currency: 'CAD', fiscalYearStart: new Date('2026-01-01') });
  });

  test('v1 aging buckets match the dashboard aging buckets', async () => {
    const url = 'http://localhost/api/v1/reports/ar-aging?asOf=2026-09-11';
    const [v1Res, dashRes] = await Promise.all([
      v1Ar(new NextRequest(url)),
      dashboardAr(new NextRequest(url)),
    ]);

    expect(v1Res.status).toBe(200);
    expect(dashRes.status).toBe(200);

    const v1Body = await v1Res.json();
    const dashBody = await dashRes.json();

    // Dashboard response shape: { data: { aging: { current|1-30|... : { total, count, invoices } }, totalOutstanding } }.
    // Compare NUMBERS per bucket — v1 emits decimal strings by design.
    for (const bucket of v1Body.data.buckets) {
      expect(Number(dashBody.data.aging[bucket.bucket].total)).toBe(Number(bucket.total));
      expect(dashBody.data.aging[bucket.bucket].count).toBe(bucket.count);
    }
    expect(Number(dashBody.data.totalOutstanding)).toBe(Number(v1Body.data.totalOutstanding));
  });

  test('aging matches the hand-computed fixture', async () => {
    const res = await v1Ar(new NextRequest('http://localhost/api/v1/reports/ar-aging?asOf=2026-09-11'));
    const body = await res.json();
    const byBucket = new Map(body.data.buckets.map((b: any) => [b.bucket, b]));
    expect(byBucket.get('1-30')).toMatchObject({ total: '1000.00', count: 1 });
    expect(byBucket.get('90+')).toMatchObject({ total: '300.00', count: 1 });
    expect(body.data.totalOutstanding).toBe('1300.00');
  });
});
