import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { loadMatchProposals } from '@/lib/recon/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank-transactions/[id]/match-proposals — the reconciliation
 * assistant's ranked proposals for one bank row (Phase 3 item 1):
 * single documents, existing journal entries, exact-sum splits, and
 * document+remainder pairings, each with confidence + reasons.
 * Propose-only: nothing is written by this route.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const loaded = await loadMatchProposals(companyId, params.id);
    if (!loaded) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    return NextResponse.json({
      data: { proposals: loaded.proposals, alreadyPosted: loaded.alreadyPosted },
    });
  } catch (err) {
    console.error('GET /api/bank-transactions/[id]/match-proposals error:', err);
    return NextResponse.json({ error: 'Failed to build match proposals' }, { status: 500 });
  }
}
