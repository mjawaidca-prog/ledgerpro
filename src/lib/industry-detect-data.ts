/**
 * Industry re-detection — profile builder (Phase 2 item 5).
 *
 * Loads a company's real activity from the db and shapes it into the
 * pure IndustryActivityProfile that src/lib/industry-detect.ts scores:
 *   - per-account activity: categorized bank transactions (count) and
 *     posted journal lines (count) per chart account, plus the stored
 *     balance;
 *   - transaction text (description + merchant + payee guess) split by
 *     direction, for the payee/description keyword signals.
 *
 * Compute-on-read by design: the suggestion endpoint calls this when
 * the dashboard loads, so a bank import that just landed is reflected
 * on the next view with no import-pipeline hook and no cached state
 * to invalidate. Row loads are capped — detection needs a
 * representative sample, not the whole ledger.
 */

import { db } from './db';
import type { AccountActivity, IndustryActivityProfile, TextActivity } from './industry-detect';

const MAX_TRANSACTIONS = 5000;
const MAX_JOURNAL_LINES = 20000;

/** The slice of the Prisma client this builder needs (injectable for tests). */
export interface IndustryDetectDataClient {
  chartOfAccount: {
    findMany: (args: any) => Promise<any[]>;
  };
  transaction: {
    findMany: (args: any) => Promise<any[]>;
  };
  journalLine: {
    findMany: (args: any) => Promise<any[]>;
  };
}

export async function buildIndustryActivityProfile(
  companyId: string,
  client: IndustryDetectDataClient = db as unknown as IndustryDetectDataClient,
): Promise<IndustryActivityProfile> {
  const [accounts, transactions, journalLines] = await Promise.all([
    client.chartOfAccount.findMany({
      where: { companyId, active: true },
      select: { id: true, code: true, name: true, type: true, gifiCode: true, balance: true },
    }),
    client.transaction.findMany({
      where: { companyId, status: { notIn: ['excluded', 'voided'] } },
      select: {
        categoryId: true,
        amount: true,
        description: true,
        merchant: true,
        payeeGuess: true,
      },
      orderBy: { date: 'desc' },
      take: MAX_TRANSACTIONS,
    }),
    client.journalLine.findMany({
      where: { journalEntry: { companyId, voidedAt: null } },
      select: { glAccountCode: true },
      take: MAX_JOURNAL_LINES,
    }),
  ]);

  const txCountByCategory = new Map<string, number>();
  const expenseTexts: TextActivity[] = [];
  const incomeTexts: TextActivity[] = [];
  let totalExpenseAmount = 0;
  let totalIncomeAmount = 0;
  let categorizedCount = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amount);
    if (tx.categoryId) {
      categorizedCount += 1;
      txCountByCategory.set(tx.categoryId, (txCountByCategory.get(tx.categoryId) ?? 0) + 1);
    }
    const text = [tx.description, tx.merchant, tx.payeeGuess]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ');
    if (amount < 0) {
      totalExpenseAmount += Math.abs(amount);
      if (text) expenseTexts.push({ text, amount: Math.abs(amount) });
    } else if (amount > 0) {
      totalIncomeAmount += amount;
      if (text) incomeTexts.push({ text, amount });
    }
  }

  const journalCountByCode = new Map<string, number>();
  for (const line of journalLines) {
    journalCountByCode.set(line.glAccountCode, (journalCountByCode.get(line.glAccountCode) ?? 0) + 1);
  }

  const accountActivity: AccountActivity[] = accounts.map((a: any) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    gifiCode: a.gifiCode ?? null,
    balance: Number(a.balance),
    txCount: txCountByCategory.get(a.id) ?? 0,
    journalCount: journalCountByCode.get(a.code) ?? 0,
  }));

  return {
    accounts: accountActivity,
    expenseTexts,
    incomeTexts,
    totalExpenseAmount,
    totalIncomeAmount,
    activityCount: categorizedCount + journalLines.length,
  };
}
