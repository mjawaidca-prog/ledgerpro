import { NextRequest } from 'next/server';

// Route-level dedupe contract for POST /api/intercompany/transactions:
// a retried submission carrying the same idempotencyKey must return the
// originally posted transaction (HTTP 200) WITHOUT posting a second
// source+mirror pair. postInterCompany is mocked; the db mock keeps an
// in-memory store keyed by idempotencyKey, mirroring the unique column.
// Prisma is stubbed the same way as in phase1-5-services.test.ts
// because the sandbox cannot generate the Prisma client.

class DecimalStub {
  v: number;
  constructor(value: unknown) { this.v = value instanceof DecimalStub ? value.v : Number(value as never); }
  mul(n: number) { return new DecimalStub(this.v * n); }
  isInteger() { return Math.abs(this.v - Math.round(this.v)) < 1e-9; }
  abs() { return new DecimalStub(Math.abs(this.v)); }
  greaterThan(n: number) { return this.v > n; }
  toNumber() { return this.v; }
  toString() { return String(this.v); }
}
class KnownRequestErrorStub extends Error { constructor(public code: string) { super(`known request ${code}`); } }

jest.mock('@prisma/client', () => ({
  Prisma: { Decimal: DecimalStub, PrismaClientKnownRequestError: KnownRequestErrorStub },
}));

const mockFindUnique = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    interCompanyTransaction: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
const mockClosedPeriodGuard = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
  closedPeriodGuard: (...args: unknown[]) => mockClosedPeriodGuard(...args),
}));

const mockPostInterCompany = jest.fn();
jest.mock('@/lib/intercompany/post', () => ({
  postInterCompany: (...args: unknown[]) => mockPostInterCompany(...args),
}));

jest.mock('@/lib/intercompany/detect', () => ({
  suggestMirror: jest.fn(),
}));

import { POST } from '@/app/api/intercompany/transactions/route';

const baseBody = {
  sourceCompanyId: 'co-a',
  targetCompanyId: 'co-b',
  kind: 'FUND_TRANSFER',
  date: '2026-11-03',
  amount: '3200',
  sourceOffsetAccountCode: '1010',
  targetOffsetAccountCode: '1010',
  memo: 'Working capital top-up',
};

const request = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/intercompany/transactions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/intercompany/transactions idempotency', () => {
  // In-memory stand-in for the idempotencyKey unique column.
  const store = new Map<string, Record<string, unknown>>();
  let counter: number;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    counter = 0;

    mockRequireCompany.mockResolvedValue({ companyId: 'co-a', userId: 'user-1', error: null });
    mockAuditLog.mockResolvedValue(undefined);
    mockClosedPeriodGuard.mockResolvedValue(null);

    mockFindUnique.mockImplementation(async ({ where }: any) =>
      store.get(where.idempotencyKey) ?? null
    );

    // Simulates the real create path: the record (and its key) only
    // becomes findable once postInterCompany has created it.
    mockPostInterCompany.mockImplementation(async (_userId: string, input: any) => {
      counter += 1;
      const ic = {
        id: `ic-${counter}`,
        reference: `IC-${String(counter).padStart(4, '0')}`,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'POSTED',
      };
      if (input.idempotencyKey) store.set(input.idempotencyKey, ic);
      return ic;
    });
  });

  test('the same key submitted twice posts once; the retry returns 200 with the original transaction', async () => {
    const body = { ...baseBody, idempotencyKey: 'key-double-submit' };

    const first = await POST(request(body));
    expect(first.status).toBe(201);
    const firstJson = await first.json();
    expect(firstJson.data.reference).toBe('IC-0001');

    const second = await POST(request(body));
    expect(second.status).toBe(200);
    const secondJson = await second.json();

    // The posting path ran exactly once — no second pair was created.
    expect(mockPostInterCompany).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    // The retry returns the SAME transaction as the original post.
    expect(secondJson.data.id).toBe(firstJson.data.id);
    expect(secondJson.data.reference).toBe(firstJson.data.reference);
  });

  test('the key is passed through to postInterCompany so it is stored on creation', async () => {
    await POST(request({ ...baseBody, idempotencyKey: 'key-pass-through' }));
    expect(mockPostInterCompany).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ idempotencyKey: 'key-pass-through' })
    );
  });

  test('a lost race (P2002 on the key) returns the winner with 200 instead of a 500', async () => {
    const winner = { id: 'ic-winner', reference: 'IC-0007', idempotencyKey: 'key-race', status: 'POSTED' };
    // Pre-check misses (winner not yet committed), the create loses
    // the unique-constraint race, and the re-fetch finds the winner.
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    mockPostInterCompany.mockRejectedValueOnce(new KnownRequestErrorStub('P2002'));

    const res = await POST(request({ ...baseBody, idempotencyKey: 'key-race' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe('ic-winner');
    expect(json.data.reference).toBe('IC-0007');
  });

  test('a POST without a key still posts normally (backwards compatible)', async () => {
    const res = await POST(request(baseBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.reference).toBe('IC-0001');
    expect(mockPostInterCompany).toHaveBeenCalledTimes(1);
    expect(mockPostInterCompany).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ idempotencyKey: undefined })
    );
    // No key → no dedupe lookup.
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('different keys are independent submissions and both post', async () => {
    const first = await POST(request({ ...baseBody, idempotencyKey: 'key-one' }));
    const second = await POST(request({ ...baseBody, idempotencyKey: 'key-two' }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(mockPostInterCompany).toHaveBeenCalledTimes(2);
    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(secondJson.data.id).not.toBe(firstJson.data.id);
  });
});
