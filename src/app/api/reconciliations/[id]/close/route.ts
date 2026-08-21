import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { reconcileVerdict, nextLockedThrough } from '@/lib/banking/reconcile-math';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reconciliations/[id]/close — zero difference → locked (freezes
 * balances, advances account.lockedThrough monotonically). Non-zero →
 * requires a typed variance reason → closed_with_variance (lock NOT
 * advanced).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const varianceReason = typeof body.varianceReason === 'string' ? body.varianceReason.trim() : '';

    const rec = await db.reconciliation.findUnique({
      where: { id: params.id, companyId },
      include: { transactions: { select: { id: true, date: true, description: true, amount: true } } },
    });
    if (!rec) return NextResponse.json({ error: 'Reconciliation not found.' }, { status: 404 });
    if (rec.state !== 'open') return NextResponse.json({ error: 'This reconciliation is already closed.' }, { status: 409 });

    const candidates = await db.transaction.findMany({
      where: { financialAccountId: rec.financialAccountId, status: { notIn: ['excluded', 'transfer', 'voided'] } },
      select: { id: true, date: true, description: true, amount: true },
    });

    const priorLocked = await db.reconciliation.findFirst({
      where: { financialAccountId: rec.financialAccountId, state: { in: ['locked', 'closed_with_variance'] }, id: { not: rec.id } },
      orderBy: { periodEnd: 'desc' },
    });
    const opening = priorLocked ? Number(priorLocked.statementClosingBalance) : 0;

    const tickedIds = new Set(rec.transactions.map((t) => t.id));
    const tickedRows = candidates.filter((t) => tickedIds.has(t.id));
    const untickedRows = candidates.filter((t) => !tickedIds.has(t.id) && t.date <= rec.periodEnd);
    const unrecorded = (rec.unrecordedItems as { description: string; amount: number }[] | null) ?? [];

    const verdict = reconcileVerdict({
      statementClosingBalance: Number(rec.statementClosingBalance),
      openingReconciledBalance: opening,
      tickedAmounts: tickedRows.map((t) => Number(t.amount)),
      unticked: untickedRows.map((t) => ({ description: t.description, amount: Number(t.amount) })),
      unrecordedItems: unrecorded,
    });

    if (Math.abs(verdict.difference) >= 0.01 && !varianceReason) {
      return NextResponse.json(
        { error: 'A reason is required to close with a variance. It is recorded against the period.' },
        { status: 400 }
      );
    }

    const locked = Math.abs(verdict.difference) < 0.01;

    await db.$transaction(async (tx) => {
      await tx.reconciliation.update({
        where: { id: rec.id },
        data: {
          state: locked ? 'locked' : 'closed_with_variance',
          ledgerBalance: verdict.ledgerBalance,
          difference: verdict.difference,
          closedBy: userId ?? null,
          closedAt: new Date(),
          varianceReason: locked ? null : varianceReason,
        },
      });

      if (locked) {
        const account = await tx.financialAccount.findUnique({
          where: { id: rec.financialAccountId },
          select: { lockedThrough: true },
        });
        const current = account?.lockedThrough ? account.lockedThrough.toISOString().slice(0, 10) : null;
        const next = nextLockedThrough(current, rec.periodEnd.toISOString().slice(0, 10));
        await tx.financialAccount.update({
          where: { id: rec.financialAccountId },
          data: { lockedThrough: next ? new Date(next) : null },
        });
      }
    });

    await auditLog(companyId, userId, 'reconciliation.close', 'Reconciliation', rec.id, {
      locked, difference: verdict.difference, varianceReason: locked ? null : varianceReason,
    } as any);

    return NextResponse.json({ data: { state: locked ? 'locked' : 'closed_with_variance', difference: verdict.difference } });
  } catch (err) {
    console.error('POST /api/reconciliations/[id]/close error:', err);
    return NextResponse.json({ error: 'Failed to close the reconciliation' }, { status: 500 });
  }
}
