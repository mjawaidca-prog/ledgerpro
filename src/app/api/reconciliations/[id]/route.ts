import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { reconcileVerdict } from '@/lib/banking/reconcile-math';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/reconciliations/[id] — update ticks / statement balance /
 * unrecorded items. The server recomputes the verdict from the tick state
 * every time — client math is never trusted. Tick/untick sets or clears
 * reconciledInId/reconciledAt only; `status` is untouched (posted-to-GL
 * remains the exclusive meaning of 'reconciled').
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const rec = await db.reconciliation.findUnique({
      where: { id: params.id, companyId },
      include: { transactions: { select: { id: true } } },
    });
    if (!rec) return NextResponse.json({ error: 'Reconciliation not found.' }, { status: 404 });
    if (rec.state !== 'open') return NextResponse.json({ error: 'This reconciliation is closed.' }, { status: 409 });

    const body = await req.json();

    if (body.statementClosingBalance !== undefined) {
      await db.reconciliation.update({
        where: { id: rec.id },
        data: { statementClosingBalance: Number(body.statementClosingBalance) },
      });
    }
    if (body.unrecordedItems !== undefined) {
      await db.reconciliation.update({
        where: { id: rec.id },
        data: { unrecordedItems: body.unrecordedItems as any },
      });
    }

    if (Array.isArray(body.tickedTransactionIds)) {
      const ticked = new Set<string>(body.tickedTransactionIds);
      const current = new Set(rec.transactions.map((t) => t.id));

      const toTick = [...ticked].filter((id) => !current.has(id));
      const toUntick = [...current].filter((id) => !ticked.has(id));

      if (toTick.length) {
        await db.transaction.updateMany({
          where: { id: { in: toTick }, companyId, financialAccountId: rec.financialAccountId },
          data: { reconciledInId: rec.id, reconciledAt: new Date(), reconciledBy: userId ?? null },
        });
      }
      if (toUntick.length) {
        await db.transaction.updateMany({
          where: { id: { in: toUntick }, companyId },
          data: { reconciledInId: null, reconciledAt: null, reconciledBy: null },
        });
      }
    }

    // Recompute the verdict from the tick state.
    const updated = await db.reconciliation.findUnique({
      where: { id: rec.id },
      include: { transactions: { select: { id: true, date: true, description: true, amount: true } } },
    });
    if (!updated) return NextResponse.json({ error: 'Reconciliation not found.' }, { status: 404 });

    const candidates = await db.transaction.findMany({
      where: { financialAccountId: rec.financialAccountId, status: { notIn: ['excluded', 'transfer', 'voided'] } },
      select: { id: true, date: true, description: true, amount: true },
    });

    const priorLocked = await db.reconciliation.findFirst({
      where: { financialAccountId: rec.financialAccountId, state: { in: ['locked', 'closed_with_variance'] }, id: { not: rec.id } },
      orderBy: { periodEnd: 'desc' },
    });
    const opening = priorLocked ? Number(priorLocked.statementClosingBalance) : 0;

    const tickedIds = new Set(updated.transactions.map((t) => t.id));
    const tickedRows = candidates.filter((t) => tickedIds.has(t.id));
    const untickedRows = candidates.filter((t) => !tickedIds.has(t.id) && t.date <= updated.periodEnd);
    const unrecorded = (updated.unrecordedItems as { description: string; amount: number }[] | null) ?? [];

    const verdict = reconcileVerdict({
      statementClosingBalance: Number(updated.statementClosingBalance),
      openingReconciledBalance: opening,
      tickedAmounts: tickedRows.map((t) => Number(t.amount)),
      unticked: untickedRows.map((t) => ({ description: t.description, amount: Number(t.amount) })),
      unrecordedItems: unrecorded,
    });

    await auditLog(companyId, userId, 'reconciliation.update', 'Reconciliation', rec.id, { tickedCount: tickedRows.length, difference: verdict.difference } as any);

    return NextResponse.json({
      data: {
        ...verdict,
        tickedCount: tickedRows.length,
        totalCandidates: candidates.length,
      },
    });
  } catch (err) {
    console.error('PATCH /api/reconciliations/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update the reconciliation' }, { status: 500 });
  }
}
