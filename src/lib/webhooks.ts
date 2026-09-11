// API-D webhooks: signed, retried, visible and replayable event delivery to
// connected applications. Separate from Stripe payment webhooks.
//
// - Events are emitted as durable WebhookDelivery rows — emitting is
//   best-effort and can never fail the mutation that produced the event.
// - Each delivery is HMAC-SHA256 signed with the endpoint secret and carries
//   a stable event id, so consumers can verify and dedupe.
// - Delivery retries follow a fixed backoff ladder; a delivery is sent at
//   most once per attempt. Replay resets the ladder in place.
// - Destination URLs are validated against private/internal networks before
//   every attempt, redirects included (SSRF protection).

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import type { WebhookDeliveryStatus } from '@prisma/client';

export const WEBHOOK_EVENTS = [
  'invoice.created',
  'invoice.posted',
  'bill.created',
  'bill.updated',
  'payment.recorded',
  'journal.posted',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Fixed backoff ladder between attempts (minutes). After the last, dead. */
export const DELIVERY_BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const;
export const MAX_ATTEMPTS = DELIVERY_BACKOFF_MINUTES.length;

export function nextAttemptAtFor(attempts: number, now = new Date()): Date {
  const idx = Math.min(attempts, DELIVERY_BACKOFF_MINUTES.length - 1);
  return new Date(now.getTime() + DELIVERY_BACKOFF_MINUTES[idx] * 60_000);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

/**
 * Emits an event to every enabled endpoint subscribed to it. Best-effort:
 * failures are logged, never thrown, and never roll back the mutation.
 * Delivery rows are unique per (endpoint, eventId) so re-emitting (e.g. a
 * retried API request) cannot queue duplicates.
 */
export async function emitWebhookEvent(opts: {
  companyId: string;
  eventType: WebhookEventType;
  eventId?: string;
  payload: unknown;
}): Promise<void> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { companyId: opts.companyId, enabled: true, events: { has: opts.eventType } },
      select: { id: true },
    });
    if (!endpoints.length) return;

    const eventId = opts.eventId ?? randomUUID();
    for (const endpoint of endpoints) {
      try {
        await db.webhookDelivery.create({
          data: {
            endpointId: endpoint.id,
            eventType: opts.eventType,
            eventId,
            payload: opts.payload as object,
            attempts: 0,
            status: 'pending',
            nextAttemptAt: new Date(),
          },
        });
      } catch (e: any) {
        // Unique (endpointId, eventId) violation means the event is already
        // queued for this endpoint — the correct outcome, not an error.
        if (e?.code !== 'P2002') {
          console.error('[webhooks] Failed to queue delivery:', e);
        }
      }
    }

    // Piggyback sweep: deliver this company's due deliveries now. Vercel's
    // Hobby plan limits crons to one run per day, so retries ride along with
    // real activity; the daily cron is the catch-all. Best-effort only.
    sweepDueDeliveries(opts.companyId, 10).catch((e) => {
      console.error('[webhooks] Piggyback sweep failed:', e);
    });
  } catch (e) {
    console.error('[webhooks] Failed to emit event:', e);
  }
}

/**
 * Delivers up to `limit` due deliveries for one company (or every company
 * when companyId is null — the daily cron's catch-all mode).
 */
export async function sweepDueDeliveries(companyId: string | null, limit: number): Promise<{ processed: number; delivered: number }> {
  const due = await db.webhookDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      nextAttemptAt: { lte: new Date() },
      ...(companyId ? { endpoint: { companyId } } : {}),
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  let delivered = 0;
  for (const d of due) {
    const status = await deliverWebhook(d.id);
    if (status === 'success') delivered += 1;
  }
  return { processed: due.length, delivered };
}

// ── SSRF protection ─────────────────────────────────────────

const PRIVATE_IPV4 = [
  /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^0\./,
];
const PRIVATE_IPV6 = [/^::1$/, /^fc/i, /^fd/i, /^fe[89ab]/i];

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return PRIVATE_IPV6.some((re) => re.test(normalized));
  }
  return PRIVATE_IPV4.some((re) => re.test(ip));
}

const MAX_REDIRECTS = 3;

/**
 * Validates a webhook destination: http/https only, and every resolved IP
 * must be public (no loopback, private, link-local, CGNAT or unspecified
 * addresses). Called before EVERY delivery attempt.
 */
export async function validateWebhookUrl(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Destination is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Destination must use http or https.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Destination must not embed credentials.' };
  }
  try {
    const addresses = await import('node:dns/promises').then((dns) => dns.lookup(parsed.hostname, { all: true }));
    if (!addresses.length) return { ok: false, reason: 'Destination host does not resolve.' };
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        return { ok: false, reason: 'Destination resolves to a private or internal address.' };
      }
    }
  } catch {
    return { ok: false, reason: 'Destination host does not resolve.' };
  }
  return { ok: true };
}

/** Follows up to MAX_REDIRECTS hops, re-validating each destination. */
export async function safeFetchWebhook(
  url: string,
  init: RequestInit,
  redirectsLeft = MAX_REDIRECTS
): Promise<Response> {
  const check = await validateWebhookUrl(url);
  if (!check.ok) throw new Error(`webhook_ssrf: ${check.reason}`);
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (redirectsLeft <= 0) throw new Error('webhook_ssrf: too many redirects');
    const next = new URL(res.headers.get('location')!, url).toString();
    return safeFetchWebhook(next, init, redirectsLeft - 1);
  }
  return res;
}

/**
 * Sends one delivery attempt. Success marks the delivery done; failure
 * advances the backoff ladder and records the error for the delivery
 * history. Returns the updated status.
 */
export async function deliverWebhook(deliveryId: string): Promise<WebhookDeliveryStatus> {
  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === 'success' || delivery.status === 'dead') {
    return delivery?.status ?? 'dead';
  }

  const attempt = delivery.attempts + 1;
  try {
    const body = JSON.stringify(delivery.payload);
    const timestamp = Date.now();
    const signature = signWebhookPayload(delivery.endpoint.secret, body, timestamp);
    const res = await safeFetchWebhook(delivery.endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ledgerpro-event': delivery.eventType,
        'x-ledgerpro-event-id': delivery.eventId,
        'x-ledgerpro-timestamp': String(timestamp),
        'x-ledgerpro-signature': `sha256=${signature}`,
      },
      body,
    });

    if (res.ok) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'success', attempts: attempt, lastError: null, deliveredAt: new Date(), nextAttemptAt: null },
      });
      return 'success';
    }

    const error = `HTTP ${res.status}`;
    if (attempt >= MAX_ATTEMPTS) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'dead', attempts: attempt, lastError: error, nextAttemptAt: null },
      });
      return 'dead';
    }
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', attempts: attempt, lastError: error, nextAttemptAt: nextAttemptAtFor(attempt) },
    });
    return 'failed';
  } catch (e: any) {
    const error = e?.message?.slice(0, 500) ?? 'Unknown delivery error';
    if (attempt >= MAX_ATTEMPTS) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'dead', attempts: attempt, lastError: error, nextAttemptAt: null },
      });
      return 'dead';
    }
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', attempts: attempt, lastError: error, nextAttemptAt: nextAttemptAtFor(attempt) },
    });
    return 'failed';
  }
}
