import { NextRequest } from 'next/server';

const mockContactCreate = jest.fn();
const mockContactFindFirst = jest.fn();
const mockInvoiceCreate = jest.fn();
const mockCompanyFind = jest.fn();
const mockIdemFindUnique = jest.fn();
const mockIdemCreate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    contact: {
      create: (...a: unknown[]) => mockContactCreate(...a),
      findFirst: (...a: unknown[]) => mockContactFindFirst(...a),
    },
    invoice: { create: (...a: unknown[]) => mockInvoiceCreate(...a) },
    company: { findUniqueOrThrow: (...a: unknown[]) => mockCompanyFind(...a) },
    apiIdempotencyRecord: { findUnique: (...a: unknown[]) => mockIdemFindUnique(...a), create: (...a: unknown[]) => mockIdemCreate(...a) },
    $transaction: (fn: unknown) => fn({ contact: { create: mockContactCreate }, invoice: { create: mockInvoiceCreate }, apiIdempotencyRecord: { findUnique: mockIdemFindUnique, create: mockIdemCreate } }),
  },
}));

const mockAuthenticate = jest.fn();
jest.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: (...a: unknown[]) => mockAuthenticate(...a),
}));
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));

import { POST as postContact } from '@/app/api/v1/contacts/route';
import { POST as postInvoice } from '@/app/api/v1/invoices/route';

const context = { apiKeyId: 'k', apiKeyName: 'Reporting', companyId: 'co-1', permissions: ['read', 'write_draft'] };

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'test-key', ...headers },
  });
}

describe('API-C draft writes — contacts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ context, error: null });
    mockIdemFindUnique.mockResolvedValue(null);
    mockCompanyFind.mockResolvedValue({ currency: 'CAD', enabledCurrencies: ['CAD', 'USD'] });
    mockContactCreate.mockImplementation(async ({ data }) => ({ ...data, id: 'c-new' }));
  });

  test('POST requires the write_draft permission', async () => {
    await postContact(req({ name: 'Cust', type: 'customer' }));
    expect(mockAuthenticate).toHaveBeenCalledWith(expect.any(NextRequest), { permission: 'write_draft' });
  });

  test('field-level validation errors carry the v1 envelope', async () => {
    const res = await postContact(req({ type: 'customer' })); // missing name
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.fields.name).toBeTruthy();
    expect(mockContactCreate).not.toHaveBeenCalled();
  });

  test('a disabled currency is rejected with a field error', async () => {
    const res = await postContact(req({ name: 'Cust', type: 'customer', currency: 'EUR' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fields.currency).toContain('not enabled');
    expect(mockContactCreate).not.toHaveBeenCalled();
  });

  test('successful create is scoped to the key company and records the integration identity', async () => {
    const res = await postContact(req({ name: 'Cust', type: 'customer' }));
    expect(res.status).toBe(201);
    expect(mockContactCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-1', name: 'Cust', type: 'customer' }) })
    );
    expect(mockAuditLog).toHaveBeenCalledWith('co-1', undefined, 'api.contact.create', 'contact', 'c-new', undefined, expect.objectContaining({ apiKeyId: 'k' }));
  });

  test('the same Idempotency-Key replays the stored response without a second create', async () => {
    mockIdemFindUnique.mockResolvedValue({
      response: { data: { id: 'c-new', name: 'Cust', type: 'customer', currency: 'CAD' } },
      statusCode: 201,
    });
    const res = await postContact(req({ name: 'Cust', type: 'customer' }));
    expect(res.status).toBe(201);
    expect(mockContactCreate).not.toHaveBeenCalled();
  });
});

describe('API-C draft writes — invoices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ context, error: null });
    mockIdemFindUnique.mockResolvedValue(null);
    mockCompanyFind.mockResolvedValue({ currency: 'CAD', enabledCurrencies: ['CAD', 'USD'] });
    mockContactFindFirst.mockResolvedValue({ id: 'cust-1', currency: 'CAD' });
    mockInvoiceCreate.mockImplementation(async ({ data }) => ({ ...data, id: data.id, lineItems: [] }));
  });

  const invoiceReq = (body: unknown) =>
    new NextRequest('http://localhost/api/v1/invoices', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'inv-key' },
    });

  const valid = () => ({
    customerId: 'cust-1',
    issueDate: '2026-09-10',
    dueDate: '2026-10-10',
    lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 100, amount: 100 }],
  });

  test('creates a draft with server-computed totals and a generated id', async () => {
    const res = await postInvoice(invoiceReq({ ...valid(), lineItems: [{ description: 'A', quantity: 2, unitPrice: 50, amount: 100 }, { description: 'B', quantity: 1, unitPrice: 25, amount: 25 }] }));
    expect(res.status).toBe(201);
    const createArg = mockInvoiceCreate.mock.calls[0][0];
    expect(createArg.data.status).toBe('draft');
    expect(createArg.data.subtotal).toBe(125);
    expect(createArg.data.total).toBe(125);
    expect(createArg.data.taxAmount).toBe(0);
    expect(createArg.data.id).toMatch(/^INV-/);
    expect(createArg.data.companyId).toBe('co-1');
  });

  test('a foreign customer id is rejected with a field error', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    const res = await postInvoice(invoiceReq(valid()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fields.customerId).toBeTruthy();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  test('a foreign currency without a frozen fxRate is rejected', async () => {
    mockContactFindFirst.mockResolvedValue({ id: 'cust-1', currency: 'USD' });
    const res = await postInvoice(invoiceReq({ ...valid(), currency: 'USD' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fields.fxRate).toContain('required');
  });

  test('a foreign currency with fxRate freezes it on the draft', async () => {
    mockContactFindFirst.mockResolvedValue({ id: 'cust-1', currency: 'USD' });
    const res = await postInvoice(invoiceReq({ ...valid(), currency: 'USD', fxRate: 1.35 }));
    expect(res.status).toBe(201);
    const createArg = mockInvoiceCreate.mock.calls[0][0];
    expect(createArg.data.fxRate).toBe(1.35);
    expect(createArg.data.fxRateSource).toBe('manual');
  });

  test('dueDate before issueDate is a field error', async () => {
    const res = await postInvoice(invoiceReq({ ...valid(), dueDate: '2026-01-01' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.dueDate).toBeTruthy();
  });
});
