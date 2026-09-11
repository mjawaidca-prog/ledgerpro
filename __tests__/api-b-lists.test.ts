import { NextRequest } from 'next/server';

const mockCoaFindMany = jest.fn();
const mockCompanyFindUnique = jest.fn();
const mockInvoiceFindFirst = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    chartOfAccount: { findMany: (...a: unknown[]) => mockCoaFindMany(...a) },
    company: { findUnique: (...a: unknown[]) => mockCompanyFindUnique(...a), findUniqueOrThrow: (...a: unknown[]) => mockCompanyFindUnique(...a) },
    invoice: { findFirst: (...a: unknown[]) => mockInvoiceFindFirst(...a) },
  },
}));

const mockAuthenticate = jest.fn();
jest.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: (...a: unknown[]) => mockAuthenticate(...a),
}));

import { GET as accounts } from '@/app/api/v1/accounts/route';
import { GET as invoiceDetail } from '@/app/api/v1/invoices/[id]/route';

const context = { apiKeyId: 'k', apiKeyName: 'n', companyId: 'co-1', permissions: ['read'] };

describe('API-B list endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ context, error: null });
    mockCompanyFindUnique.mockResolvedValue({ currency: 'CAD' });
    mockCoaFindMany.mockResolvedValue([]);
  });

  test('accounts list requires the read permission', async () => {
    await accounts(new NextRequest('http://localhost/api/v1/accounts'));
    expect(mockAuthenticate).toHaveBeenCalledWith(expect.any(NextRequest), { permission: 'read' });
  });

  test('accounts list is scoped to the key\'s company and passes filters through', async () => {
    await accounts(new NextRequest('http://localhost/api/v1/accounts?type=asset&active=1&limit=10&updatedAfter=2026-09-01T00:00:00.000Z'));
    const call = mockCoaFindMany.mock.calls[0][0];
    expect(call.where.companyId).toBe('co-1');
    expect(call.where.type).toBe('asset');
    expect(call.where.active).toBe(true);
    expect(call.where.updatedAt).toEqual({ gte: new Date('2026-09-01T00:00:00.000Z') });
    expect(call.take).toBe(11); // limit + 1 for hasMore
  });

  test('accounts list returns the pagination envelope with decimal-string balances', async () => {
    mockCoaFindMany.mockResolvedValue([
      { id: 'a1', code: '1010', name: 'Chequing', type: 'asset', subType: null, gifiCode: null, parentCode: null, balance: 250.5, active: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') },
    ]);
    const res = await accounts(new NextRequest('http://localhost/api/v1/accounts'));
    const body = await res.json();
    expect(body.data[0].balance).toBe('250.50');
    expect(body.data[0].currency).toBe('CAD');
    expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
  });

  test('a foreign invoice id resolves to 404 without leaking other-company data', async () => {
    mockInvoiceFindFirst.mockResolvedValue(null);
    const res = await invoiceDetail(new NextRequest('http://localhost/api/v1/invoices/foreign-id'), {
      params: { id: 'foreign-id' },
    } as any);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(mockInvoiceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-id', companyId: 'co-1' } })
    );
  });
});
