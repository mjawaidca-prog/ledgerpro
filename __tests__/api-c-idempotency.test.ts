import { NextRequest } from 'next/server';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockTransaction = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    apiIdempotencyRecord: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      create: (...a: unknown[]) => mockCreate(...a),
    },
    $transaction: (fn: unknown) => {
      mockTransaction(fn);
      return fn({ apiIdempotencyRecord: { findUnique: mockFindUnique, create: mockCreate } });
    },
  },
}));

describe('idempotency header parsing', () => {
  const req = (key?: string) =>
    new NextRequest('http://localhost/api/v1/contacts', {
      method: 'POST',
      headers: key === undefined ? {} : { 'Idempotency-Key': key },
    });

  test('writes without an Idempotency-Key header are rejected', () => {
    const result = idempotencyContextFrom(req(), { apiKeyId: 'k', companyId: 'co-1' });
    expect('error' in result).toBe(true);
    expect(result.error!.status).toBe(400);
  });

  test('keys are trimmed and length-bounded', () => {
    const ok = idempotencyContextFrom(req('  my-key-123  '), { apiKeyId: 'k', companyId: 'co-1' });
    expect('context' in ok).toBe(true);
    expect(ok.context.requestKey).toBe('my-key-123');

    const tooLong = idempotencyContextFrom(req('x'.repeat(201)), { apiKeyId: 'k', companyId: 'co-1' });
    expect('error' in tooLong).toBe(true);
  });
});

describe('withIdempotency', () => {
  const ctx = { requestKey: 'key-1', apiKeyId: 'k', companyId: 'co-1', method: 'POST', path: '/api/v1/contacts' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('executes exactly once and stores the outcome', async () => {
    mockFindUnique.mockResolvedValue(null);
    const execute = jest.fn().mockResolvedValue({
      resourceType: 'contact',
      resourceId: 'c-1',
      statusCode: 201,
      body: { data: { id: 'c-1' } },
    });

    const outcome = await withIdempotency(ctx, execute);
    expect(outcome.replayed).toBe(false);
    expect(outcome.body).toEqual({ data: { id: 'c-1' } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKeyId: 'k',
          requestKey: 'key-1',
          resourceId: 'c-1',
          statusCode: 201,
          response: { data: { id: 'c-1' } },
        }),
      })
    );
  });

  test('replays the stored response without executing again', async () => {
    mockFindUnique.mockResolvedValue({
      response: { data: { id: 'c-1' } },
      statusCode: 201,
    });
    const execute = jest.fn();

    const outcome = await withIdempotency(ctx, execute);
    expect(outcome.replayed).toBe(true);
    expect(outcome.statusCode).toBe(201);
    expect(outcome.body).toEqual({ data: { id: 'c-1' } });
    expect(execute).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a retry racing an in-flight request re-reads the winner inside the transaction', async () => {
    // Pre-transaction lookup misses, but the in-transaction lookup finds the
    // concurrent winner — execute must not run.
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      response: { data: { id: 'c-1' } },
      statusCode: 201,
    });
    const execute = jest.fn();

    const outcome = await withIdempotency(ctx, execute);
    expect(outcome.replayed).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});
