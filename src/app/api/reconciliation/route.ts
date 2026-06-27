import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET /api/reconciliation — get unreconciled items for an account
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    }

    // Verify account belongs to company
    const account = await db.financialAccount.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, currentBalance: true, companyId: true, glAccountCode: true },
    });
    if (!account || account.companyId !== companyId) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Get unreconciled imported transactions for this account
    const transactions = await db.transaction.findMany({
      where: {
        companyId,
        financialAccountId: accountId,
        status: { in: ['toreview', 'categorized'] },
        reconciledAt: null,
      },
      include: {
        category: { select: { code: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 200,
    });

    // Get journal lines affecting this account's GL
    const journalLines = account.glAccountCode
      ? await db.journalLine.findMany({
          where: {
            glAccountCode: account.glAccountCode,
            journalEntry: { companyId },
          },
          include: {
            journalEntry: { select: { id: true, entryDate: true, description: true, sourceType: true, sourceId: true } },
          },
          orderBy: { journalEntry: { entryDate: 'desc' } },
          take: 200,
        })
      : [];

    // Stats
    const [unreconciledCount, totalUnreconciled] = await Promise.all([
      db.transaction.count({
        where: { companyId, financialAccountId: accountId, reconciledAt: null, status: { not: 'excluded' } },
      }),
      db.transaction.aggregate({
        where: { companyId, financialAccountId: accountId, reconciledAt: null, status: { not: 'excluded' } },
        _sum: { amount: true },
      }),
    ]);

    const statementBalance = Number(totalUnreconciled._sum.amount || 0);

    return NextResponse.json({
      data: {
        account: {
          id: account.id,
          name: account.name,
          currentBalance: Number(account.currentBalance),
          glAccountCode: account.glAccountCode,
        },
        transactions: transactions.map((tx) => ({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          merchant: tx.merchant,
          amount: Number(tx.amount),
          status: tx.status,
          category: tx.category ? { code: tx.category.code, name: tx.category.name } : null,
        })),
        journalLines: journalLines.map((jl) => ({
          id: jl.id,
          entryId: jl.journalEntry.id,
          date: jl.journalEntry.entryDate,
          description: jl.journalEntry.description,
          sourceType: jl.journalEntry.sourceType,
          sourceId: jl.journalEntry.sourceId,
          debit: Number(jl.debit),
          credit: Number(jl.credit),
        })),
        stats: {
          unreconciledCount,
          statementBalance,
          glBalance: Number(account.currentBalance),
        },
      },
    });
  } catch (error) {
    console.error('GET /api/reconciliation error:', error);
    return NextResponse.json({ error: 'Failed to load reconciliation data' }, { status: 500 });
  }
}

// POST /api/reconciliation — mark transactions as reconciled
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { transactionIds } = body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json({ error: 'transactionIds array is required' }, { status: 400 });
    }

    // Verify all transactions belong to this company
    const txs = await db.transaction.findMany({
      where: { id: { in: transactionIds }, companyId },
      select: { id: true },
    });

    if (txs.length !== transactionIds.length) {
      return NextResponse.json({ error: 'Some transactions not found' }, { status: 404 });
    }

    // Batch reconcile
    const now = new Date();
    await db.transaction.updateMany({
      where: { id: { in: transactionIds }, companyId },
      data: {
        reconciledAt: now,
        reconciledBy: userId,
        status: 'reconciled',
      },
    });

    await auditLog(companyId, userId, 'transaction.reconcile', 'transaction', undefined, {
      reconciledIds: transactionIds,
      count: transactionIds.length,
    });

    return NextResponse.json({
      data: {
        reconciledCount: transactionIds.length,
        reconciledAt: now,
      },
    });
  } catch (error) {
    console.error('POST /api/reconciliation error:', error);
    return NextResponse.json({ error: 'Failed to reconcile transactions' }, { status: 500 });
  }
}
