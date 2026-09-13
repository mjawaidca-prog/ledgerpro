import { NextRequest } from 'next/server';

const mockVerify = jest.fn();
jest.mock('@/lib/bank-feed/webhook', () => ({
  verifyPlaidWebhook: (...a: unknown[]) => mockVerify(...a),
}));
const mockSync = jest.fn();
jest.mock('@/lib/bank-feed/sync', () => ({
  syncConnection: (...a: unknown[]) => mockSync(...a),
}));

import { POST as webhookRoute } from '@/app/api/plaid/webhook/route';

describe('BF-2 webhook route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const req = (body: unknown, header: string | null = 'jwt-value') =>
    new NextRequest('http://localhost/api/plaid/webhook', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(header ? { 'plaid-verification': header } : {}) },
    });

  test('unverified payloads are rejected with 400 before any sync', async () => {
    mockVerify.mockResolvedValue(null);
    const res = await webhookRoute(req({ item_id: 'item-1', webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }));
    expect(res.status).toBe(400);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('SYNC_UPDATES_AVAILABLE triggers the connection sync', async () => {
    mockVerify.mockResolvedValue({ connectionId: 'conn-1' });
    mockSync.mockResolvedValue({});
    const res = await webhookRoute(req({ item_id: 'item-1', webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }));
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith('conn-1', 'webhook');
  });

  test('other webhook codes are acknowledged without syncing', async () => {
    mockVerify.mockResolvedValue({ connectionId: 'conn-1' });
    const res = await webhookRoute(req({ item_id: 'item-1', webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED' }));
    expect(res.status).toBe(200);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('sync failures are swallowed so Plaid retries cleanly', async () => {
    mockVerify.mockResolvedValue({ connectionId: 'conn-1' });
    mockSync.mockRejectedValue(new Error('boom'));
    const res = await webhookRoute(req({ item_id: 'item-1', webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }));
    expect(res.status).toBe(200);
  });
});
