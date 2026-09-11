import { createHmac } from 'node:crypto';

jest.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === 'public.test') return [{ address: '8.8.8.8' }, { address: '2606:4700::1111' }];
    if (hostname === 'private.test') return [{ address: '10.0.0.5' }];
    if (hostname === 'linklocal.test') return [{ address: '169.254.1.1' }];
    throw new Error('ENOTFOUND');
  },
}));

const mockDeliveryFindUnique = jest.fn();
const mockDeliveryUpdate = jest.fn();
const mockDeliveryCreate = jest.fn();
const mockDeliveryFindMany = jest.fn();
const mockEndpointFindMany = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    webhookDelivery: {
      findUnique: (...a: unknown[]) => mockDeliveryFindUnique(...a),
      update: (...a: unknown[]) => mockDeliveryUpdate(...a),
      create: (...a: unknown[]) => mockDeliveryCreate(...a),
      findMany: (...a: unknown[]) => mockDeliveryFindMany(...a),
    },
    webhookEndpoint: { findMany: (...a: unknown[]) => mockEndpointFindMany(...a) },
  },
}));

import {
  signWebhookPayload,
  nextAttemptAtFor,
  DELIVERY_BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  isPrivateIp,
  validateWebhookUrl,
  deliverWebhook,
  emitWebhookEvent,
  generateWebhookSecret,
} from '@/lib/webhooks';

describe('webhook signing', () => {
  test('HMAC-SHA256 over timestamp.payload matches an independent computation', () => {
    const secret = 'whsec_test';
    const payload = '{"id":"INV-1"}';
    const ts = 1726000000000;
    const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    expect(signWebhookPayload(secret, payload, ts)).toBe(expected);
  });

  test('secrets are high-entropy and prefixed', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('retry backoff', () => {
  test('follows the fixed ladder and caps at MAX_ATTEMPTS', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    expect(nextAttemptAtFor(0, now).getTime() - now.getTime()).toBe(DELIVERY_BACKOFF_MINUTES[0] * 60_000);
    expect(nextAttemptAtFor(4, now).getTime() - now.getTime()).toBe(DELIVERY_BACKOFF_MINUTES[4] * 60_000);
    expect(nextAttemptAtFor(99, now).getTime() - now.getTime()).toBe(DELIVERY_BACKOFF_MINUTES[MAX_ATTEMPTS - 1] * 60_000);
  });
});

describe('SSRF protection', () => {
  test('private, loopback, link-local, CGNAT and unspecified addresses are rejected', () => {
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('169.254.10.10')).toBe(true);
    expect(isPrivateIp('100.64.0.1')).toBe(true);
    expect(isPrivateIp('0.0.0.0')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fc00::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
  });

  test('public addresses pass', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
  });

  test('validateWebhookUrl rejects bad schemes, embedded credentials and private hosts', async () => {
    expect((await validateWebhookUrl('ftp://example.com/x')).ok).toBe(false);
    expect((await validateWebhookUrl('https://user:pass@example.com/x')).ok).toBe(false);
    expect((await validateWebhookUrl('https://private.test/x')).ok).toBe(false);
    expect((await validateWebhookUrl('https://linklocal.test/x')).ok).toBe(false);
    expect((await validateWebhookUrl('not a url')).ok).toBe(false);
    expect((await validateWebhookUrl('https://unresolvable.test/x')).ok).toBe(false);
  });

  test('validateWebhookUrl accepts public destinations', async () => {
    expect(await validateWebhookUrl('https://public.test/x')).toEqual({ ok: true });
  });
});

describe('delivery processing', () => {
  const delivery = {
    id: 'd-1',
    eventType: 'invoice.created',
    eventId: 'evt-1',
    payload: { id: 'INV-1' },
    attempts: 0,
    status: 'failed',
    lastError: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    endpoint: { url: 'https://public.test/x', secret: 'whsec_test' },
  };

  const realFetch = global.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeliveryFindUnique.mockResolvedValue(delivery);
    mockDeliveryUpdate.mockResolvedValue({});
    global.fetch = mockFetch as any;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  test('2xx marks the delivery successful with the signed headers', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    expect(await deliverWebhook('d-1')).toBe('success');
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'success', attempts: 1, deliveredAt: expect.any(Date) }) })
    );
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://public.test/x');
    expect(init.headers['x-ledgerpro-event']).toBe('invoice.created');
    expect(init.headers['x-ledgerpro-event-id']).toBe('evt-1');
    expect(init.headers['x-ledgerpro-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('non-2xx advances the backoff ladder and records the error', async () => {
    mockFetch.mockResolvedValue(new Response('err', { status: 500 }));
    expect(await deliverWebhook('d-1')).toBe('failed');
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', attempts: 1, lastError: 'HTTP 500', nextAttemptAt: expect.any(Date) }),
      })
    );
  });

  test('the final attempt marks the delivery dead instead of retrying forever', async () => {
    mockDeliveryFindUnique.mockResolvedValue({ ...delivery, attempts: MAX_ATTEMPTS - 1 });
    mockFetch.mockResolvedValue(new Response('err', { status: 500 }));
    expect(await deliverWebhook('d-1')).toBe('dead');
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dead', nextAttemptAt: null }) })
    );
  });

  test('an SSRF-blocked destination fails without any outbound fetch', async () => {
    mockDeliveryFindUnique.mockResolvedValue({ ...delivery, endpoint: { url: 'https://private.test/x', secret: 'whsec_test' } });
    expect(await deliverWebhook('d-1')).toBe('failed');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastError: expect.stringContaining('webhook_ssrf') }) })
    );
  });

  test('successful deliveries are never re-delivered', async () => {
    mockDeliveryFindUnique.mockResolvedValue({ ...delivery, status: 'success' });
    expect(await deliverWebhook('d-1')).toBe('success');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDeliveryUpdate).not.toHaveBeenCalled();
  });
});

