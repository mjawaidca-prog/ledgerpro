import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { postTransactionToLedger } from '@/lib/journal';
export const dynamic = 'force-dynamic';

// POST — post categorized bank transactions to the General Ledger
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { transactionIds } = body as { transactionIds: string[] };

    if (!transactionIds?.length) {
      return NextResponse.json({ error: 'No transaction IDs provided' }, { status: 400 });
    }

    const transactions = await db.transaction.findMany({
      where: { id: { in: transactionIds }, companyId, status: 'categorized' },
      include: { account: { select: { glAccountCode: true } }, category: { select: { code: true, name: true } } },
    });

    if (transactions.length === 0) {
      return NextResponse.json({ error: 'No categorized transactions found' }, { status: 400 });
    }

    const posted: string[] = [];
    const skipped: string[] = [];
    const closedPeriod: string[] = [];

    for (const tx of transactions) {
      if (tx.status !== 'categorized' || !tx.category) {
        skipped.push(tx.id);
        continue;
      }

      // A transaction dated in a closed period can't be posted — the user needs
      // to either reopen the period or leave it uncategorized for a correcting entry.
      if (await closedPeriodGuard(companyId, tx.date)) {
        closedPeriod.push(tx.id);
        continue;
      }

      const glCode = tx.account?.glAccountCode;
      const entry = await postTransactionToLedger(
        { id: tx.id, date: tx.date, description: tx.description, amount: Number(tx.amount) },
        glCode ?? undefined,
        tx.category.code,
        companyId
      );

      // Mark transaction as reconciled
      await db.transaction.update({
        where: { id: tx.id },
        data: { status: 'reconciled', matchRef: entry.id },
      });

      // Update financial account balance
      if (glCode) {
        const finAcct = await db.financialAccount.findFirst({ where: { glAccountCode: glCode, companyId: tx.companyId } });
        if (finAcct) {
          await db.financialAccount.update({
            where: { id: finAcct.id },
            data: { currentBalance: { increment: Number(tx.amount) } },
          });
        }
      }

      posted.push(tx.id);
    }

    await auditLog(companyId, userId, 'transaction.post_gl', 'transaction', undefined, { postedIds: posted, skippedIds: skipped, closedPeriodIds: closedPeriod });

    return NextResponse.json({
      data: { posted: posted.length, skipped: skipped.length, closedPeriod: closedPeriod.length, postedIds: posted, skippedIds: skipped, closedPeriodIds: closedPeriod },
    });
  } catch (error: any) {
    console.error('POST /api/transactions/post-gl error:', error);
    return NextResponse.json({ error: error.message || 'Failed to post to GL' }, { status: 500 });
  }
}
