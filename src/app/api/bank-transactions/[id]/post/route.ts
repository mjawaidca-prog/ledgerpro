import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard, accountLockedGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { postBankRow } from '@/lib/banking/posting';

export const dynamic = 'force-dynamic';

/** POST /api/bank-transactions/[id]/post — post a categorized row (splits-aware). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: {
        account: { select: { glAccountCode: true, currency: true } },
        category: { select: { code: true, name: true } },
      },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
    if (tx.status === 'reconciled' && tx.matchRef) return NextResponse.json({ error: 'This row is already posted.' }, { status: 409 });

    const lockGuard = await accountLockedGuard(companyId, tx.financialAccountId, tx.date);
    if (lockGuard) return lockGuard;
    const periodGuard = await closedPeriodGuard(companyId, tx.date);
    if (periodGuard) return periodGuard;

    const company = await db.company.findUnique({ where: { id: companyId } });
    const entryId = await postBankRow({ row: tx as any, companyId, homeCurrency: company?.currency ?? 'CAD' });

    await auditLog(companyId, userId, 'bank_transaction.post', 'transaction', params.id, { entryId } as any);

    return NextResponse.json({ data: { posted: true, entryId } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/bank-transactions/[id]/post error:', err);
    return NextResponse.json({ error: err.message || 'Failed to post' }, { status: 500 });
  }
}
