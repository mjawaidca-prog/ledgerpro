/**
 * Regression: report file downloads (Phase 0).
 *
 * The trial-balance exporters in src/lib/export.ts were written against a
 * legacy flat payload (`data.rows`, `data.asOf`, `data.prior`) while
 * GET /api/reports/trial-balance returns rows grouped under `sections`
 * with the date at `period.asOf` and prior figures folded into each row.
 * Clicking Export → CSV/Excel threw a TypeError before any download
 * started (live defect, Nov 19 2026). The Balance Sheet "Export as CSV"
 * menu item had no handler at all. These tests pin the exporters to the
 * real API shapes.
 */

// ── DOM stubs (jest runs in node env) ──
const clickedLinks: any[] = [];
const blobs: Blob[] = [];
const RealBlob = global.Blob;
class CapturedBlob extends RealBlob {
  constructor(parts?: any, opts?: any) { super(parts, opts); blobs.push(this); }
}
(global as any).Blob = CapturedBlob;
(global as any).URL.createObjectURL = jest.fn(() => 'blob:mock');
(global as any).URL.revokeObjectURL = jest.fn();
(global as any).document = {
  createElement: jest.fn(() => {
    const link: any = { href: '', download: '', click: jest.fn(() => clickedLinks.push(link)) };
    return link;
  }),
  body: { appendChild: jest.fn(), removeChild: jest.fn() },
};

import { exportTrialBalance, exportCaseWareTrialBalance, exportBalanceSheet, exportPandL } from '@/lib/export';

beforeEach(() => { clickedLinks.length = 0; blobs.length = 0; });

async function lastCsv(): Promise<string> {
  expect(blobs.length).toBeGreaterThan(0);
  return blobs[blobs.length - 1].text();
}

// Exact shape returned by GET /api/reports/trial-balance (route.ts)
const tbApiData: any = {
  companyName: '2751623 Alberta Corp.', currency: 'CAD',
  period: { asOf: '2026-09-30', label: 'September 30, 2026' },
  comparisonLabel: 'Prior Year', comparisonMode: 'prior_year', generatedAt: '2026-11-19T00:00:00.000Z',
  sections: {
    asset: { rows: [{ code: '1000', name: 'Cash', type: 'asset', detailType: null, gifiCode: '1001', debit: 500, credit: 0, priorDebit: 400, priorCredit: 0 }], totalDebit: 500, totalCredit: 0, priorTotalDebit: 400, priorTotalCredit: 0 },
    income: { rows: [{ code: '4000', name: 'Revenue', type: 'income', detailType: null, gifiCode: '8000', debit: 0, credit: 500, priorDebit: 0, priorCredit: 400 }], totalDebit: 0, totalCredit: 500, priorTotalDebit: 0, priorTotalCredit: 400 },
  },
  totalDebits: 500, totalCredits: 500, isBalanced: true, accountCount: 2,
};

describe('trial balance downloads', () => {
  test('CSV export downloads with the API sections shape', async () => {
    expect(() => exportTrialBalance(tbApiData)).not.toThrow();
    expect(clickedLinks).toHaveLength(1);
    expect(clickedLinks[0].download).toBe('trial-balance-2026-09-30.csv');
    const csv = await lastCsv();
    expect(csv).toContain('"1000","Cash","asset","500.00","0.00"');
    expect(csv).toContain('"4000","Revenue","income","0.00","500.00"');
    expect(csv).toContain('"","TOTALS","","500.00","500.00"');
  });

  test('CaseWare export includes prior-year columns when a comparison is active', async () => {
    expect(() => exportCaseWareTrialBalance(tbApiData)).not.toThrow();
    expect(clickedLinks[0].download).toBe('caseware-trial-balance-2026-09-30.csv');
    const csv = await lastCsv();
    expect(csv).toContain('Prior Year Debit');
    expect(csv).toContain('"1000","Cash","1001","asset","500.00","0.00","400.00","0.00"');
    expect(csv).toContain('"","TOTALS","","","500.00","500.00","400.00","400.00"');
  });

  test('CaseWare export omits prior-year columns when comparison is off', async () => {
    const noCompare = { ...tbApiData, comparisonMode: 'none', comparisonLabel: '' };
    expect(() => exportCaseWareTrialBalance(noCompare)).not.toThrow();
    const csv = await lastCsv();
    expect(csv).not.toContain('Prior Year Debit');
    expect(csv).toContain('"1000","Cash","1001","asset","500.00","0.00"');
  });
});

