import { NextRequest, NextResponse } from 'next/server';

const mockFindUnique = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { company: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}));

const mockAuthenticate = jest.fn();
jest.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
}));

import { GET } from '@/app/api/v1/company/route';

describe('GET /api/v1/company', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const request = () => new NextRequest('http://localhost/api/v1/company');

  test('passes through authentication errors untouched', async () => {
    const authError = NextResponse.json({ error: { code: 'invalid_api_key', message: 'x' } }, { status: 401 });
    mockAuthenticate.mockResolvedValue({ context: null, error: authError });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('requests the read permission on every call', async () => {
    mockFindUnique.mockResolvedValue({ id: 'company-a', name: 'A Co' });
    mockAuthenticate.mockResolvedValue({
      context: { apiKeyId: 'k', apiKeyName: 'n', companyId: 'company-a', permissions: ['read'] },
      error: null,
    });
    await GET(request());
    expect(mockAuthenticate).toHaveBeenCalledWith(expect.any(NextRequest), { permission: 'read' });
  });

  test('returns only safe profile fields — no registration numbers or secrets', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'company-a',
      name: 'A Co',
      legalName: 'A Co Ltd.',
      fiscalYearStart: new Date('2026-01-01'),
      fiscalYearEnd: new Date('2026-12-31'),
      businessType: 'corporation',
      province: 'ON',
      currency: 'CAD',
      locale: 'en-CA',
      timezone: 'America/Edmonton',
      onboardingComplete: true,
    });
    mockAuthenticate.mockResolvedValue({
      context: { apiKeyId: 'k', apiKeyName: 'n', companyId: 'company-a', permissions: ['read'] },
      error: null,
    });

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: 'company-a', name: 'A Co', currency: 'CAD' });
    expect(body.data).not.toHaveProperty('businessNumber');
    expect(body.data).not.toHaveProperty('gstNumber');
    expect(body.data).not.toHaveProperty('passwordHash');
    expect(body.error).toBeUndefined();
  });

  test('a missing company behind a valid key is a 404 with a stable code', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockAuthenticate.mockResolvedValue({
      context: { apiKeyId: 'k', apiKeyName: 'n', companyId: 'company-a', permissions: ['read'] },
      error: null,
    });
    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'company_not_found' } });
  });
});
