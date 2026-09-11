import { createHash } from 'node:crypto';
import {
  API_KEY_PREFIX,
  bearerTokenFrom,
  generateApiKeyToken,
  hashApiKey,
  isValidApiKeyFormat,
  rateLimitsFor,
  windowStartFor,
} from '@/lib/api-keys';

describe('api key material', () => {
  test('generates a 128-bit token with the lp_live_ prefix and a matching SHA-256 hash', () => {
    const { token, prefix, hash } = generateApiKeyToken();
    expect(token).toMatch(/^lp_live_[0-9a-f]{32}$/);
    expect(prefix).toBe(`${API_KEY_PREFIX}${token.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)}`);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token.slice(API_KEY_PREFIX.length));
  });

  test('two generated keys never collide', () => {
    const a = generateApiKeyToken();
    const b = generateApiKeyToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  test('hashApiKey is deterministic for the same token', () => {
    const token = 'lp_live_0123456789abcdef0123456789abcdef';
    expect(hashApiKey(token)).toBe(hashApiKey(token));
  });

  test('rejects malformed tokens', () => {
    expect(isValidApiKeyFormat('lp_live_0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isValidApiKeyFormat('lp_live_short')).toBe(false);
    expect(isValidApiKeyFormat('sk_test_0123456789abcdef0123456789abcdef')).toBe(false);
    expect(isValidApiKeyFormat('LP_LIVE_0123456789ABCDEF0123456789ABCDEF')).toBe(false);
    expect(isValidApiKeyFormat('')).toBe(false);
  });

  test('extracts only strict Bearer tokens', () => {
    expect(bearerTokenFrom('Bearer lp_live_0123456789abcdef0123456789abcdef')).toBe('lp_live_0123456789abcdef0123456789abcdef');
    expect(bearerTokenFrom('bearer lp_live_0123456789abcdef0123456789abcdef')).toBe('lp_live_0123456789abcdef0123456789abcdef');
    expect(bearerTokenFrom('lp_live_0123456789abcdef0123456789abcdef')).toBeNull();
    expect(bearerTokenFrom('Basic abc')).toBeNull();
    expect(bearerTokenFrom(null)).toBeNull();
    expect(bearerTokenFrom('')).toBeNull();
  });

  test('window boundaries are UTC-aligned and shared across instances', () => {
    const minute = 60_000;
    const t = Date.parse('2026-09-10T12:34:56.789Z');
    expect(windowStartFor(t, minute).toISOString()).toBe('2026-09-10T12:34:00.000Z');
    // 12:34:55 is still inside the 12:34 window; the previous minute maps back one window
    expect(windowStartFor(t - 1, minute).toISOString()).toBe('2026-09-10T12:34:00.000Z');
    expect(windowStartFor(t - 60_000, minute).toISOString()).toBe('2026-09-10T12:33:00.000Z');
  });

  test('rate limits default to bounded values', () => {
    expect(rateLimitsFor('default')).toEqual({ minute: 120, day: 5000 });
    expect(rateLimitsFor('report').minute).toBeLessThan(rateLimitsFor('default').minute);
    expect(rateLimitsFor('report').day).toBeLessThan(rateLimitsFor('default').day);
  });
});

// ── authentication pipeline (mocked db) ──────────────────────

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    apiRateCounter: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

import { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';

const validToken = 'lp_live_0123456789abcdef0123456789abcdef';

function request(init: { authorization?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.authorization) headers.authorization = init.authorization;
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest('http://localhost/api/v1/company', { headers });
}

const validKey = {
  id: 'key-1',
  name: 'AccountNext Reporting',
  companyId: 'company-a',
  permissions: ['read'],
  keyHash: hashApiKey(validToken),
  keyPrefix: 'lp_live_01234567',
  expiresAt: null,
  lastUsedAt: null,
  requestCount: 0,
  revokedAt: null,
  createdAt: new Date(),
  company: { apiAccessEnabled: true },
};

describe('authenticateApiRequest', () => {
  const originalDisabled = process.env.LEDGERPRO_API_DISABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LEDGERPRO_API_DISABLED;
    mockFindUnique.mockResolvedValue(validKey);
    mockUpsert.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({});
  });

  afterAll(() => {
    if (originalDisabled === undefined) delete process.env.LEDGERPRO_API_DISABLED;
    else process.env.LEDGERPRO_API_DISABLED = originalDisabled;
  });

  test('rejects requests with no authorization header', async () => {
    const res = await authenticateApiRequest(request());
    expect(res.error?.status).toBe(401);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'invalid_api_key' } });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('rejects malformed tokens before touching the database', async () => {
    const res = await authenticateApiRequest(request({ authorization: 'Bearer nope' }));
    expect(res.error?.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('a dashboard active-company cookie alone grants nothing', async () => {
    const res = await authenticateApiRequest(request({ cookie: 'lp-active-company-id=company-a' }));
    expect(res.error?.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('an unknown key gets the same generic error as an absent one', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(401);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'invalid_api_key' } });
  });

  test('revoked keys are rejected with a distinct code', async () => {
    mockFindUnique.mockResolvedValue({ ...validKey, revokedAt: new Date() });
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(401);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'api_key_revoked' } });
  });

  test('expired keys are rejected with a distinct code', async () => {
    mockFindUnique.mockResolvedValue({ ...validKey, expiresAt: new Date(Date.now() - 1000) });
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(401);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'api_key_expired' } });
  });

  test('the company-level switch blocks every key immediately', async () => {
    mockFindUnique.mockResolvedValue({ ...validKey, company: { apiAccessEnabled: false } });
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(403);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'api_access_disabled' } });
  });

  test('a key without the required permission is rejected', async () => {
    mockFindUnique.mockResolvedValue({ ...validKey, permissions: [] });
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }), {
      permission: 'read',
    });
    expect(res.error?.status).toBe(403);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'insufficient_permissions' } });
  });

  test('the platform-level switch turns every request away', async () => {
    process.env.LEDGERPRO_API_DISABLED = '1';
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(503);
    expect(await res.error!.json()).toMatchObject({ error: { code: 'api_unavailable' } });
    expect(mockFindUnique).not.toHaveBeenCalled();
    delete process.env.LEDGERPRO_API_DISABLED;
  });

  test('rate limiting is enforced from the PostgreSQL-backed counter', async () => {
    mockUpsert.mockResolvedValue({ count: 121 }); // over the 120/min default
    const res = await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(res.error?.status).toBe(429);
    const body = await res.error!.json();
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('a valid key resolves to its own company regardless of any dashboard cookie', async () => {
    // The cookie names a different company; the key's company must win.
    const res = await authenticateApiRequest(
      request({ authorization: `Bearer ${validToken}`, cookie: 'lp-active-company-id=company-b' })
    );
    expect(res.error).toBeNull();
    expect(res.context).toMatchObject({ companyId: 'company-a', permissions: ['read'] });
  });

  test('successful requests record last-use and request count', async () => {
    await authenticateApiRequest(request({ authorization: `Bearer ${validToken}` }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'key-1' },
        data: expect.objectContaining({ requestCount: { increment: 1 }, lastUsedAt: expect.any(Date) }),
      })
    );
  });
});
