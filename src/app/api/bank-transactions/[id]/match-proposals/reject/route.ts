import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { recordRejection } from '@/lib/recon/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/[id]/match-proposals/reject — "not this
 * match". The pairing (this row × these targets) is recorded and never
 * proposed again for this row. Body:
 * { kind: 'single'|'split'|'doc_remainder',
 *   targets: [{ type, id, ref? }], reason? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const tx = await db.transaction.findUnique({ where: { id: params.id, companyId } });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    const body = await req.json();
    const kind = body.kind === 'split' ? 'split' : body.kind === 'doc_remainder' ? 'doc_remainder' : 'single';
    const targets: { type: string; id: string; ref?: string | null }[] = Array.isArray(body.targets)
      ? body.targets.filter((t: any) => t && typeof t.type === 'string' && typeof t.id === 'string')
      : [];
    if (targets.length === 0) {
      return NextResponse.json({ error: 'No targets to reject.' }, { status: 400 });
    }

    await recordRejection({
      companyId,
      transactionId: params.id,
      kind,
      targets,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
      userId: userId ?? null,
    });

    await auditLog(companyId, userId, 'bank_transaction.match_reject', 'transaction', params.id, {
      kind,
      targets,
    } as any);

    return NextResponse.json({ data: { rejected: true } }, { status: 201 });
  } catch (err) {
    console.error('POST /api/bank-transactions/[id]/match-proposals/reject error:', err);
    return NextResponse.json({ error: 'Failed to record the rejection' }, { status: 500 });
  }
}
