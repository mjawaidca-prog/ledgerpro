import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { generateWebhookSecret, validateWebhookUrl, WEBHOOK_EVENTS, emitWebhookEvent } from '@/lib/webhooks';
import { randomUUID } from 'node:crypto';
export const dynamic = 'force-dynamic';

// GET — list this company's webhook endpoints (secrets never returned).
export async function GET(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const endpoints = await db.webhookEndpoint.findMany({
      where: { companyId: session.companyId! },
      select: {
        id: true, url: true, description: true, events: true, enabled: true, createdAt: true, updatedAt: true,
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, eventType: true, eventId: true, status: true, attempts: true, lastError: true, deliveredAt: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ data: endpoints });
  } catch (error) {
    console.error('GET /api/webhooks error:', error);
    return NextResponse.json({ error: 'Failed to load webhooks' }, { status: 500 });
  }
}

// POST — create an endpoint. The signing secret is returned exactly once.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const body = await req.json().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 200) : null;
    const events = Array.isArray(body?.events) ? body.events : [];

    if (!url) {
      return NextResponse.json({ error: 'A destination URL is required.' }, { status: 400 });
    }
    const check = await validateWebhookUrl(url);
    if (!check.ok) {
      return NextResponse.json({ error: `Destination rejected: ${check.reason}` }, { status: 400 });
    }
    const valid = events.filter((e: unknown) => (WEBHOOK_EVENTS as readonly string[]).includes(e as string));
    if (!valid.length) {
      return NextResponse.json({ error: `At least one valid event is required (${WEBHOOK_EVENTS.join(', ')}).` }, { status: 400 });
    }

    const secret = generateWebhookSecret();
    const endpoint = await db.webhookEndpoint.create({
      data: {
        companyId: session.companyId!,
        url,
        description,
        secret,
        events: valid,
        createdById: session.userId ?? null,
      },
      select: { id: true, url: true, description: true, events: true, enabled: true, createdAt: true },
    });

    await auditLog(session.companyId!, session.userId, 'webhook.endpoint.create', 'webhook_endpoint', endpoint.id, undefined, {
      url: endpoint.url,
      events: endpoint.events,
    });

    // The secret appears in this response and nowhere else.
    return NextResponse.json({ data: { endpoint, secret } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/webhooks error:', error);
    return NextResponse.json({ error: 'Failed to create webhook endpoint' }, { status: 500 });
  }
}
