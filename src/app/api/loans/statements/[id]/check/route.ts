import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { computeStatementCheck } from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/loans/statements/[id]/check?loanId=… — the statement-vs-
 * schedule check as a PREVIEW: balances compared to the cent and the
 * difference classified, with nothing persisted. Applying the result
 * (and any correction) is the separate POST …/apply action.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const loanId = new URL(req.url).searchParams.get('loanId');
    if (!loanId) return NextResponse.json({ error: 'Pass ?loanId= for the loan to check against.' }, { status: 400 });

    const data = await computeStatementCheck(companyId!, params.id, loanId);
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('GET /api/loans/statements/[id]/check error:', err);
    const status = /not found/i.test(err?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: err.message || 'Failed to compute the check' }, { status });
  }
}
