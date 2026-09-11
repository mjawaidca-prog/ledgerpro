import { NextRequest, NextResponse } from 'next/server';
import { sweepDueDeliveries } from '@/lib/webhooks';
export const dynamic = 'force-dynamic';

// GET /api/webhooks/deliver-cron — Vercel cron entrypoint (daily catch-all;
// Vercel Hobby limits crons to one run per day). Sends every due delivery —
// retries normally ride along with real activity via piggyback sweeps.
// Guarded by CRON_SECRET like the other cron routes.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sweepDueDeliveries(null, 50);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('GET /api/webhooks/deliver-cron error:', error);
    return NextResponse.json({ error: 'Webhook delivery run failed' }, { status: 500 });
  }
}
