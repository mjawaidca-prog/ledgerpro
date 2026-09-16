import { NextRequest } from 'next/server';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

const mockConnectionFindFirst = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockConnectionDelete = jest.fn();
const mockLinkFindMany = jest.fn();
const mockTxDeleteMany = jest.fn();
const mockSubscriptionFindFirst = jest.fn();
const mockExchange = jest.fn();
const mockGetItem = jest.fn();
const mockGetAccounts = jest.fn();
const mockRemoveItem = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    $transaction: async function (fn: any) { return fn(this); },
    $queryRaw: jest.fn().mockResolvedValue([]),
    bankConnection: {
      findFirst: (...a: unknown[]) => mockConnectionFindFirst(...a),
      update: (...a: unknown[]) => mockConnectionUpdate(...a),
      delete: (...a: unknown[]) => mockConnectionDelete(...a),
      create: jest.fn(),
    },
    bankFeedTransaction: { findMany: (...a: unknown[]) => mockLinkFindMany(...a) },
    transaction: { deleteMany: (...a: unknown[]) => mockTxDeleteMany(...a) },
    subscription: { findFirst: (...a: unknown[]) => mockSubscriptionFindFirst(...a) },
  },
}));
const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...a: unknown[]) => mockRequireCompany(...a),
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
}));
jest.mock('@/lib/bank-feed/crypto', () => ({ decryptToken: jest.fn().mockReturnValue('token') }));
jest.mock('@/lib/bank-feed/plaid-client', () => ({
  exchangePublicToken: (...a: unknown[]) => mockExchange(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  getItemAccounts: (...a: unknown[]) => mockGetAccounts(...a),
  removeItem: (...a: unknown[]) => mockRemoveItem(...a),
}));

import { PATCH as settingsRoute } from '@/app/api/plaid/connections/[id]/settings/route';
import { DELETE as disconnectRoute } from '@/app/api/plaid/connections/[id]/route';
import { POST as exchangeRoute } from '@/app/api/plaid/exchange/route';

const session = { companyId: 'co-1', userId: 'owner-1', error: null };

describe('BF-4 settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockConnectionFindFirst.mockResolvedValue({ id: 'conn-1' });
    mockConnectionUpdate.mockResolvedValue({});
  });

  const req = (body: unknown) =>
    new NextRequest('http://localhost/api/plaid/connections/conn-1/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  test('saves the supported settings and audits', async () => {
    const res = await settingsRoute(req({ cadence: 'daily', autoCategorize: false, notifyOnFailure: true }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(200);
    expect(mockConnectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cadence: 'daily', autoCategorize: false, notifyOnFailure: true } })
    );
    expect(mockAuditLog).toHaveBeenCalled();
  });

  test('rejects unsupported cadences', async () => {
    const res = await settingsRoute(req({ cadence: 'hourly' }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(400);
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });
});

describe('BF-4 disconnect with row removal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockConnectionFindFirst.mockResolvedValue({
      id: 'conn-1', institutionName: 'RBC', accessTokenEncrypted: 'v1.placeholder',
    });
    mockRemoveItem.mockResolvedValue(undefined);
    mockConnectionDelete.mockResolvedValue({});
  });

  test('default disconnect keeps review rows', async () => {
    const res = await disconnectRoute(new NextRequest('http://localhost/api/plaid/connections/conn-1', { method: 'DELETE' }), { params: { id: 'conn-1' } } as any);
    expect(res.status).toBe(200);
    expect(mockTxDeleteMany).not.toHaveBeenCalled();
  });

  test('removeUnreviewed=1 deletes only untouched toreview feed rows', async () => {
    mockLinkFindMany.mockResolvedValue([{ transactionId: 'tx-1' }, { transactionId: 'tx-2' }]);
    mockTxDeleteMany.mockResolvedValue({ count: 2 });
    const res = await disconnectRoute(
      new NextRequest('http://localhost/api/plaid/connections/conn-1?removeUnreviewed=1', { method: 'DELETE' }),
      { params: { id: 'conn-1' } } as any
    );
    expect(res.status).toBe(200);
    expect(mockTxDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['tx-1', 'tx-2'] },
          status: 'toreview',
          categoryId: null,
          contactId: null,
          reconciledInId: null,
          source: 'feed',
        }),
      })
    );
    expect((await res.json()).data.removedRows).toBe(2);
  });
});

describe('BF-4 exchange plan gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue(session);
    mockSubscriptionFindFirst.mockResolvedValue({ plan: { bankFeeds: true } });
    mockExchange.mockResolvedValue({ accessToken: 't', itemId: 'i' });
    mockGetItem.mockResolvedValue({ itemId: 'i', institutionId: null, institutionName: 'Bank', consentExpiresAt: null, status: null });
    mockGetAccounts.mockResolvedValue([]);
  });

  const req = () =>
    new NextRequest('http://localhost/api/plaid/exchange', {
      method: 'POST',
      body: JSON.stringify({ publicToken: 'p' }),
      headers: { 'content-type': 'application/json' },
    });

  test('rejects companies without the bankFeeds plan entitlement', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(null);
    const res = await exchangeRoute(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Pro or Enterprise');
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
