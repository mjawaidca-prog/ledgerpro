import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/fx/usage — entry counts per currency (drives the currency chips). */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const rows = await db.journalLine.groupBy({
      by: ['currency'],
      where: { journalEntry: { companyId } },
      _count: { _all: true },
    });

    return NextResponse.json({
      data: rows.map((r) => ({ currency: r.currency ?? 'CAD', entries: r._count._all })),
    });
  } catch (err) {
    console.error('GET /api/fx/usage error:', err);
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 });
  }
}
