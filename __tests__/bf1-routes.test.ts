import { NextRequest } from 'next/server';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

const mockConnectionCreate = jest.fn();
const mockConnectionFindFirst = jest.fn();
const mockConnectionDelete = jest.fn();
const mockFeedAccountUpdate = jest.fn();
const mockFeedAccountFindFirst = jest.fn();
const mockCompanyFindUniqueOrThrow = jest.fn();
const mockFinancialAccountFindFirst = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    bankConnection: {
      create: (...a: unknown[]) => mockConnectionCreate(...a),
      findFirst: (...a: unknown[]) => mockConnectionFindFirst(...a),
      delete: (...a: unknown[]) => mockConnectionDelete(...a),
    },
    bankFeedAccount: {
      update: (...a: unknown[]) => mockFeedAccountUpdate(...a),
      findFirst: (...a: unknown[]) => mockFeedAccountFindFirst(...a),
    },
    company: { findUniqueOrThrow: (...a: unknown[]) => mockCompanyFindUniqueOrThrow(...a) },
    financialAccount: { findFirst: (...a: unknown[]) => mockFinancialAccountFindFirst(...a) },
  },
}));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...a: unknown[]) => mockRequireCompany(...a),
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
}));

const mockExchange = jest.fn();
const mockGetItem = jest.fn();
const mockGetAccounts = jest.fn();
const mockRemoveItem = jest.fn();
const mockCreateLinkToken = jest.fn();
jest.mock('@/lib/bank-feed/plaid-client', () => ({
  exchangePublicToken: (...a: unknown[]) => mockExchange(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  getItemAccounts: (...a: unknown[]) => mockGetAccounts(...a),
  removeItem: (...a: unknown[]) => mockRemoveItem(...a),
  createLinkToken: (...a: unknown[]) => mockCreateLinkToken(...a),
}));

import { POST as exchangeRoute } from '@/app/api/plaid/exchange/route';
import { PATCH as accountsRoute } from '@/app/api/plaid/connections/[id]/accounts/route';
import { DELETE as disconnectRoute } from '@/app/api/plaid/connections/[id]/route';

const session = { companyId: 'co-1', userId: 'owner-1', error: null };

describe('BF-1 exchange route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockExchange.mockResolvedValue({ accessToken: 'access-token-123', itemId: 'item-1' });
    mockGetItem.mockResolvedValue({
      itemId: 'item-1',
      institutionId: 'ins_1',
      institutionName: 'Royal Bank of Canada',
      consentExpiresAt: '2027-09-01T00:00:00Z',
      status: null,
    });
    mockGetAccounts.mockResolvedValue([
      { providerAccountId: 'pa-1', name: 'Chequing', mask: '1234', subtype: 'checking', currency: 'CAD', currentBalance: 500, availableBalance: 450 },
      { providerAccountId: 'pa-2', name: 'Visa', mask: '5678', subtype: 'credit card', currency: 'CAD', currentBalance: -100, availableBalance: null },
      { providerAccountId: 'pa-3', name: 'Personal', mask: '9999', subtype: 'personal', currency: 'CAD', currentBalance: 10, availableBalance: 10 },
    ]);
    mockConnectionCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: 'conn-1', accounts: data.accounts.create.map((a: any, i: number) => ({ ...a, id: `bfa-${i}` })) }));
  });

  const req = () =>
    new NextRequest('http://localhost/api/plaid/exchange', {
      method: 'POST',
      body: JSON.stringify({ publicToken: 'public-sandbox-xyz' }),
      headers: { 'content-type': 'application/json' },
    });

  test('encrypts the token at rest and never returns it', async () => {
    const res = await exchangeRoute(req());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('access-token-123');

    const createArg = mockConnectionCreate.mock.calls[0][0];
    expect(createArg.data.accessTokenEncrypted).not.toContain('access-token-123');
    expect(createArg.data.accessTokenEncrypted.startsWith('v1.')).toBe(true);
    expect(createArg.data.billableOwnerId).toBe('owner-1');
    expect(createArg.data.consentExpiresAt.toISOString()).toBe('2027-09-01T00:00:00.000Z');
  });

  test('depository and credit accounts default to feeding; personal accounts do not', async () => {
    await exchangeRoute(req());
    const createArg = mockConnectionCreate.mock.calls[0][0];
    const feeding = createArg.data.accounts.create.filter((a: any) => a.isFeeding).map((a: any) => a.providerAccountId);
    expect(feeding).toEqual(['pa-1', 'pa-2']);
  });

  test('owner-only and audited', async () => {
    await exchangeRoute(req());
    expect(mockRequireCompany).toHaveBeenCalledWith(expect.any(NextRequest), { roles: ['owner'] });
    expect(mockAuditLog).toHaveBeenCalledWith('co-1', 'owner-1', 'bank_feed.connection.create', 'bank_connection', 'conn-1', undefined, expect.any(Object));
  });
});

