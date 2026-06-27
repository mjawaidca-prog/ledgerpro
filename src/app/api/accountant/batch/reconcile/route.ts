import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const { transactionIds } = body as { transactionIds: string[] };

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json({ error: 'transactionIds array is required' }, { status: 400 });
    }

    const now = new Date();
    const result = await db.transaction.updateMany({
      where: { id: { in: transactionIds }, companyId },
      data: { reconciledAt: now, reconciledBy: userId, status: 'reconciled' },
    });

    await auditLog(companyId, userId, 'transaction.batch_reconcile', 'transaction', undefined, {
      transactionIds,
      count: result.count,
    });

    return NextResponse.json({ data: { reconciledCount: result.count, reconciledAt: now } });
  } catch (error) {
    console.error('POST /api/accountant/batch/reconcile error:', error);
    return NextResponse.json({ error: 'Batch reconcile failed' }, { status: 500 });
  }
}
