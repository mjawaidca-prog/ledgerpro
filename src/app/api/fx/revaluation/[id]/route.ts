import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { voidJournalEntry } from '@/lib/journal';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/fx/revaluation/[id] — void the revaluation. Both entries are
 * voided (never deleted — the reversal trail stays in the ledger).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const reval = await db.fxRevaluation.findUnique({
      where: { id: params.id, companyId },
      include: { journalEntry: true, reversalEntry: true },
    });
    if (!reval) return NextResponse.json({ error: 'Revaluation not found.' }, { status: 404 });
    if (reval.voidedAt) return NextResponse.json({ error: 'This revaluation is already voided.' }, { status: 409 });

    await db.$transaction(async (tx) => {
      await voidJournalEntry(reval.journalEntryId, companyId, userId ?? undefined, new Date(), tx);
      if (reval.reversalEntryId) {
        await voidJournalEntry(reval.reversalEntryId, companyId, userId ?? undefined, new Date(), tx);
      }
      await tx.fxRevaluation.update({
        where: { id: reval.id },
        data: { voidedAt: new Date() },
      });
    });

    await auditLog(companyId, userId, 'fx_revaluation.void', 'FxRevaluation', reval.id);

    return NextResponse.json({ data: { voided: true } });
  } catch (err: any) {
    console.error('DELETE /api/fx/revaluation/[id] error:', err);
    if (err.message?.includes('already been voided')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to void revaluation' }, { status: 500 });
  }
}
