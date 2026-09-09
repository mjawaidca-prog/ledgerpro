import { NextRequest } from 'next/server';

const createBill = jest.fn();
const updateBill = jest.fn();
const deleteBill = jest.fn();
const context = jest.fn();
const preview = jest.fn();
const postTax = jest.fn();
const postLegacy = jest.fn();
jest.mock('@/lib/db', () => ({ db: {
  contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Vendor', currency: 'CAD' }) },
  company: { findUnique: jest.fn().mockResolvedValue({ currency: 'CAD' }) },
  bill: { create: (...args: unknown[]) => createBill(...args), update: (...args: unknown[]) => updateBill(...args), delete: (...args: unknown[]) => deleteBill(...args) },
} }));
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: jest.fn().mockResolvedValue({ companyId: 'company', userId: 'owner', error: null }),
  closedPeriodGuard: jest.fn().mockResolvedValue(null), auditLog: jest.fn(),
}));
jest.mock('@/lib/fx/document', () => ({ resolveDocumentFx: jest.fn().mockResolvedValue(null), FxValidationError: class extends Error {} }));
jest.mock('@/lib/journal', () => ({ postBillToLedger: (...args: unknown[]) => postLegacy(...args) }));
jest.mock('@/lib/tax/ui-service', () => ({ getTaxUiContext: (...args: unknown[]) => context(...args), previewTaxDraft: (...args: unknown[]) => preview(...args) }));
jest.mock('@/lib/tax/posting-service', () => ({ postTaxDocument: (...args: unknown[]) => postTax(...args), TaxPostingError: class extends Error {} }));
jest.mock('@/lib/tax/document-request', () => ({
  withReviewedDocumentRequest: async (_request: unknown, create: (client: unknown, id: string) => Promise<unknown>) => create(require('@/lib/db').db, 'bill-id'),
}));

import { POST } from '@/app/api/bills/route';

const payload = {
  kind: 'bill', vendorId: 'vendor', billDate: '2026-09-08', status: 'open',
  subtotal: 1, taxAmount: 999, total: 1000,
  lineItems: [{ description: 'Supplies', amount: 100, categoryId: 'expense' }],
  taxDecision: { requestKey: 'request-123456', lines: [{ lineIndex: 0, taxCodeVersionId: 'version', jurisdictionEvidence: { reference: 'receipt' } }] },
};

describe('reviewed bill create route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    context.mockResolvedValue({ enabled: true, ready: true, issues: [] });
    preview.mockResolvedValue({ netMinor: 10000, taxMinor: 500, grossMinor: 10500, grossHomeMinor: 10500 });
    createBill.mockImplementation(async ({ data }) => ({ ...data, id: 'bill-id', lineItems: [{ id: 'line-id', amount: 100, categoryId: 'expense' }], vendor: { name: 'Vendor' } }));
    postTax.mockResolvedValue({ id: 'posting' });
    updateBill.mockResolvedValue({ id: 'bill-id', status: 'open' });
    deleteBill.mockResolvedValue({});
  });

  const request = (body: unknown) => new NextRequest('http://localhost/api/bills', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  test('posts an initially draft record and uses server totals, not browser totals', async () => {
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    expect(createBill).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'draft', subtotal: 100, taxAmount: 5, total: 105 }) }));
    expect(postTax).toHaveBeenCalledTimes(1);
    expect(postLegacy).not.toHaveBeenCalled();
    expect(updateBill).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'open' } }));
  });

  test('does not create anything when reviewed decisions are missing', async () => {
    const { taxDecision: _decision, ...body } = payload;
    expect((await POST(request(body))).status).toBe(400);
    expect(createBill).not.toHaveBeenCalled();
    expect(postLegacy).not.toHaveBeenCalled();
  });

  test('does not create anything when tax setup is not ready', async () => {
    context.mockResolvedValue({ enabled: true, ready: false, issues: [{ message: 'Mapping missing' }] });
    expect((await POST(request(payload))).status).toBe(409);
    expect(createBill).not.toHaveBeenCalled();
  });

  test('keeps legacy draft creation available with the feature off', async () => {
    context.mockResolvedValue({ enabled: false, ready: false, issues: [] });
    const { taxDecision: _decision, ...body } = payload;
    expect((await POST(request({ ...body, status: 'draft' }))).status).toBe(201);
    expect(postTax).not.toHaveBeenCalled();
    expect(postLegacy).not.toHaveBeenCalled();
  });
});
