// Public API (v1) write idempotency. Every POST endpoint requires an
// Idempotency-Key header. The record and the mutation commit in the SAME
// transaction: a retry either replays the stored response or loses the
// unique-constraint race and re-reads the winner's response. No duplicate
// invoice, payment or journal entry can be created by a repeated request.

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

const MAX_KEY_LENGTH = 200;

export interface IdempotencyContext {
  requestKey: string;
  apiKeyId: string;
  companyId: string;
  method: string;
  path: string;
}

export function idempotencyContextFrom(
  req: Request,
  ctx: { apiKeyId: string; companyId: string }
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
    },
  };
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
  }>
): Promise<IdempotencyOutcome> {
  const existing = await db.apiIdempotencyRecord.findUnique({
    where: { apiKeyId_requestKey: { apiKeyId: ctx.apiKeyId, requestKey: ctx.requestKey } },
  });
  if (existing) {
    return { body: existing.response, statusCode: existing.statusCode, replayed: true };
  }

  return db.$transaction(async (tx) => {
    // Re-check inside the transaction; the unique index breaks the race.
    const winner = await tx.apiIdempotencyRecord.findUnique({
      where: { apiKeyId_requestKey: { apiKeyId: ctx.apiKeyId, requestKey: ctx.requestKey } },
    });
    if (winner) {
      return { body: winner.response, statusCode: winner.statusCode, replayed: true };
    }

    const result = await execute(tx);
    await tx.apiIdempotencyRecord.create({
      data: {
        apiKeyId: ctx.apiKeyId,
        companyId: ctx.companyId,
        requestKey: ctx.requestKey,
        method: ctx.method,
        path: ctx.path,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        statusCode: result.statusCode,
        response: result.body as object,
      },
    });
    return { body: result.body, statusCode: result.statusCode, replayed: false };
  });
}
