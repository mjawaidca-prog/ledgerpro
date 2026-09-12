import { NextRequest } from 'next/server';

const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockCompanyFind = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    company: { findUnique: (...args: unknown[]) => mockCompanyFind(...args) },
  },
}));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// Deterministic token so tests can assert the hash-vs-secret invariant.
jest.mock('@/lib/api-keys', () => ({
  generateApiKeyToken: () => ({
    token: 'lp_live_0123456789abcdef0123456789abcdef',
    prefix: 'lp_live_01234567',
    hash: 'sha256-of-the-token',
  }),
}));

import { GET, POST } from '@/app/api/keys/route';

describe('/api/keys management routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'company-a', userId: 'owner-1', error: null });
    mockCompanyFind.mockResolvedValue({ apiAccessEnabled: false });
  });

  const request = (body?: unknown) =>
    new NextRequest('http://localhost/api/keys', {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });

  test('GET is owner-only', async () => {
    mockRequireCompany.mockResolvedValue({
      companyId: null,
      userId: null,
      error: new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 }),
    });
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('GET returns keys and the switch without any key material', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'key-1', name: 'Reporting', keyPrefix: 'lp_live_01234567', permissions: ['read'], expiresAt: null, lastUsedAt: null, requestCount: 0, revokedAt: null, createdAt: new Date() },
    ]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.apiAccessEnabled).toBe(false);
    expect(body.data.keys[0]).not.toHaveProperty('keyHash');
    expect(body.data.keys[0]).not.toHaveProperty('secret');
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 'company-a' } }));
  });

  test('POST stores only the hash and returns the secret exactly once', async () => {
    // Mirrors the route's `select` shape — the stored keyHash must never be
    // part of what an API response can echo.
    mockCreate.mockImplementation(async ({ data }) => ({
      id: 'key-2',
      name: data.name,
      keyPrefix: data.keyPrefix,
      permissions: data.permissions,
      expiresAt: data.expiresAt,
      createdAt: new Date(),
      lastUsedAt: null,
      requestCount: 0,
      revokedAt: null,
    }));
    const res = await POST(request({ name: 'AccountNext', permissions: ['read'] }));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.data.secret).toBe('lp_live_0123456789abcdef0123456789abcdef');
    expect(body.data.key).not.toHaveProperty('keyHash');
    expect(body.data.key).not.toHaveProperty('secret');

    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.data.keyHash).toBe('sha256-of-the-token');
    expect(createArg.data.companyId).toBe('company-a');
    expect(JSON.stringify(createArg)).not.toContain('0123456789abcdef0123456789abcdef');

    expect(mockAuditLog).toHaveBeenCalledWith('company-a', 'owner-1', 'api_key.create', 'api_key', 'key-2', undefined, expect.any(Object));
  });

  test('POST accepts the write scopes shipped with API-C', async () => {
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'key-3', name: data.name, keyPrefix: data.keyPrefix, permissions: data.permissions, expiresAt: null, createdAt: new Date(), lastUsedAt: null, requestCount: 0, revokedAt: null }));
    const res = await POST(request({ name: 'Full access', permissions: ['read', 'write_draft', 'write_posting'] }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permissions: ['read', 'write_draft', 'write_posting'] }) })
    );
  });

  test('POST rejects permissions that are not on the server whitelist', async () => {
    const res = await POST(request({ name: 'Sneaky', permissions: ['write_everything'] }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('POST rejects a key with no permissions at all', async () => {
    const res = await POST(request({ name: 'Odd', permissions: [] }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('POST rejects empty names and past expiry dates', async () => {
    expect((await POST(request({ name: '   ', permissions: ['read'] }))).status).toBe(400);
    expect((await POST(request({ name: 'X', permissions: ['read'], expiresAt: '2020-01-01' }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
