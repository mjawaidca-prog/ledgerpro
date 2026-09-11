import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// DELETE — remove an endpoint (and its delivery history) immediately.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const existing = await db.webhookEndpoint.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true, url: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 });
    }

    await db.webhookEndpoint.delete({ where: { id: params.id } });
    await auditLog(session.companyId!, session.userId, 'webhook.endpoint.delete', 'webhook_endpoint', params.id, undefined, {
      url: existing.url,
    });

    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/webhooks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete webhook endpoint' }, { status: 500 });
  }
}
