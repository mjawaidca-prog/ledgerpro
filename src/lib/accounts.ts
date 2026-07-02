/**
 * The authoritative balance for a bank/credit-card account is its linked GL
 * account's balance (ChartOfAccount.balance via FinancialAccount.glAccountCode)
 * — not the separately-maintained FinancialAccount.currentBalance field.
 *
 * currentBalance is updated piecemeal by several different mutation paths
 * (post-gl, void, opening-balance) and misses anything that affects the
 * account without going through a Transaction row at all: opening balance
 * journal entries, invoice/bill payments, and transfers. ChartOfAccount.balance,
 * by contrast, is comprehensively and correctly maintained by postJournalEntry
 * for every source of activity, with the correct type-aware sign convention
 * already applied — a credit card (a liability) carries a positive balance
 * meaning "amount owed," matching how it's presented on the Balance Sheet and
 * Trial Balance, with no separate sign-flipping needed at display time.
 */

import { db } from '@/lib/db';

export async function getFinancialAccountBalances(
  companyId: string,
  accounts: { id: string; glAccountCode: string | null }[]
): Promise<Record<string, number>> {
  const codes = [...new Set(accounts.map((a) => a.glAccountCode).filter((c): c is string => !!c))];
  const coaAccounts = codes.length
    ? await db.chartOfAccount.findMany({ where: { companyId, code: { in: codes } }, select: { code: true, balance: true } })
    : [];
  const balanceByCode = new Map(coaAccounts.map((a) => [a.code, Number(a.balance)]));

  const result: Record<string, number> = {};
  for (const a of accounts) {
    result[a.id] = a.glAccountCode ? balanceByCode.get(a.glAccountCode) ?? 0 : 0;
  }
  return result;
}