// Exact shape returned by GET /api/reports/balance-sheet (route.ts)
const bsApiData: any = {
  companyName: '2751623 Alberta Corp.', currency: 'CAD',
  period: { asOf: '2026-09-30', label: 'September 30, 2026' },
  comparisonLabel: '', comparisonMode: 'none', generatedAt: '2026-11-19T00:00:00.000Z',
  sections: {
    assets: {
      current: { accounts: [{ code: '1000', name: 'Cash', detailType: null, balance: 700, priorBalance: 0 }], total: 700, priorTotal: 0 },
      nonCurrent: { accounts: [], total: 0, priorTotal: 0 },
      total: 700, priorTotal: 0,
    },
    liabilities: {
      current: { accounts: [{ code: '2000', name: 'Accounts Payable', detailType: null, balance: 200, priorBalance: 0 }], total: 200, priorTotal: 0 },
      nonCurrent: { accounts: [], total: 0, priorTotal: 0 },
      total: 200, priorTotal: 0,
    },
    equity: {
      common_shares: { accounts: [{ code: '3000', name: 'Common Shares', detailType: null, balance: 100, priorBalance: 0 }], total: 100, priorTotal: 0 },
      retained_earnings: { accounts: [{ code: '', name: 'Current Year Earnings', detailType: null, balance: 400, priorBalance: 0 }], total: 400, priorTotal: 0 },
    },
    totalEquity: 500, priorTotalEquity: 0,
    totalLiabilitiesAndEquity: 700, priorTotalLiabilitiesAndEquity: 0,
  },
  isBalanced: true,
};

describe('balance sheet downloads', () => {
  test('CSV export downloads with sections, equity groups and totals', async () => {
    expect(() => exportBalanceSheet(bsApiData)).not.toThrow();
    expect(clickedLinks).toHaveLength(1);
    expect(clickedLinks[0].download).toBe('balance-sheet-2026-09-30.csv');
    const csv = await lastCsv();
    expect(csv).toContain('"Current Assets","1000","Cash","700.00","0.00"');
    expect(csv).toContain('"Total Assets","","","700.00","0.00"');
    expect(csv).toContain('"Common Shares","3000","Common Shares","100.00","0.00"');
    expect(csv).toContain('"Total Liabilities & Equity","","","700.00","0.00"');
  });
});

describe('other report exports stay intact', () => {
  test('P&L CSV export still downloads', async () => {
    const pnl: any = {
      period: { startDate: '2026-01-01' },
      sections: {
        income: { rows: [{ name: 'Revenue', amount: 1000, priorAmount: 0, changePct: 0 }], total: 1000, priorTotal: 0, changePct: 0 },
        cogs: { rows: [], total: 0, priorTotal: 0, changePct: 0 },
        grossProfit: { amount: 1000, priorAmount: 0, changePct: 0 },
        operatingExpenses: { rows: [{ name: 'Rent', amount: 300, priorAmount: 0, changePct: 0 }], total: 300, priorTotal: 0, changePct: 0 },
        netIncome: { amount: 700, priorAmount: 0, changePct: 0 },
      },
    };
    expect(() => exportPandL(pnl)).not.toThrow();
    expect(clickedLinks[0].download).toBe('profit-loss-2026-01-01.csv');
    const csv = await lastCsv();
    expect(csv).toContain('"NET INCOME","700.00"');
  });
});