describe('event emission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('queues deliveries only for endpoints subscribed to the event', async () => {
    mockEndpointFindMany.mockResolvedValue([{ id: 'e-1' }, { id: 'e-2' }]);
    await emitWebhookEvent({ companyId: 'co-1', eventType: 'invoice.created', payload: { id: 'INV-1' } });
    expect(mockDeliveryCreate).toHaveBeenCalledTimes(2);
    expect(mockDeliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ endpointId: 'e-1', eventType: 'invoice.created', status: 'pending', attempts: 0 }),
      })
    );
  });

  test('duplicate (endpoint, eventId) violations are swallowed, never thrown', async () => {
    mockEndpointFindMany.mockResolvedValue([{ id: 'e-1' }]);
    mockDeliveryCreate.mockRejectedValue({ code: 'P2002' });
    await expect(
      emitWebhookEvent({ companyId: 'co-1', eventType: 'invoice.created', eventId: 'same-event', payload: {} })
    ).resolves.toBeUndefined();
  });

  test('emission never throws on database failure', async () => {
    mockEndpointFindMany.mockRejectedValue(new Error('db down'));
    await expect(emitWebhookEvent({ companyId: 'co-1', eventType: 'invoice.created', payload: {} })).resolves.toBeUndefined();
  });

  test('emission piggybacks a sweep of due deliveries for the company', async () => {
    mockEndpointFindMany.mockResolvedValue([{ id: 'e-1' }]);
    mockDeliveryFindMany.mockResolvedValue([
      { id: 'due-1', status: 'pending' },
    ]);
    mockDeliveryFindUnique.mockResolvedValue({
      id: 'due-1', eventType: 'bill.updated', eventId: 'evt-old', payload: {}, attempts: 0, status: 'pending',
      lastError: null, deliveredAt: null, createdAt: new Date(), updatedAt: new Date(),
      endpoint: { url: 'https://public.test/x', secret: 'whsec_test' },
    });
    global.fetch = jest.fn().mockResolvedValue(new Response('ok', { status: 200 })) as any;

    await emitWebhookEvent({ companyId: 'co-1', eventType: 'invoice.created', payload: { id: 'INV-1' } });
    // give the fire-and-forget sweep a tick
    await new Promise((r) => setTimeout(r, 20));

    expect(mockDeliveryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ endpoint: { companyId: 'co-1' } }) })
    );
    expect(mockDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'success' }) })
    );
  });
});
