import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { emitWebhookEvent } from '@/lib/webhooks';
export const dynamic = 'force-dynamic';

// POST — queue a synthetic test event for this endpoint so the owner can
// verify delivery end to end without touching the books.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const endpoint = await db.webhookEndpoint.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true, events: true },
    });
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    const eventType = endpoint.events[0] ?? 'invoice.created';
    await emitWebhookEvent({
      companyId: session.companyId!,
      eventType: eventType as any,
      payload: {
        event: eventType,
        test: true,
        message: 'LedgerPro webhook test event',
        sentAt: new Date().toISOString(),
      },
    });

    await auditLog(session.companyId!, session.userId, 'webhook.endpoint.test', 'webhook_endpoint', params.id);

    return NextResponse.json({ data: { queued: true, eventType } });
  } catch (error) {
    console.error('POST /api/webhooks/[id]/test error:', error);
    return NextResponse.json({ error: 'Failed to send test event' }, { status: 500 });
  }
}