describe('BF-1 account mapping route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockConnectionFindFirst.mockResolvedValue({
      id: 'conn-1',
      companyId: 'co-1',
      accounts: [
        { providerAccountId: 'pa-1', subtype: 'checking', currency: 'CAD' },
        { providerAccountId: 'pa-2', subtype: 'credit card', currency: 'USD' },
      ],
    });
    mockFeedAccountUpdate.mockResolvedValue({});
  });

  const req = (body: unknown) =>
    new NextRequest('http://localhost/api/plaid/connections/conn-1/accounts', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  test('blocks a currency mismatch with the handoff message', async () => {
    mockFinancialAccountFindFirst.mockResolvedValue({ id: 'fa-1', currency: 'CAD', kind: 'checking' });
    const res = await accountsRoute(req({ accounts: [{ providerAccountId: 'pa-2', is_feeding: true, financialAccountId: 'fa-1' }] }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields['pa-2']).toContain('USD');
  });

  test('blocks a credit card mapped to a non-credit GL account', async () => {
    mockFinancialAccountFindFirst.mockResolvedValue({ id: 'fa-1', currency: 'USD', kind: 'checking' });
    const res = await accountsRoute(req({ accounts: [{ providerAccountId: 'pa-2', is_feeding: true, financialAccountId: 'fa-1' }] }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields['pa-2']).toContain('liability');
  });

  test('blocks double-feeding a GL account from another connection', async () => {
    mockFinancialAccountFindFirst.mockResolvedValue({ id: 'fa-1', currency: 'CAD', kind: 'checking' });
    mockFeedAccountFindFirst.mockResolvedValue({ connection: { institutionName: 'Scotiabank' } });
    const res = await accountsRoute(req({ accounts: [{ providerAccountId: 'pa-1', is_feeding: true, financialAccountId: 'fa-1' }] }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields['pa-1']).toContain('Scotiabank');
  });

  test('a valid mapping updates with the GL account attached', async () => {
    mockFinancialAccountFindFirst.mockResolvedValue({ id: 'fa-1', currency: 'CAD', kind: 'checking' });
    mockFeedAccountFindFirst.mockResolvedValue(null);
    const res = await accountsRoute(req({ accounts: [{ providerAccountId: 'pa-1', is_feeding: true, financialAccountId: 'fa-1' }] }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(200);
    expect(mockFeedAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isFeeding: true, financialAccountId: 'fa-1' },
      })
    );
  });
});

describe('BF-1 disconnect route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockConnectionFindFirst.mockResolvedValue({
      id: 'conn-1',
      institutionName: 'Royal Bank of Canada',
      accessTokenEncrypted: 'v1.placeholder', // decryptToken will throw on this — replaced below
    });
    mockConnectionDelete.mockResolvedValue({});
    mockRemoveItem.mockResolvedValue(undefined);
  });

  test('removes the provider item BEFORE deleting the local record', async () => {
    const { encryptToken } = jest.requireActual('@/lib/bank-feed/crypto');
    mockConnectionFindFirst.mockResolvedValue({
      id: 'conn-1',
      institutionName: 'Royal Bank of Canada',
      accessTokenEncrypted: encryptToken('access-token-123'),
    });
    const res = await disconnectRoute(new NextRequest('http://localhost/api/plaid/connections/conn-1', { method: 'DELETE' }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(200);
    expect(mockRemoveItem).toHaveBeenCalledWith('access-token-123');
    const removeOrder = mockRemoveItem.mock.invocationCallOrder[0];
    const deleteOrder = mockConnectionDelete.mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(deleteOrder);
    expect(mockAuditLog).toHaveBeenCalledWith('co-1', 'owner-1', 'bank_feed.connection.disconnect', 'bank_connection', 'conn-1', undefined, expect.any(Object));
  });

  test('keeps the local record when provider revocation fails', async () => {
    const { encryptToken } = jest.requireActual('@/lib/bank-feed/crypto');
    mockConnectionFindFirst.mockResolvedValue({
      id: 'conn-1',
      institutionName: 'Royal Bank of Canada',
      accessTokenEncrypted: encryptToken('access-token-123'),
    });
    mockRemoveItem.mockRejectedValue(new Error('provider down'));
    const res = await disconnectRoute(new NextRequest('http://localhost/api/plaid/connections/conn-1', { method: 'DELETE' }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(502);
    expect(mockConnectionDelete).not.toHaveBeenCalled();
  });
});
