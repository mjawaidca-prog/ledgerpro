import { NextRequest, NextResponse } from 'next/server';
import { runDueSyncs } from '@/lib/bank-feed/sync';
export const dynamic = 'force-dynamic';

// GET /api/plaid/sync-cron — the daily safety net: webhooks are the primary
// trigger, this catches connections whose webhook was missed. Guarded by
// CRON_SECRET like the other cron routes.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDueSyncs(20);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('GET /api/plaid/sync-cron error:', error);
    return NextResponse.json({ error: 'Bank feed sync run failed' }, { status: 500 });
  }
}
