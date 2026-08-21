import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { rolledBackLockedThrough } from '@/lib/banking/reconcile-math';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reconciliations/[id]/reopen — requires a reason, audit-logged.
 * Rolls account.lockedThrough back to the previous locked reconciliation's
 * period end (or null) and clears tick fields for this reconciliation.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required to reopen a locked reconciliation.' }, { status: 400 });
    }

    const rec = await db.reconciliation.findUnique({ where: { id: params.id, companyId } });
    if (!rec) return NextResponse.json({ error: 'Reconciliation not found.' }, { status: 404 });
    if (rec.state === 'open') return NextResponse.json({ error: 'This reconciliation is already open.' }, { status: 409 });

    const priorLocked = await db.reconciliation.findFirst({
      where: { financialAccountId: rec.financialAccountId, state: { in: ['locked', 'closed_with_variance'] }, id: { not: rec.id } },
      orderBy: { periodEnd: 'desc' },
    });

    await db.$transaction(async (tx) => {
      await tx.reconciliation.update({
        where: { id: rec.id },
        data: { state: 'open', closedBy: null, closedAt: null, varianceReason: null, ledgerBalance: null, difference: null },
      });

      await tx.transaction.updateMany({
        where: { companyId, reconciledInId: rec.id },
        data: { reconciledInId: null, reconciledAt: null, reconciledBy: null },
      });

      // Roll the lock back to the prior locked period (monotonic rollback only).
      const account = await tx.financialAccount.findUnique({
        where: { id: rec.financialAccountId },
        select: { lockedThrough: true },
      });
      const current = account?.lockedThrough ? account.lockedThrough.toISOString().slice(0, 10) : null;
      if (current && current <= rec.periodEnd.toISOString().slice(0, 10)) {
        const rolledBack = rolledBackLockedThrough(
          current,
          priorLocked ? priorLocked.periodEnd.toISOString().slice(0, 10) : null
        );
        await tx.financialAccount.update({
          where: { id: rec.financialAccountId },
          data: { lockedThrough: rolledBack ? new Date(rolledBack) : null },
        });
      }
    });

    await auditLog(companyId, userId, 'reconciliation.reopen', 'Reconciliation', rec.id, { reason } as any);
    return NextResponse.json({ data: { reopened: true } });
  } catch (err) {
    console.error('POST /api/reconciliations/[id]/reopen error:', err);
    return NextResponse.json({ error: 'Failed to reopen the reconciliation' }, { status: 500 });
  }
}
