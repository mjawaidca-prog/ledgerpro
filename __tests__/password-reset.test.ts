// Password-reset flow: no account enumeration, single-use hashed tokens,
// expiry, and the signed-in change-password route.

import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { hashSync, compareSync } from 'bcryptjs';

const mockUserFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserUpdate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      findMany: (...a: unknown[]) => mockUserFindMany(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));
const mockSendReset = jest.fn();
jest.mock('@/lib/email', () => ({
  sendPasswordReset: (...a: unknown[]) => mockSendReset(...a),
}));
const mockGetSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getServerSession: (...a: unknown[]) => mockGetSession(...a),
}));
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
}));

import { POST as forgotRoute } from '@/app/api/auth/forgot-password/route';
import { POST as resetRoute } from '@/app/api/auth/reset-password/route';
import { POST as changeRoute } from '@/app/api/auth/change-password/route';

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('forgot-password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserUpdate.mockResolvedValue({});
  });

  test('stores only the token hash and emails the link', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-1', email: 'rosa@example.com' });
    const res = await forgotRoute(jsonReq('http://localhost/api/auth/forgot-password', { email: 'rosa@example.com' }));
    expect(res.status).toBe(200);

    const updateArg = mockUserUpdate.mock.calls[0][0];
    expect(updateArg.data.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updateArg.data.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
    const tokenSent = mockSendReset.mock.calls[0][1];
    const token = new URL(tokenSent).searchParams.get('token');
    expect(createHash('sha256').update(token!).digest('hex')).toBe(updateArg.data.passwordResetTokenHash);
  });

  test('unknown emails get the identical response (no enumeration)', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await forgotRoute(jsonReq('http://localhost/api/auth/forgot-password', { email: 'ghost@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sent).toBe(true);
    expect(mockSendReset).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe('reset-password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserUpdate.mockResolvedValue({});
  });

  test('a valid token resets the password and clears the token', async () => {
    const token = 'ab'.repeat(32);
    const hash = createHash('sha256').update(token).digest('hex');
    mockUserFindMany.mockResolvedValue([
      { id: 'u-1', email: 'rosa@example.com', passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() + 60_000) },
    ]);
    const res = await resetRoute(jsonReq('http://localhost/api/auth/reset-password', { token, password: 'new-pass-123' }));
    expect(res.status).toBe(200);

    const updateArg = mockUserUpdate.mock.calls[0][0];
    expect(updateArg.data.passwordResetTokenHash).toBeNull();
    expect(compareSync('new-pass-123', updateArg.data.passwordHash)).toBe(true);
  });

  test('expired and unknown tokens are rejected identically', async () => {
    const token = 'cd'.repeat(32);
    const hash = createHash('sha256').update(token).digest('hex');
    mockUserFindMany.mockResolvedValue([
      { id: 'u-1', email: 'rosa@example.com', passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() - 60_000) },
    ]);
    const expired = await resetRoute(jsonReq('http://localhost/api/auth/reset-password', { token, password: 'new-pass-123' }));
    expect(expired.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();

    mockUserFindMany.mockResolvedValue([]);
    const unknown = await resetRoute(jsonReq('http://localhost/api/auth/reset-password', { token: 'ef'.repeat(32), password: 'new-pass-123' }));
    expect(unknown.status).toBe(400);
  });
});

describe('change-password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: 'u-1' } });
    mockUserUpdate.mockResolvedValue({});
  });

  test('requires the current password', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-1', passwordHash: hashSync('old-pass-123', 10) });
    const res = await changeRoute(jsonReq('http://localhost/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'new-pass-123' }));
    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test('updates and audits with the correct current password', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-1', passwordHash: hashSync('old-pass-123', 10) });
    const res = await changeRoute(jsonReq('http://localhost/api/auth/change-password', { currentPassword: 'old-pass-123', newPassword: 'new-pass-123' }));
    expect(res.status).toBe(200);
    expect(compareSync('new-pass-123', mockUserUpdate.mock.calls[0][0].data.passwordHash)).toBe(true);
    expect(mockAuditLog).toHaveBeenCalled();
  });
});
