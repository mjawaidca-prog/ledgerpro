import { NextRequest, NextResponse } from 'next/server';
import { requireCompanies } from '@/lib/api-helpers';
import { buildConsolidatedDrilldown } from '@/lib/consolidation/engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/consolidated/drilldown?code=…&companyIds=…&asOf=…&currency=…
 * Per-entity contribution for one consolidated line (group drill-down).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code') ?? '';
    const companyIds = (searchParams.get('companyIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const currency = searchParams.get('currency') ?? 'CAD';

    const { error } = await requireCompanies(req, companyIds);
    if (error) return error;

    if (!code) return NextResponse.json({ error: 'Missing account code.' }, { status: 400 });

    const data = await buildConsolidatedDrilldown({ companyIds, asOf, currency, code });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('GET /api/reports/consolidated/drilldown error:', err);
    return NextResponse.json({ error: 'Failed to build drill-down' }, { status: 500 });
  }
}
