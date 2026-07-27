/**
 * LedgerPro — Inter-company reconciliation engine.
 *
 * For each active related-party link, computes:
 *   A.dueFrom - A.dueTo + B.dueFrom - B.dueTo
 *
 * This must net to zero for the group to be in balance. A non-zero
 * difference can only come from a legacy entry, a direct database write,
 * or a partially restored backup — all worth knowing about the same day.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface ReconciliationRow {
  linkId: string;
  companyA: string;
  companyB: string;
  dueFrom: string;
  dueTo: string;
  difference: string;
  color: string;
  status: 'Matched' | 'Break';
  hasUnmatched: boolean;
}

/**
 * Aggregate the net balance of an account as of a given date.
 * For asset accounts (Due from): natural balance = debit - credit.
 * We return it as a signed decimal.
 */
async function accountBalance(
  accountId: string,
  asOf: Date
): Promise<Prisma.Decimal> {
  const result = await db.journalLine.aggregate({
    where: {
      glAccountCode: (
        await db.chartOfAccount.findUniqueOrThrow({
          where: { id: accountId },
          select: { code: true },
        })
      ).code,
      journalEntry: {
        entryDate: { lte: asOf },
        voidedAt: null,
      },
    },
    _sum: { debit: true, credit: true },
  });

  return (result._sum.debit ?? new Prisma.Decimal(0)).minus(
    result._sum.credit ?? new Prisma.Decimal(0)
  );
}

/**
 * Run reconciliation for all active related-party links.
 * Returns one row per link with net balances, difference, and status.
 */
export async function reconcile(asOf: Date): Promise<ReconciliationRow[]> {
  const links = await db.relatedPartyLink.findMany({
    where: { isActive: true },
    include: {
      companyA: { select: { id: true, name: true } },
      companyB: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = await Promise.all(
    links.map(async (link) => {
      const [aFrom, aTo, bFrom, bTo] = await Promise.all([
        accountBalance(link.aDueFromAccountId, asOf),
        accountBalance(link.aDueToAccountId, asOf),
        accountBalance(link.bDueFromAccountId, asOf),
        accountBalance(link.bDueToAccountId, asOf),
      ]);

      // Due to accounts have a natural credit balance (negative in our
      // debit-minus-credit convention), so adding them to Due from should
      // give us the net — but for reconciliation between companies, the
      // invariant is: what A says B owes = what B says it owes to A.
      // A.dueFrom should equal B.dueTo, and B.dueFrom should equal A.dueTo.
      // Net: (A.dueFrom - B.dueTo) + (B.dueFrom - A.dueTo) should = 0.
      const diff1 = aFrom.minus(bTo);   // A's Due from B  vs  B's Due to A
      const diff2 = bFrom.minus(aTo);   // B's Due from A  vs  A's Due to B
      const difference = diff1.plus(diff2);

      const isMatched = difference.abs().lt(0.005);

      // Check for unmatched transactions
      const unmatchedCount = await db.interCompanyTransaction.count({
        where: {
          linkId: link.id,
          status: 'UNMATCHED',
          date: { lte: asOf },
        },
      });

      return {
        linkId: link.id,
        companyA: link.companyA.name,
        companyB: link.companyB.name,
        dueFrom: aFrom.abs().toFixed(2),
        dueTo: aTo.abs().toFixed(2),
        difference: (difference.equals(0) ? '0.00' : (difference.gt(0) ? '+' : '−') + difference.abs().toFixed(2)),
        color: isMatched ? 'var(--success)' : 'var(--danger)',
        status: isMatched ? ('Matched' as const) : ('Break' as const),
        hasUnmatched: unmatchedCount > 0,
      };
    })
  );

  return rows;
}

/**
 * Find unmatched legacy entries — transactions that reference a control
 * account but were never recorded in the InterCompanyTransaction table.
 */
export async function findUnmatchedLegacy() {
  const controlAccounts = await db.chartOfAccount.findMany({
    where: { isControlAccount: true },
    select: { code: true, companyId: true, name: true },
  });

  const codesByCompany = new Map<string, string[]>();
  for (const a of controlAccounts) {
    const codes = codesByCompany.get(a.companyId) || [];
    codes.push(a.code);
    codesByCompany.set(a.companyId, codes);
  }

  const results: {
    companyId: string;
    entryId: string;
    accountCode: string;
    accountName: string;
    date: Date;
    description: string;
    debit: string;
    credit: string;
  }[] = [];

  for (const [companyId, codes] of codesByCompany) {
    const lines = await db.journalLine.findMany({
      where: {
        glAccountCode: { in: codes },
        journalEntry: {
          companyId,
          interCompanyId: null,
          voidedAt: null,
        },
      },
      include: {
        journalEntry: { select: { entryDate: true, description: true, id: true } },
      },
      orderBy: { journalEntry: { entryDate: 'desc' } },
      take: 100,
    });

    for (const line of lines) {
      const account = controlAccounts.find(
        (a) => a.code === line.glAccountCode && a.companyId === companyId
      );
      results.push({
        companyId,
        entryId: line.journalEntry.id,
        accountCode: line.glAccountCode,
        accountName: account?.name || line.glAccountCode,
        date: line.journalEntry.entryDate,
        description: line.journalEntry.description,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
      });
    }
  }

  return results;
}
