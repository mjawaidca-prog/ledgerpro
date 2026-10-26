/**
 * Phase 0.1 — Balance Sheet lines must FOOT to their printed totals, and
 * the Chart of Accounts summary must agree with the Balance Sheet.
 *
 * Live finding (Oct 26, 2026, Muja — 2751623 Alberta Corporation, FY2025):
 * the Balance Sheet badge said "Balanced ✓" and its totals were the
 * correct signed sums (Assets $124,960.27 = L+E $124,960.27), yet the
 * DISPLAYED asset lines summed to $164,825.27 and Liabilities + Equity
 * components summed to $196,732.27 ≠ $124,960.27.
 *
 * Root cause: the balance-sheet page rendered every amount with money()
 * (src/lib/money.ts), which formats Math.abs(n) — sign is silently
 * dropped. Two Muja accounts carry "wrong-side" balances that the signed
 * totals net but the printed lines showed positive:
 *   - 1090 Suspense — Unidentified Deposits (asset): credit balance
 *     −$19,932.50, printed +$19,932.50 (lines over by 2 × 19,932.50).
 *   - 2010/2020 credit-card clearing (liabilities): debit balances
 *     −$32,886.00 / −$3,000.00 in liability-normal terms, printed
 *     +$35,886.00 total (L+E components over by 2 × 35,886.00 = $71,772).
 * The COA summary cards showed a THIRD set of numbers (ASSET $145,681.65,
 * EQUITY $0.00) because /api/coa summed the mutable ChartOfAccount.balance
 * column with a parent rollup — double-counting the bank balance held on
 * both 1000 and its child 1010 (+$20,721.38) — and never folded unclosed
 * earnings into equity.
 */
jest.mock('@/lib/db', () => ({ db: {} }));

import { normalBalance, balanceSheetTotals, coaSummaryFromActivity, netEarnings } from '@/lib/reporting';
import { money, moneySigned } from '@/lib/money';

type Act = Record<string, { debits: number; credits: number }>;
const act = (debits: number, credits: number) => ({ debits, credits });

// Muja journal activity, reconstructed so normal balances reproduce the
// live-audited figures exactly (TB $200,107.25 Dr = Cr; P&L net $160,846.27).
const accounts = [
  { code: '1010', type: 'asset' },     // Business Checking
  { code: '1090', type: 'asset' },     // Suspense — Unidentified Deposits (credit balance)
  { code: '1095', type: 'asset' },     // Suspense — Unidentified Payments
  { code: '3010', type: 'asset' },     // Due from Shareholder / Shareholder Draws
  { code: '2010', type: 'liability' }, // Credit-card clearing (debit balance)
  { code: '2020', type: 'liability' }, // Credit-card clearing (debit balance)
  { code: '3100', type: 'equity' },    // Retained Earnings
  { code: '4000', type: 'income' },
  { code: '5300', type: 'expense' },
  { code: '5410', type: 'expense' },
  { code: '5600', type: 'expense' },
];
const activity: Act = {
  '1010': act(20721.38, 0),
  '1090': act(0, 19932.5),
  '1095': act(50099.01, 0),
  '3010': act(74072.38, 0),
  '2010': act(32886.0, 0),
  '2020': act(3000.0, 0),
  '3100': act(0, 0),
  '4000': act(0, 180174.75),
  '5300': act(8756.89, 0),
  '5410': act(10495.59, 0),
  '5600': act(76.0, 0),
};

const linesFor = (type: string) =>
  accounts.filter((a) => a.type === type).map((a) => ({ code: a.code, balance: normalBalance(a.type as any, activity[a.code]) }));
const sum = (rows: { balance: number }[]) => Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100;
/** Parse a rendered currency string back to a number ("−$19,932.50" → -19932.50). */
const parseRendered = (s: string) => Number(s.replace(/[−]/g, '-').replace(/[$,]/g, ''));

