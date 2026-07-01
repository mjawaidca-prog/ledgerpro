import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const status = searchParams.get('status');
    const categoryId = searchParams.get('categoryId');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') ?? 'date';
    const dir = searchParams.get('dir') ?? 'desc';
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '50');
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    if (accountId) where.financialAccountId = accountId;
    if (status) {
      if (status === 'needsreview') {
        where.status = { in: ['toreview', 'transfer'] };
      } else {
        where.status = status;
      }
    }
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { merchant: { contains: search, mode: 'insensitive' } },
        { rawStatementText: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSorts = ['date', 'amount', 'description', 'status'];
    const orderBy: any = {};
    orderBy[allowedSorts.includes(sort) ? sort : 'date'] = dir === 'asc' ? 'asc' : 'desc';

    const [transactions, total, reviewCount] = await Promise.all([
      db.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          account: { select: { id: true, name: true, mask: true, kind: true, displayColor: true } },
          category: { select: { id: true, code: true, name: true } },
          transferMatch: { select: { id: true, confirmed: true } },
        },
      }),
      db.transaction.count({ where }),
      db.transaction.count({ where: { ...where, status: 'toreview' } }),
    ]);

    return NextResponse.json({
      data: transactions,
      summary: { toReview: reviewCount },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

// DELETE — bulk delete transactions by account, import batch, or specific IDs
export async function DELETE(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const importBatchId = searchParams.get('importBatchId');
    const idsParam = searchParams.get('ids');

    const where: any = { companyId };

    if (idsParam) {
      const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ error: 'No valid IDs provided' }, { status: 400 });
      }
      where.id = { in: ids };
    } else if (accountId) {
      where.financialAccountId = accountId;
    } else if (importBatchId) {
      where.importBatchId = importBatchId;
    } else if (searchParams.get('all') === 'true') {
      // Delete ALL transactions for this company — keep the where clause as-is (just companyId)
    } else {
      return NextResponse.json({ error: 'Provide accountId, importBatchId, ids, or all=true parameter' }, { status: 400 });
    }

    // Find all matching transactions to clean up posted ones
    const txns = await db.transaction.findMany({
      where,
      select: { id: true, status: true, matchRef: true, amount: true, account: { select: { glAccountCode: true } } },
    });

    if (txns.length === 0) {
      return NextResponse.json({ data: { deleted: 0, message: 'No transactions matched' } });
    }

    // Group by account for balance reversal
    const accountBalanceChanges: Record<string, number> = {};

    // Reverse journal entries for reconciled (posted) transactions
    const reconciled = txns.filter(t => t.status === 'reconciled' && t.matchRef);
    for (const tx of reconciled) {
      await reverseJournalEntryForBulk(tx.matchRef!, companyId);
    }

    // Track account balance reversals — ONLY for posted (reconciled) transactions.
    // Non-posted transactions (toreview/categorized) never affected the financial
    // account balance — reversing them would corrupt the balance.
    for (const tx of txns) {
      if (tx.status === 'reconciled') {
        const glCode = tx.account?.glAccountCode;
        if (glCode) {
          accountBalanceChanges[glCode] = (accountBalanceChanges[glCode] || 0) + Number(tx.amount);
        }
      }
    }

    // Reverse financial account balances
    // Use increment with negated amount; decrement:-X = increment:+X = BUG
    for (const [glCode, totalAmount] of Object.entries(accountBalanceChanges)) {
      await db.financialAccount.updateMany({
        where: { glAccountCode: glCode, companyId },
        data: { currentBalance: { increment: -totalAmount } },
      });
    }

    // Delete the transactions
    await db.transaction.deleteMany({ where });

    return NextResponse.json({ data: { deleted: txns.length } });
  } catch (error) {
    console.error('DELETE /api/transactions error:', error);
    return NextResponse.json({ error: 'Failed to delete transactions' }, { status: 500 });
  }
}

/** Reverse a journal entry for bulk delete */
async function reverseJournalEntryForBulk(matchRef: string, companyId: string) {
  const entry = await db.journalEntry.findUnique({
    where: { id: matchRef },
    include: { lines: true },
  });
  if (!entry) return;

  for (const line of entry.lines) {
    const acct = await db.chartOfAccount.findFirst({
      where: { code: line.glAccountCode, companyId },
    });
    if (!acct) continue;
    const net = Number(line.debit) - Number(line.credit);
    const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? -net : net;
    await db.chartOfAccount.update({
      where: { id: acct.id },
      data: { balance: { increment: balanceChange } },
    });
    if (acct.parentCode) {
      await db.chartOfAccount.updateMany({
        where: { code: acct.parentCode, companyId },
        data: { balance: { increment: balanceChange } },
      });
    }
  }

  await db.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
  await db.journalEntry.delete({ where: { id: entry.id } });
}
