import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST — replay a failed or dead delivery: the backoff ladder resets and the
// next cron tick sends it again. Successful deliveries are not replayed
// (duplicate prevention is the consumer's job, but we never resend successes).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const delivery = await db.webhookDelivery.findFirst({
      where: { id: params.id, endpoint: { companyId: session.companyId! } },
      select: { id: true, status: true },
    });
    if (!delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }
    if (delivery.status === 'success') {
      return NextResponse.json({ error: 'Successful deliveries are not replayed.' }, { status: 409 });
    }

    await db.webhookDelivery.update({
      where: { id: params.id },
      data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });

    await auditLog(session.companyId!, session.userId, 'webhook.delivery.retry', 'webhook_delivery', params.id);

    return NextResponse.json({ data: { id: params.id, requeued: true } });
  } catch (error) {
    console.error('POST /api/webhooks/deliveries/[id]/retry error:', error);
    return NextResponse.json({ error: 'Failed to requeue delivery' }, { status: 500 });
  }
}
