import { NextRequest, NextResponse } from 'next/server';
import { runFeedSyncAll } from '@/lib/fx/feed';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fx/sync-cron — Vercel cron entrypoint. Syncs every company whose
 * rate source is the Bank of Canada feed. Guarded by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runFeedSyncAll();
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('GET /api/fx/sync-cron error:', err);
    return NextResponse.json({ error: 'Feed sync failed' }, { status: 502 });
  }
}