describe('Phase 0.1 — balance sheet lines foot to totals (Muja fixture)', () => {
  const assets = linesFor('asset');
  const liabilities = linesFor('liability');
  const equityAccts = linesFor('equity');
  const earnings = netEarnings(activity, accounts);
  const totals = balanceSheetTotals({
    assetBalances: assets.map((r) => r.balance),
    liabilityBalances: liabilities.map((r) => r.balance),
    equityAccountBalances: equityAccts.map((r) => r.balance),
    cumulativeUnclosedEarnings: earnings,
  });

  test('signed line balances reproduce the live totals', () => {
    expect(sum(assets)).toBe(124960.27);
    expect(sum(liabilities)).toBe(-35886.0);
    expect(totals.totalAssets).toBe(124960.27);
    expect(totals.totalEquity).toBe(160846.27);
    expect(totals.totalLiabilitiesAndEquity).toBe(124960.27);
    expect(totals.isBalanced).toBe(true);
  });

  test('wrong-side balances are negative in the signed aggregation', () => {
    expect(assets.find((r) => r.code === '1090')!.balance).toBe(-19932.5);
    expect(liabilities.find((r) => r.code === '2010')!.balance).toBe(-32886.0);
    expect(liabilities.find((r) => r.code === '2020')!.balance).toBe(-3000.0);
  });

  test('money() drops the sign — the original bug, kept as a guard', () => {
    // Sum of what the OLD page printed for the asset lines:
    const printedOld = assets.reduce((s, r) => s + parseRendered(money(r.balance)), 0);
    expect(Math.round(printedOld * 100) / 100).toBe(164825.27);
    expect(printedOld).not.toBe(totals.totalAssets);
  });

  test('moneySigned() preserves the sign — displayed lines foot to totals', () => {
    const printedAssets = assets.reduce((s, r) => s + parseRendered(moneySigned(r.balance)), 0);
    const printedLiabilities = liabilities.reduce((s, r) => s + parseRendered(moneySigned(r.balance)), 0);
    const printedEquity = equityAccts.reduce((s, r) => s + parseRendered(moneySigned(r.balance)), 0) + earnings;
    expect(Math.round(printedAssets * 100) / 100).toBe(totals.totalAssets);
    expect(Math.round(printedLiabilities * 100) / 100).toBe(totals.totalLiabilities);
    expect(Math.round(printedEquity * 100) / 100).toBe(totals.totalEquity);
    expect(Math.round((printedLiabilities + printedEquity) * 100) / 100).toBe(totals.totalLiabilitiesAndEquity);
  });

  test('moneySigned renders negatives with a minus and positives plainly', () => {
    expect(moneySigned(-19932.5)).toBe('−$19,932.50');
    expect(moneySigned(20721.38)).toBe('$20,721.38');
    expect(moneySigned(0)).toBe('$0.00');
  });
});

describe('Phase 0.1 — COA summary equals balance sheet totals (Muja fixture)', () => {
  const summary = coaSummaryFromActivity(accounts, activity);

  test('summary matches the balance sheet / P&L anchors', () => {
    expect(summary.assets).toBe(124960.27); // NOT 145,681.65 (bank double-count)
    expect(summary.liabilities).toBe(-35886.0);
    expect(summary.equity).toBe(160846.27); // NOT 0 — unclosed earnings folded in
    expect(summary.income).toBe(180174.75);
    expect(summary.expenses).toBe(19328.48);
    expect(Math.round((summary.income - summary.expenses) * 100) / 100).toBe(160846.27);
  });

  test('summary assets/liabilities/equity satisfy the accounting equation', () => {
    expect(Math.round((summary.liabilities + summary.equity) * 100) / 100).toBe(summary.assets);
  });

  test('a parent and child holding the same balance are NOT double-counted', () => {
    // Journal activity lives on the child code only (as Muja's TB shows:
    // 1000 nil, 1010 $20,721.38). Summing per-code activity counts it once,
    // unlike the old balance-column parent rollup.
    const accts = [
      { code: '1000', type: 'asset' },
      { code: '1010', type: 'asset' },
    ];
    const actMap: Act = { '1000': act(0, 0), '1010': act(20721.38, 0) };
    expect(coaSummaryFromActivity(accts, actMap).assets).toBe(20721.38);
  });
});
