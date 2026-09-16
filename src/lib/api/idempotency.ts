// Public API (v1) write idempotency. Every mutating endpoint requires an
// Idempotency-Key header. The record and the mutation commit in the SAME
// transaction: a retry waits for the transaction-scoped lock and replays
// the winner's response. No duplicate
// invoice, payment or journal entry can be created by a repeated request.

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { createHash } from 'node:crypto';
import { queueApiWebhookEvent } from '@/lib/api/write-effects';
import { sweepDueDeliveries, type WebhookEventType } from '@/lib/webhooks';

const MAX_KEY_LENGTH = 200;

export interface IdempotencyContext {
  requestKey: string;
  apiKeyId: string;
  companyId: string;
  method: string;
  path: string;
  requestHash: string;
}

export function idempotencyContextFrom(
  req: Request,
  ctx: { apiKeyId: string; companyId: string },
  payload: unknown = null
): { context: IdempotencyContext } | { error: NextResponse } {
  const key = req.headers.get('idempotency-key');
  if (!key || !key.trim()) {
    return {
      error: NextResponse.json(
        { error: { code: 'idempotency_key_required', message: 'Writes require an Idempotency-Key header (a unique string per request).' } },
        { status: 400 }
      ),
    };
  }
  const trimmed = key.trim();
  if (trimmed.length > MAX_KEY_LENGTH) {
    return {
      error: NextResponse.json(
        { error: { code: 'invalid_parameter', message: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters.` } },
        { status: 400 }
      ),
    };
  }
  const { pathname } = new URL(req.url);
  return {
    context: {
      requestKey: trimmed,
      apiKeyId: ctx.apiKeyId,
      companyId: ctx.companyId,
      method: req.method,
      path: pathname,
      requestHash: requestFingerprint(payload),
    },
  };
}

// Canonical JSON: object field order is immaterial, array order and scalar
// types remain significant. Hash the submitted JSON before schema defaults.
export function requestFingerprint(payload: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

export async function idempotencyRejection(response: NextResponse) {
  return { resourceType: 'validation_error', resourceId: null, statusCode: response.status, body: await response.json() };
}

export interface ApiWriteEffects {
  audit: { action: string; entityType: string; apiKeyName: string };
  eventType?: WebhookEventType;
}

export interface IdempotencyOutcome {
  /** The serializable response body. */
  body: unknown;
  statusCode: number;
  /** True when this is a replayed stored response, not a fresh execution. */
  replayed: boolean;
}

/**
 * Runs `execute` exactly once per (apiKeyId, requestKey). On replay the
 * stored response is returned verbatim. `execute` receives the transaction
 * client so the mutation itself can join the same transaction.
 */
export async function withIdempotency(
  ctx: IdempotencyContext,
  execute: (tx: Prisma.TransactionClient) => Promise<{
    resourceType: string;
    resourceId: string | null;
    statusCode: number;
    body: unknown;
  }>,
  effects?: ApiWriteEffects
): Promise<IdempotencyOutcome> {
  const outcome = await db.$transaction(async (tx) => {
    // Serialize retries BEFORE any accounting work. Transaction-scoped locks
    // release on commit/rollback; hash collisions only serialize extra requests.
    const lockKey = JSON.stringify([ctx.apiKeyId, ctx.requestKey]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const winner = await tx.apiIdempotencyRecord.findUnique({
      where: { apiKeyId_requestKey: { apiKeyId: ctx.apiKeyId, requestKey: ctx.requestKey } },
    });
    if (winner) {
      if (!winner.requestHash) {
        return { body: { error: { code: 'idempotency_legacy_record', message: 'This key predates payload verification. Check the existing resource before issuing a new request; automatic replay is unavailable.' } }, statusCode: 409, replayed: true };
      }
      if (winner.companyId !== ctx.companyId || winner.method !== ctx.method || winner.path !== ctx.path || winner.requestHash !== ctx.requestHash) {
        return { body: { error: { code: 'idempotency_key_conflict', message: 'This key was already used for a different request. Use a new Idempotency-Key.' } }, statusCode: 409, replayed: true };
      }
      return { body: winner.response, statusCode: winner.statusCode, replayed: true };
    }

    const result = await execute(tx);
    // Failed validation is not a committed mutation and must not reserve a key.
    if (result.statusCode >= 400) return { body: result.body, statusCode: result.statusCode, replayed: false };
    if (effects) {
      await tx.auditLog.create({ data: {
        companyId: ctx.companyId,
        action: effects.audit.action,
        entityType: effects.audit.entityType,
        entityId: result.resourceId,
        metadata: { apiKeyId: ctx.apiKeyId, apiKeyName: effects.audit.apiKeyName },
      } });
      if (effects.eventType) {
        const body = result.body as { data?: Record<string, unknown> };
        await queueApiWebhookEvent(tx, {
          companyId: ctx.companyId,
          eventType: effects.eventType,
          eventId: createHash('sha256').update(JSON.stringify([ctx.apiKeyId, ctx.requestKey])).digest('hex'),
          payload: { ...body.data, occurredAt: new Date().toISOString() },
        });
      }
    }
    await tx.apiIdempotencyRecord.create({
      data: {
        apiKeyId: ctx.apiKeyId,
        companyId: ctx.companyId,
        requestKey: ctx.requestKey,
        method: ctx.method,
        path: ctx.path,
        requestHash: ctx.requestHash,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        statusCode: result.statusCode,
        response: result.body as object,
      },
    });
    return { body: result.body, statusCode: result.statusCode, replayed: false };
  }, { timeout: 20000 });

  // The event is already durable at this point. Delivery is best-effort and
  // may fail without affecting the accounting commit; the cron retries it.
  if (effects?.eventType && !outcome.replayed && outcome.statusCode < 400) {
    try {
      await sweepDueDeliveries(ctx.companyId, 5);
    } catch {
      console.error('[api-outbox] immediate delivery failed; queued event will retry');
    }
  }
  return outcome;
}
