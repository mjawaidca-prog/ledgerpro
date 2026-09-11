import { NextRequest, NextResponse } from 'next/server';
import type { ApiKeyPermission } from '@prisma/client';
import { db } from '@/lib/db';
import {
  bearerTokenFrom,
  hashApiKey,
  isValidApiKeyFormat,
  rateLimitsFor,
  windowStartFor,
  RATE_WINDOW_DAY_MS,
  RATE_WINDOW_MINUTE_MS,
  type ApiRateScope,
} from '@/lib/api-keys';

export type ApiAuthContext = {
  apiKeyId: string;
  apiKeyName: string;
  companyId: string;
  permissions: ApiKeyPermission[];
};

export type ApiAuthResult =
  | { context: ApiAuthContext; error: null }
  | { context: null; error: NextResponse };

// v1 error envelope: every failure carries a stable machine-readable code.
function errorResponse(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

/**
 * Authenticates a /api/v1 request from its API key alone.
 *
 * The dashboard session and the active-company cookie are never consulted —
 * the key's own companyId is the tenant boundary. Every check here is
 * re-derived on each request: revocation, expiry, the company-level switch
 * and rate counters all live in PostgreSQL, so nothing is cached in memory
 * and emergency revocation takes effect immediately across instances.
 */
export async function authenticateApiRequest(
  req: NextRequest,
  opts: { permission?: ApiKeyPermission; rateScope?: ApiRateScope } = {}
): Promise<ApiAuthResult> {
  // Platform-level emergency disable switch (deployment environment variable).
  if (process.env.LEDGERPRO_API_DISABLED === '1') {
    return {
      context: null,
      error: errorResponse(503, 'api_unavailable', 'The API is temporarily disabled.'),
    };
  }

  const token = bearerTokenFrom(req.headers.get('authorization'));
  if (!token || !isValidApiKeyFormat(token)) {
    return {
      context: null,
      error: errorResponse(
        401,
        'invalid_api_key',
        'A valid API key is required (Authorization: Bearer lp_live_…).'
      ),
    };
  }

  const apiKey = await db.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { company: { select: { apiAccessEnabled: true } } },
  });

  // Unknown keys share the generic message so responses never reveal which
  // key ids exist.
  if (!apiKey) {
    return {
      context: null,
      error: errorResponse(
        401,
        'invalid_api_key',
        'A valid API key is required (Authorization: Bearer lp_live_…).'
      ),
    };
  }
  if (apiKey.revokedAt) {
    return { context: null, error: errorResponse(401, 'api_key_revoked', 'This API key has been revoked.') };
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    return { context: null, error: errorResponse(401, 'api_key_expired', 'This API key has expired.') };
  }
  // Company-level emergency disable switch.
  if (!apiKey.company.apiAccessEnabled) {
    return {
      context: null,
      error: errorResponse(403, 'api_access_disabled', 'API access is disabled for this company.'),
    };
  }

  if (opts.permission && !apiKey.permissions.includes(opts.permission)) {
    return {
      context: null,
      error: errorResponse(
        403,
        'insufficient_permissions',
        `This API key does not grant the "${opts.permission}" permission.`
      ),
    };
  }

  const rateError = await enforceRateLimit(apiKey.id, opts.rateScope ?? 'default');
  if (rateError) return { context: null, error: rateError };

  // Usage bookkeeping — best-effort, never fails a request over it.
  try {
    await db.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    });
  } catch (e) {
    console.error('[api-auth] Failed to record key usage:', e);
  }

  return {
    context: {
      apiKeyId: apiKey.id,
      apiKeyName: apiKey.name,
      companyId: apiKey.companyId,
      permissions: apiKey.permissions,
    },
    error: null,
  };
}

/**
 * PostgreSQL-backed fixed-window rate limit. Both windows increment through
 * atomic upserts (INSERT … ON CONFLICT DO UPDATE), so counts are shared
 * across serverless instances. Returns a 429 response when a window is over
 * its limit, otherwise null.
 */
async function enforceRateLimit(apiKeyId: string, scope: ApiRateScope): Promise<NextResponse | null> {
  const limits = rateLimitsFor(scope);
  const now = Date.now();
  const windows = [
    { scope: 'minute', windowStart: windowStartFor(now, RATE_WINDOW_MINUTE_MS), limit: limits.minute },
    { scope: 'day', windowStart: windowStartFor(now, RATE_WINDOW_DAY_MS), limit: limits.day },
  ];

  for (const w of windows) {
    let counter;
    try {
      counter = await db.apiRateCounter.upsert({
        where: {
          apiKeyId_scope_windowStart: {
            apiKeyId,
            scope: w.scope,
            windowStart: w.windowStart,
          },
        },
        create: { apiKeyId, scope: w.scope, windowStart: w.windowStart, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch (e) {
      console.error('[api-auth] Rate counter failed:', e);
      // Fail open on counter errors only in the sense that a request may
      // pass — the alternative is denying all API traffic when the counter
      // has a transient problem. The day window still guards runaway usage.
      continue;
    }
    if (counter.count > w.limit) {
      const windowMs = w.scope === 'minute' ? RATE_WINDOW_MINUTE_MS : RATE_WINDOW_DAY_MS;
      const retryAfterSeconds = Math.max(1, Math.ceil((w.windowStart.getTime() + windowMs - now) / 1000));
      return errorResponse(429, 'rate_limited', `Rate limit exceeded (${w.limit} requests per ${w.scope}).`, {
        retryAfterSeconds,
      });
    }
  }
  return null;
}
