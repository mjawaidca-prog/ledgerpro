import { createHash, randomBytes } from 'crypto';

// Public API (v1) key material and rate-limit math. Everything here is pure —
// no database access — so the security-critical pieces are unit-testable in
// isolation. The pipeline that uses these lives in @/lib/api/auth.

export const API_KEY_PREFIX = 'lp_live_';

export const RATE_WINDOW_MINUTE_MS = 60_000;
export const RATE_WINDOW_DAY_MS = 24 * 60 * 60 * 1000;

export type ApiRateScope = 'default' | 'report';

// Default per-key limits, shared across serverless instances through
// PostgreSQL counters. "report" is reserved for the expensive API-B report
// endpoints. Environment overrides let limits change per deployment without
// a code change.
export function rateLimitsFor(scope: ApiRateScope): { minute: number; day: number } {
  const env = (name: string): number | undefined => {
    const raw = process.env[name];
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  if (scope === 'report') {
    return {
      minute: env('API_RATE_LIMIT_REPORT_MINUTE') ?? 10,
      day: env('API_RATE_LIMIT_REPORT_DAY') ?? 500,
    };
  }
  return {
    minute: env('API_RATE_LIMIT_MINUTE') ?? 120,
    day: env('API_RATE_LIMIT_DAY') ?? 5000,
  };
}

/**
 * Generates a new API key secret. The caller shows the token exactly once at
 * creation and stores only the returned hash. Format: lp_live_ + 32 hex
 * chars (128 bits of entropy).
 */
export function generateApiKeyToken(): { token: string; prefix: string; hash: string } {
  const secret = randomBytes(16).toString('hex');
  const token = `${API_KEY_PREFIX}${secret}`;
  return { token, prefix: `${API_KEY_PREFIX}${secret.slice(0, 8)}`, hash: hashApiKey(token) };
}

// SHA-256 hex. API key secrets are high-entropy random tokens, so a fast hash
// is the right tool here (password storage uses bcrypt; keys are different).
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidApiKeyFormat(token: string): boolean {
  return /^lp_live_[0-9a-f]{32}$/.test(token);
}

// Extracts a Bearer token from an Authorization header. Returns null for a
// missing header, basic auth, or a bare token — strict on purpose.
export function bearerTokenFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// The UTC boundary of the fixed window containing `now`. All instances compute
// the same boundary, so counters converge in PostgreSQL rather than per-process.
export function windowStartFor(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}
