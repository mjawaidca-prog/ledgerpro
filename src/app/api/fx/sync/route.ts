import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { runFeedSync } from '@/lib/fx/feed';

export const dynamic = 'force-dynamic';

/** POST /api/fx/sync — pull the Bank of Canada feed for this company (owner|admin). */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;
    if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await runFeedSync(companyId);
    await auditLog(companyId, userId, 'fx_feed.sync', 'FxFeedStatus', undefined, result as any);

    return NextResponse.json({ data: result });
  } catch (err: any) {
    console.error('POST /api/fx/sync error:', err);
    return NextResponse.json(
      { error: err?.message || 'Feed sync failed' },
      { status: 502 }
    );
  }
}
