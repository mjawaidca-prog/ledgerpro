import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { voidJournalEntry } from '@/lib/journal';
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { categoryId, status, matchRef } = body;

    const existing = await db.transaction.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    if (existing.status === 'voided') {
      return NextResponse.json({ error: 'This transaction has been voided and cannot be edited' }, { status: 409 });
    }

    // Once posted to the GL, the category can only change via the reclassify
    // action (/api/reconciliation/[id]) which voids and reposts the journal
    // entry — editing categoryId here would leave the ledger out of sync.
    if (existing.status === 'reconciled' && categoryId !== undefined) {
      return NextResponse.json(
        { error: 'This transaction is already posted. Use reclassify to change its category.' },
        { status: 409 }
      );
    }

    const guardError = await closedPeriodGuard(companyId, existing.date);
    if (guardError) return guardError;

    const updateData: any = {};
    if (categoryId !== undefined) {
      const category = await db.chartOfAccount.findFirst({
        where: {
          companyId,
          OR: [
            { id: categoryId },
            { code: categoryId },
          ],
        },
      });

      if (!category) {
        return NextResponse.json({ error: 'Category not found' }, { status: 400 });
      }

      updateData.categoryId = category.id;
      updateData.status = 'categorized';
    }
    if (status) updateData.status = status;
    if (matchRef !== undefined) updateData.matchRef = matchRef;

    const tx = await db.transaction.update({
      where: { id: params.id },
      data: updateData,
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, code: true, name: true } },
      },
    });

    await auditLog(companyId, userId, 'transaction.update', 'transaction', params.id, { before: existing, after: tx });

    return NextResponse.json({ data: tx });
  } catch (error) {
    console.error('PUT /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { id: true, glAccountCode: true } } },
    });
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    if (existing.status === 'voided') {
      return NextResponse.json({ error: 'This transaction has already been voided' }, { status: 409 });
    }

    // Posted (reconciled) transactions are never hard-deleted — void them
    // instead so the reversing entry stays in the audit trail.
    if (existing.status === 'reconciled' && existing.matchRef) {
      const guardError = await closedPeriodGuard(companyId, new Date());
      if (guardError) return guardError;

      await voidJournalEntry(existing.matchRef, companyId, userId);

      if (existing.account?.glAccountCode) {
        await db.financialAccount.updateMany({
          where: { glAccountCode: existing.account.glAccountCode, companyId },
          data: { currentBalance: { increment: -Number(existing.amount) } },
        });
      }

      const voided = await db.transaction.update({
        where: { id: params.id },
        data: { status: 'voided', voidedAt: new Date(), voidedBy: userId },
      });

      await auditLog(companyId, userId, 'transaction.void', 'transaction', params.id, { before: existing, after: voided });

      return NextResponse.json({ data: { voided: params.id } });
    }

    // Never posted to the GL — safe to hard delete, no ledger impact.
    await db.transaction.delete({ where: { id: params.id } });

    await auditLog(companyId, userId, 'transaction.delete', 'transaction', params.id, { before: existing });

    return NextResponse.json({ data: { deleted: params.id } });
  } catch (error) {
    console.error('DELETE /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
