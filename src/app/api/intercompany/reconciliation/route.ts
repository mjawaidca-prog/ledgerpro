import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { reconcile, findUnmatchedLegacy } from '@/lib/intercompany/reconcile';
export const dynamic = 'force-dynamic';

// GET — reconcile inter-company balances as at a given date
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get('asOf');
    const asOf = asOfParam ? new Date(asOfParam) : new Date();

    const [rows, legacy] = await Promise.all([
      reconcile(asOf),
      searchParams.get('includeLegacy') === 'true' ? findUnmatchedLegacy() : Promise.resolve([]),
    ]);

    const hasBreak = rows.some((r) => r.status === 'Break');

    return NextResponse.json({
      data: {
        asOf: asOf.toISOString().slice(0, 10),
        rows,
        hasBreak,
        legacy,
      },
    });
  } catch (error: any) {
    console.error('GET /api/intercompany/reconciliation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reconcile' },
      { status: 500 }
    );
  }
}
