import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard, accountLockedGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { allocation } from '@/lib/banking/splits';
import { postBankRow } from '@/lib/banking/posting';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/[id]/split — store split lines (Σ must equal
 * |amount| to the cent) and optionally post as one transaction with multiple
 * ledger lines.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const splits = Array.isArray(body.splits) ? body.splits : [];
    const post = Boolean(body.post);

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { glAccountCode: true, currency: true } } },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    const lockGuard = await accountLockedGuard(companyId, tx.financialAccountId, tx.date);
    if (lockGuard) return lockGuard;
    const periodGuard = await closedPeriodGuard(companyId, tx.date);
    if (periodGuard) return periodGuard;

    const { remainder } = allocation(
      splits.map((s: any) => ({ amount: Number(s.amount) })),
      Math.abs(Number(tx.amount))
    );
    if (Math.abs(remainder) > 0.005) {
      return NextResponse.json(
        { error: `Posting is blocked until the lines add up to the transaction — ${remainder.toFixed(2)} still to allocate.` },
        { status: 400 }
      );
    }

    await db.transaction.update({
      where: { id: params.id },
      data: { splits: splits as any, status: 'categorized' },
    });

    let entryId: string | null = null;
    if (post) {
      const row = await db.transaction.findUnique({
        where: { id: params.id },
        include: {
          account: { select: { glAccountCode: true, currency: true } },
          category: { select: { code: true, name: true } },
        },
      });
      if (!row) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
      const company = await db.company.findUnique({ where: { id: companyId } });
      entryId = await postBankRow({ row: row as any, companyId, homeCurrency: company?.currency ?? 'CAD' });
    }

    await auditLog(companyId, userId, 'bank_transaction.split', 'transaction', params.id, { splitCount: splits.length, post } as any);

    return NextResponse.json({ data: { split: true, entryId } });
  } catch (err: any) {
    console.error('POST /api/bank-transactions/[id]/split error:', err);
    return NextResponse.json({ error: err.message || 'Failed to split' }, { status: 500 });
  }
}
