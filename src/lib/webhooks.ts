// API-D webhooks: signed, retried, visible and replayable event delivery to
// connected applications. Separate from Stripe payment webhooks.
//
// - API-write events are inserted as durable WebhookDelivery rows in the
//   accounting transaction. Dashboard emitters remain best-effort.
// - Each delivery is HMAC-SHA256 signed with the endpoint secret and carries
//   a stable event id, so consumers can verify and dedupe.
// - Delivery retries follow a fixed backoff ladder; a delivery is sent at
//   most once per attempt. Replay resets the ladder in place.
// - Destination URLs are validated against private/internal networks before
//   every attempt and pinned to the verified IP. Redirects are not followed.

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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
    // real activity; the daily cron is the catch-all. AWAITED (bounded): a
    // fire-and-forget promise would be frozen the moment this request's
    // response returns on serverless, and the deliveries would never go out.
    try {
      await sweepDueDeliveries(opts.companyId, 5);
    } catch (e) {
      console.error('[webhooks] Piggyback sweep failed:', e);
    }
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
      endpoint: { enabled: true, ...(companyId ? { companyId } : {}) },
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

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 6) {
    // Permit global unicast only. This rejects unspecified, mapped IPv4,
    // NAT64, link-local, ULA, multicast and other transition mechanisms.
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [first, second = '0'] = normalized.split(':');
    const a = parseInt(first, 16), b = parseInt(second || '0', 16);
    return (a & 0xe000) !== 0x2000 || a === 0x2002 ||
      (a === 0x2001 && (b < 0x200 || b === 0xdb8)) || a === 0x3fff;
  }
  if (family !== 4) return true;
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

type Destination = { ok: true; parsed: URL; address: string; family: number } | { ok: false; reason: string };

/**
 * Validates a webhook destination: http/https only, and every resolved IP
 * must be public (no loopback, private, link-local, CGNAT or unspecified
 * addresses). Called before EVERY delivery attempt.
 */
async function resolveWebhookUrl(url: string): Promise<Destination> {
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
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await import('node:dns/promises').then((dns) => dns.lookup(hostname, { all: true }));
    if (!addresses.length) return { ok: false, reason: 'Destination host does not resolve.' };
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        return { ok: false, reason: 'Destination resolves to a private or internal address.' };
      }
    }
    return { ok: true, parsed, address: addresses[0].address, family: isIP(addresses[0].address) };
  } catch {
    return { ok: false, reason: 'Destination host does not resolve.' };
  }
}

export async function validateWebhookUrl(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await resolveWebhookUrl(url);
  return result.ok ? { ok: true } : result;
}

/** Native transport pins DNS to the checked IP, preserving TLS hostname checks.
 * Never follow redirects with accounting payloads or signature headers. */
export async function safeFetchWebhook(
  url: string,
  init: RequestInit
): Promise<Response> {
  const check = await resolveWebhookUrl(url);
  if (!check.ok) throw new Error(`webhook_ssrf: ${check.reason}`);
  if (init.signal?.aborted) throw new Error('Webhook delivery aborted');
  if (init.body != null && typeof init.body !== 'string') throw new Error('Webhook body must be text');
  return new Promise((resolve, reject) => {
    const request = check.parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(check.parsed, {
      method: init.method ?? 'POST',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      agent: false,
      family: check.family,
      lookup: (_hostname, _options, callback) => callback(null, check.address, check.family),
      signal: init.signal ?? undefined,
    }, (res) => {
      // Only status is needed. Do not buffer an untrusted/unbounded response.
      const status = res.statusCode ?? 502;
      res.destroy();
      resolve(new Response(null, { status }));
    });
    req.on('error', reject);
    req.end(init.body ?? undefined);
  });
}

/**
 * Sends one delivery attempt. Success marks the delivery done; failure
 * advances the backoff ladder and records the error for the delivery
 * history. Returns the updated status.
 */
export async function deliverWebhook(deliveryId: string): Promise<WebhookDeliveryStatus> {
  return db.$transaction(async (tx) => {
    // Serialize delivery across cron and request piggyback sweeps. Holding the
    // transaction-scoped advisory lock through the bounded HTTP attempt ensures
    // that a single delivery attempt is never sent concurrently.
    const lockKey = `webhook-delivery:${deliveryId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const delivery = await tx.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || delivery.status === 'success' || delivery.status === 'dead') {
      return delivery?.status ?? 'dead';
    }
    if (!delivery.endpoint.enabled) {
      // Preserve history for explicit replay; disabling must stop queued retries.
      await tx.webhookDelivery.update({ where: { id: delivery.id }, data: {
        status: 'dead', nextAttemptAt: null, lastError: 'Webhook endpoint disabled',
      } });
      return 'dead';
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
        // Bound each attempt so one slow endpoint can't stall the sweep.
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'success', attempts: attempt, lastError: null, deliveredAt: new Date(), nextAttemptAt: null },
        });
        return 'success';
      }

      const error = `HTTP ${res.status}`;
      if (attempt >= MAX_ATTEMPTS) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'dead', attempts: attempt, lastError: error, nextAttemptAt: null },
        });
        return 'dead';
      }
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', attempts: attempt, lastError: error, nextAttemptAt: nextAttemptAtFor(attempt) },
      });
      return 'failed';
    } catch (e: any) {
      const error = e?.message?.slice(0, 500) ?? 'Unknown delivery error';
      if (attempt >= MAX_ATTEMPTS) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'dead', attempts: attempt, lastError: error, nextAttemptAt: null },
        });
        return 'dead';
      }
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', attempts: attempt, lastError: error, nextAttemptAt: nextAttemptAtFor(attempt) },
      });
      return 'failed';
    }
  }, { maxWait: 10000, timeout: 12000 });
}
