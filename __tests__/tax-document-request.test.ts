const transaction = jest.fn();
jest.mock('@/lib/db', () => ({ db: { $transaction: (...args: unknown[]) => transaction(...args) } }));
import { withReviewedDocumentRequest } from '@/lib/tax/document-request';
import { isTaxDate } from '@/lib/tax/date';

describe('reviewed document save requests', () => {
  const request = { companyId: 'company-1', userId: 'owner-1', kind: 'bill' as const, key: 'save-request-1', payload: { amount: 100, currency: 'CAD' } };
  let receipt: any;
  let tx: any;
  beforeEach(() => {
    receipt = null;
    tx = { membership: { findUnique: jest.fn().mockResolvedValue({ role: 'owner' }) }, $queryRaw: jest.fn(), auditLog: {
      findFirst: jest.fn(async () => receipt),
      create: jest.fn(async ({ data }) => { receipt = data; return data; }),
    } };
    transaction.mockImplementation(async work => work(tx));
  });

  test('an identical retry reuses the document and does not call creation twice', async () => {
    const create = jest.fn(async (_tx, id) => ({ id }));
    const replay = jest.fn(async (_tx, id) => ({ id }));
    const first = await withReviewedDocumentRequest(request, create, replay);
    expect(await withReviewedDocumentRequest({ ...request, payload: { currency: 'CAD', amount: 100 } }, create, replay)).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(tx, first.id);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test('rejects changed contents and a different actor reusing the same key', async () => {
    const create = jest.fn(async () => 'created');
    const replay = jest.fn();
    await withReviewedDocumentRequest(request, create, replay);
    await expect(withReviewedDocumentRequest({ ...request, payload: { amount: 200 } }, create, replay)).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    await expect(withReviewedDocumentRequest({ ...request, userId: 'another-owner' }, create, replay)).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    expect(replay).not.toHaveBeenCalled();
  });

  test('does not record successful creation when the posting fails', async () => {
    const failure = new Error('snapshot failed');
    await expect(withReviewedDocumentRequest(request, async client => { expect(client).toBe(tx); throw failure; }, jest.fn())).rejects.toBe(failure);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  test('blocks viewers before locking or writing', async () => {
    tx.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    const create = jest.fn();
    await expect(withReviewedDocumentRequest(request, create, jest.fn())).rejects.toMatchObject({ code: 'insufficient_permissions' });
    expect(create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('only accepts real calendar tax dates', () => {
    expect(isTaxDate('2026-02-30')).toBe(false);
    expect(isTaxDate('2026-13-01')).toBe(false);
    expect(isTaxDate('2024-02-29')).toBe(true);
    expect(isTaxDate('2026-09-08')).toBe(true);
  });
});
