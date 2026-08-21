/**
 * Single bank-row posting — shared by the review queue's Categorize/Split
 * CTAs and (indirectly) the legacy post-gl flow. Handles per-row FX rate
 * resolution for foreign-currency accounts (rate frozen at the row's date,
 * never the import date) and split postings.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { resolveRate } from '@/lib/fx/rate';
import { buildPostingLines, computeSplitTaxes, round2 } from './splits';
import { postJournalEntry, postTransactionToLedger } from '@/lib/journal';

export interface BankRow {
  id: string;
  companyId: string;
  financialAccountId: string;
  date: Date;
  description: string;
  amount: number;
  currency: string;
  fxRate: Prisma.Decimal | null;
  amountHome: Prisma.Decimal | null;
  splits: { categoryCode: string; amount: number; taxCode: string | null; taxRate: number | null; taxInclusive: boolean; memo?: string }[] | null;
  categoryId: string | null;
  account: { glAccountCode: string | null; currency: string } | null;
  category: { code: string; name: string } | null;
}

/**
 * Post a single bank row. With splits → multi-line posting via
 * buildPostingLines; otherwise the existing postTransactionToLedger path.
 * Returns the created journal entry id.
 */
export async function postBankRow(opts: { row: BankRow; companyId: string; homeCurrency: string }): Promise<string> {
  const { row, companyId, homeCurrency } = opts;

  const glCode = row.account?.glAccountCode;
  if (!glCode) {
    throw new Error("The row's bank account has no linked GL account code. Link it in Chart of Accounts before posting.");
  }

  // Splits path — one journal entry with one line per split (+ tax on 2300).
  if (row.splits && row.splits.length > 0) {
    const computed = computeSplitTaxes(row.splits);
    const isFx = row.currency !== homeCurrency;
    let fxRate: number | null = null;
    if (isFx) {
      const resolved = await resolveRate(row.currency, homeCurrency, row.date, 'daily');
      fxRate = resolved.rate;
      if (!fxRate) {
        throw new Error(`No ${row.currency} → ${homeCurrency} rate for ${row.date.toISOString().slice(0, 10)}. Add one in Settings › FX Rates, then post again.`);
      }
    }

    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode })),
      direction: row.amount > 0 ? 'in' : 'out',
      bankAccountCode: glCode,
      total: Math.abs(Number(row.amount)),
      description: row.description,
      currency: isFx ? row.currency : undefined,
      fxRate: fxRate ?? undefined,
      amountForeign: isFx ? Math.abs(Number(row.amount)) : undefined,
    });

    const entry = await postJournalEntry(
      {
        entryDate: row.date,
        description: row.description,
        sourceType: 'payment',
        sourceId: row.id,
        lines,
      },
      companyId
    );

    await db.transaction.update({
      where: { id: row.id },
      data: {
        status: 'reconciled',
        matchRef: entry.id,
        fxRate: fxRate !== null ? new Prisma.Decimal(fxRate) : null,
        amountHome: isFx ? new Prisma.Decimal(round2(Math.abs(Number(row.amount)) * (fxRate ?? 1))) : null,
      },
    });

    return entry.id;
  }

  // Single-category path — existing logic with FX resolution at the row date.
  if (!row.category) {
    throw new Error('Choose a category before posting.');
  }

  const isFx = row.currency !== homeCurrency;
  let fxRate: number | null = null;
  let amountHome: number | undefined;
  if (isFx) {
    const resolved = await resolveRate(row.currency, homeCurrency, row.date, 'daily');
    fxRate = resolved.rate;
    if (!fxRate) {
      throw new Error(`No ${row.currency} → ${homeCurrency} rate for ${row.date.toISOString().slice(0, 10)}. Add one in Settings › FX Rates, then post again.`);
    }
    amountHome = round2(Math.abs(Number(row.amount)) * fxRate);
  }

  const entry = await postTransactionToLedger(
    {
      id: row.id,
      date: row.date,
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      fxRate: fxRate ?? undefined,
      amountHome,
    },
    glCode,
    row.category.code,
    companyId
  );

  await db.transaction.update({
    where: { id: row.id },
    data: {
      status: 'reconciled',
      matchRef: entry.id,
      fxRate: fxRate !== null ? new Prisma.Decimal(fxRate) : null,
      amountHome: amountHome !== undefined ? new Prisma.Decimal(amountHome) : null,
    },
  });

  return entry.id;
}
