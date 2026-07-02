/**
 * Shared balance computation for financial statements.
 *
 * Balance Sheet and P&L both need account balances as of / over a date
 * range that isn't "now" — but ChartOfAccount.balance is a single mutable
 * running total, not time-scoped. These helpers derive real point-in-time
 * (or period) balances from JournalLine activity instead, the same way
 * trial-balance and general-ledger already correctly do it. A voided entry
 * and its reversal are just two rows that net to zero in the aggregation,
 * so no special-casing for void status is needed here.
 */

import { db } from '@/lib/db';
import type { GLType } from '@prisma/client';

export interface AccountActivity {
  debits: number;
  credits: number;
}

/** Sum of debit/credit journal-line activity per GL account code within an optional date range. */
export async function getGLActivity(
  companyId: string,
  range: { from?: Date; to: Date }
): Promise<Record<string, AccountActivity>> {
  const entryDate: any = { lte: range.to };
  if (range.from) entryDate.gte = range.from;

  const lines = await db.journalLine.findMany({
    where: { journalEntry: { companyId, entryDate } },
    select: { glAccountCode: true, debit: true, credit: true },
  });

  const activity: Record<string, AccountActivity> = {};
  for (const line of lines) {
    if (!activity[line.glAccountCode]) activity[line.glAccountCode] = { debits: 0, credits: 0 };
    activity[line.glAccountCode].debits += Number(line.debit);
    activity[line.glAccountCode].credits += Number(line.credit);
  }
  return activity;
}

/** Net balance in an account's normal-balance direction (positive = normal side). */
export function normalBalance(type: GLType, activity: AccountActivity | undefined): number {
  const debits = activity?.debits ?? 0;
  const credits = activity?.credits ?? 0;
  return type === 'asset' || type === 'expense' ? debits - credits : credits - debits;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Splits an account's balance into a trial-balance-style debit/credit pair — exactly one side is non-zero. */
export function toDebitCredit(type: GLType, activity: AccountActivity | undefined): { debit: number; credit: number } {
  const net = normalBalance(type, activity);
  if (type === 'asset' || type === 'expense') {
    return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net };
  }
  return net >= 0 ? { debit: 0, credit: net } : { debit: -net, credit: 0 };
}
