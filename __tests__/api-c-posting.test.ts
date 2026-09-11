import { NextRequest } from 'next/server';

const mockInvoiceFindFirst = jest.fn();
const mockSnapshotsFindMany = jest.fn();
const mockInvoiceUpdate = jest.fn();
const mockJournalFindFirst = jest.fn();
const mockPeriodCloseFindFirst = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      findFirst: (...a: unknown[]) => mockInvoiceFindFirst(...a),
      update: (...a: unknown[]) => mockInvoiceUpdate(...a),
    },
    documentLineTaxSnapshot: { findMany: (...a: unknown[]) => mockSnapshotsFindMany(...a) },
    journalEntry: { findFirst: (...a: unknown[]) => mockJournalFindFirst(...a) },
    periodClose: { findFirst: (...a: unknown[]) => mockPeriodCloseFindFirst(...a) },
    apiIdempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: (fn: unknown) =>
      fn({
        invoice: { findFirst: mockInvoiceFindFirst, update: mockInvoiceUpdate },
        documentLineTaxSnapshot: { findMany: mockSnapshotsFindMany },
        journalEntry: { findFirst: mockJournalFindFirst },
        apiIdempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      }),
  },
}));

const mockPostTaxDocument = jest.fn();
jest.mock('@/lib/tax/posting-service', () => ({
  postTaxDocument: (...a: unknown[]) => mockPostTaxDocument(...a),
  TaxPostingError: class extends Error {
    constructor(public code: string, message: string, public status = 400) {
      super(message);
    }
  },
}));

const mockAuthenticate = jest.fn();
jest.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: (...a: unknown[]) => mockAuthenticate(...a),
}));

const mockClosedPeriodGuard = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  closedPeriodGuard: (...a: unknown[]) => mockClosedPeriodGuard(...a),
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
}));

import { NextResponse } from 'next/server';
import { POST as postInvoice } from '@/app/api/v1/invoices/[id]/post/route';

const context = { apiKeyId: 'k', apiKeyName: 'Reporting', companyId: 'co-1', permissions: ['read', 'write_posting'] };

const draft = {
  id: 'INV-1',
  status: 'draft',
  issueDate: new Date('2026-09-01'),
  lineItems: [{ id: 'line-1', sortOrder: 0 }],
};

function req(body: unknown, key = 'post-key') {
  return new NextRequest('http://localhost/api/v1/invoices/INV-1/post', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
  });
}

const decision = (taxCodeVersionId = 'v1') => ({
  requestKey: 'rk-1',
  lines: [{ lineIndex: 0, taxCodeVersionId, jurisdictionEvidence: { reference: 'invoice' } }],
});

const call = (body: unknown, key = 'post-key') => postInvoice(req(body, key), { params: { id: 'INV-1' } } as any);

describe('API-C posting — invoice post', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ context, error: null });
    mockInvoiceFindFirst.mockResolvedValue(draft);
    mockClosedPeriodGuard.mockResolvedValue(null);
    mockPostTaxDocument.mockResolvedValue({ id: 'posting-1' });
    mockSnapshotsFindMany.mockResolvedValue([
      { netAmount: 100, taxAmount: 13, grossAmount: 113 },
    ]);
    mockInvoiceUpdate.mockResolvedValue({ id: 'INV-1', status: 'sent', subtotal: 100, taxAmount: 13, total: 113 });
  });

  test('requires the write_posting permission', async () => {
    await call(decision());
    expect(mockAuthenticate).toHaveBeenCalledWith(expect.any(NextRequest), { permission: 'write_posting' });
  });

  test('posts through the tax engine with the API key as actor and null user', async () => {
    const res = await call(decision());
    expect(res.status).toBe(200);

    expect(mockPostTaxDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        userId: null,
        actor: { kind: 'api_key', keyId: 'k' },
        sourceType: 'invoice',
        sourceId: 'INV-1',
        sourceKey: 'invoice:INV-1:rk-1',
        lines: [{ sourceLineId: 'line-1', taxCodeVersionId: 'v1', jurisdictionEvidence: { reference: 'invoice' } }],
      }),
      expect.anything()
    );
  });

  test('document totals come from the immutable snapshots, never the caller', async () => {
    const res = await call(decision());
    expect(res.status).toBe(200);
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subtotal: 100, taxAmount: 13, total: 113, status: 'sent' }) })
    );
  });

  test('missing tax decisions per line are rejected before the engine runs', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...draft, lineItems: [{ id: 'line-1' }, { id: 'line-2' }] });
    const res = await call(decision());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('tax_decision_required');
    expect(mockPostTaxDocument).not.toHaveBeenCalled();
  });

  test('non-draft documents are rejected', async () => {
    mockInvoiceFindFirst.mockResolvedValue({ ...draft, status: 'sent' });
    const res = await call(decision());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('document_not_draft');
  });

  test('closed periods block posting', async () => {
    mockClosedPeriodGuard.mockResolvedValue(
      NextResponse.json({ error: 'This date falls within a closed period.' }, { status: 409 })
    );
    const res = await call(decision());
    expect(res.status).toBe(409);
    expect(mockPostTaxDocument).not.toHaveBeenCalled();
  });

  test('successful posting records the integration identity in the audit trail', async () => {
    await call(decision());
    expect(mockAuditLog).toHaveBeenCalledWith('co-1', undefined, 'api.invoice.post', 'invoice', 'INV-1', undefined, expect.objectContaining({ apiKeyId: 'k' }));
  });

  test('a replayed Idempotency-Key returns the stored response without re-posting', async () => {
    const { db } = jest.requireMock('@/lib/db');
    (db.apiIdempotencyRecord.findUnique as jest.Mock).mockResolvedValueOnce({
      response: { data: { id: 'INV-1', status: 'sent' } },
      statusCode: 200,
    });
    const res = await call(decision());
    expect(res.status).toBe(200);
    expect(mockPostTaxDocument).not.toHaveBeenCalled();
  });
});
