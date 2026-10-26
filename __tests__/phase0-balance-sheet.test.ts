/**
 * Phase 0 (P0-2) — Balance Sheet must balance.
 *
 * Regression test for the live Muja finding (Oct 26, 2026): the Balance
 * Sheet reported Assets $124,960.27 vs Liabilities + Equity $35,886.00 and
 * flagged itself "Unbalanced", while the Trial Balance for the same books
 * balanced at $200,107.25 = $200,107.25. Root cause: the balance-sheet
 * builders added only the CURRENT fiscal year's earnings to equity, so all
 * earnings from prior (unclosed) fiscal years vanished from equity.
 *
 * These tests exercise the shared pure helpers in src/lib/reporting.ts that
 * both balance-sheet builders (dashboard route + v1 API) now use.
 */
// reporting.ts imports the Prisma-backed db module at the top level; the
// helpers under test are pure, so stub db out (the Prisma client is not
// generated in every sandbox, and these tests must run regardless).
jest.mock('@/lib/db', () => ({ db: {} }));

import { unclosedEarnings, netEarnings, balanceSheetTotals, isCurrentAccount } from '@/lib/reporting';

type Act = Record<string, { debits: number; credits: number }>;
const act = (debits: number, credits: number) => ({ debits, credits });

const incomeExpense = [
  { code: '4000', type: 'income' },
  { code: '5300', type: 'expense' },
  { code: '5410', type: 'expense' },
  { code: '5600', type: 'expense' },
];

describe('Phase 0 — unclosed earnings', () => {
  test('Muja-shaped books: prior-year earnings are NOT dropped', () => {
    // All activity happened in the PRIOR fiscal year (FY2025-26); the report
    // is run as at a date in the NEXT fiscal year, so current-year activity
    // is empty — exactly the live scenario that produced $0 equity.
    const toDate: Act = {
      '4000': act(0, 180174.75),
      '5300': act(8756.89, 0),
      '5410': act(10495.59, 0),
      '5600': act(76.0, 0),
    };
    const currentYear: Act = {};

    const e = unclosedEarnings(toDate, currentYear, incomeExpense);
    expect(e.currentYear).toBe(0);
    expect(e.priorYears).toBe(160846.27);
    expect(e.cumulative).toBe(160846.27);
  });

  test('closed years do not double-count: closing entries shrink unclosed earnings', () => {
    // After a closing entry, income is debited back to zero and retained
    // earnings (an equity account, not in this list) is credited. The
    // income/expense activity then nets to ~0, so cumulative unclosed
    // earnings must be ~0 — the earnings live in the equity account instead.
    const toDate: Act = { '4000': act(1000, 1000), '5300': act(300, 300) };
    expect(netEarnings(toDate, incomeExpense)).toBe(0);
  });

  test('balance sheet balances on the Muja numbers with cumulative earnings', () => {
    // Normal-balance amounts taken from the live audit:
    // assets: bank 20,721.38 + suspense payments 50,099.01
    //         + suspense deposits −19,932.50 (credit-balance asset)
    //         + shareholder draws 74,072.38  = 124,960.27
    // liabilities (normal balance): card clearing accounts carry DEBIT
    // balances, i.e. −32,886.00 and −3,000.00 in liability-normal terms.
    const totals = balanceSheetTotals({
      assetBalances: [20721.38, 50099.01, -19932.5, 74072.38],
      liabilityBalances: [-32886.0, -3000.0],
      equityAccountBalances: [0, 0, 0],
      cumulativeUnclosedEarnings: 160846.27,
    });
    expect(totals.totalAssets).toBe(124960.27);
    expect(totals.totalEquity).toBe(160846.27);
    expect(totals.totalLiabilitiesAndEquity).toBe(124960.27);
    expect(totals.isBalanced).toBe(true);
  });

  test('the OLD behaviour (current-year earnings only) does NOT balance — regression guard', () => {
    const totals = balanceSheetTotals({
      assetBalances: [20721.38, 50099.01, -19932.5, 74072.38],
      liabilityBalances: [-32886.0, -3000.0],
      equityAccountBalances: [0, 0, 0],
      cumulativeUnclosedEarnings: 0, // as-of date in the next FY, nothing closed
    });
    expect(totals.isBalanced).toBe(false);
  });
});

describe('Phase 0 — current/non-current classification', () => {
  test('3010 Due from Shareholder (asset, no subType) is CURRENT, not non-current', () => {
    expect(isCurrentAccount({ code: '3010', type: 'asset', subType: null, detailType: null, name: 'Due from Shareholder / Shareholder Draws' })).toBe(true);
  });
  test('explicit subType still wins', () => {
    expect(isCurrentAccount({ code: '1500', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', name: 'Furniture & Equipment' })).toBe(false);
    expect(isCurrentAccount({ code: '2500', type: 'liability', subType: 'long_term_liability', detailType: 'Loans payable', name: 'Loans Payable' })).toBe(false);
  });
  test('ordinary bank account coded 1010 stays current', () => {
    expect(isCurrentAccount({ code: '1010', type: 'asset', subType: null, detailType: 'Bank', name: 'Business Checking' })).toBe(true);
  });
});
