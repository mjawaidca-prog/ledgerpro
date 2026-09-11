import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deliverWebhook } from '@/lib/webhooks';
export const dynamic = 'force-dynamic';

// GET /api/webhooks/deliver-cron — Vercel cron entrypoint. Sends due
// webhook deliveries (pending or failed with an elapsed backoff window).
// Guarded by CRON_SECRET like the other cron routes.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const due = await db.webhookDelivery.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50, // bounded batch per cron tick
    });

    let sent = 0;
    for (const delivery of due) {
      const status = await deliverWebhook(delivery.id);
      if (status === 'success') sent += 1;
    }

    return NextResponse.json({ data: { processed: due.length, delivered: sent } });
  } catch (error) {
    console.error('GET /api/webhooks/deliver-cron error:', error);
    return NextResponse.json({ error: 'Webhook delivery run failed' }, { status: 500 });
  }
}
