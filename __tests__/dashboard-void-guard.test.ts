// Regression test for the dashboard void guard: a reversed payment must not
// block voiding. The reversal entry copies the original payment's
// sourceType/sourceId, so the live-payment lookup must also require
// reversalOfId: null — the same fix the public API received in API-C.

import { NextRequest } from 'next/server';

const mockInvoiceFindUnique = jest.fn();
const mockTaxPostingFindFirst = jest.fn();
const mockTaxConfigurationFindUnique = jest.fn();
const mockJournalFindFirst = jest.fn();
const mockInvoiceFindUniqueOrThrow = jest.fn();
const mockInvoiceUpdate = jest.fn();
const mockQueryRaw = jest.fn();
const mockTransaction = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      findUnique: (...a: unknown[]) => mockInvoiceFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockInvoiceFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockInvoiceUpdate(...a),
    },
    taxPosting: { findFirst: (...a: unknown[]) => mockTaxPostingFindFirst(...a) },
    companyTaxConfiguration: { findUnique: (...a: unknown[]) => mockTaxConfigurationFindUnique(...a) },
    $transaction: (fn: unknown) => {
      mockTransaction(fn);
      return fn({
        invoice: { findUniqueOrThrow: mockInvoiceFindUniqueOrThrow, update: mockInvoiceUpdate },
        journalEntry: { findFirst: (...a: unknown[]) => mockJournalFindFirst(...a) },
        $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
      });
    },
  },
}));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
const mockClosedPeriodGuard = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...a: unknown[]) => mockRequireCompany(...a),
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
  closedPeriodGuard: (...a: unknown[]) => mockClosedPeriodGuard(...a),
}));

const mockReverseTaxPosting = jest.fn();
jest.mock('@/lib/tax/posting-service', () => {
  const actual = jest.requireActual('@/lib/tax/posting-service');
  return {
    ...actual,
    reverseTaxPosting: (...a: unknown[]) => mockReverseTaxPosting(...a),
  };
});
jest.mock('@/lib/journal', () => ({
  voidJournalEntry: jest.fn(),
  postInvoiceToLedger: jest.fn(),
}));
jest.mock('@/lib/fx/document', () => ({
  resolveDocumentFx: jest.fn(),
  FxValidationError: class extends Error {},
}));

import { PUT } from '@/app/api/invoices/[id]/route';

const voidRequest = () =>
  new NextRequest('http://localhost/api/invoices/INV-1', {
    method: 'PUT',
    body: JSON.stringify({ status: 'void' }),
    headers: { 'content-type': 'application/json' },
  });

describe('dashboard invoice void guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'co-1', userId: 'u-1', error: null });
    mockInvoiceFindUnique.mockResolvedValue({
      id: 'INV-1',
      status: 'sent',
      paidAmount: 0,
      subtotal: 100,
      taxAmount: 0,
      total: 100,
      issueDate: new Date('2026-09-01'),
      lineItems: [],
    });
    mockTaxPostingFindFirst.mockResolvedValue({ id: 'posting-1', reversedBy: null });
    mockInvoiceFindUniqueOrThrow.mockResolvedValue({ id: 'INV-1', status: 'sent', paidAmount: 0 });
    mockInvoiceUpdate.mockResolvedValue({ id: 'INV-1', status: 'void' });
    mockReverseTaxPosting.mockResolvedValue({});
  });

  test('a reversed payment no longer blocks voiding (the regression)', async () => {
    // The reversal entry matches sourceType/sourceId and has voidedAt null —
    // the OLD guard matched it and threw 409 forever. The fixed guard asks
    // for reversalOfId: null, so the lookup returns nothing.
    mockJournalFindFirst.mockImplementation(({ where }: any) =>
      where.reversalOfId === null ? Promise.resolve(null) : Promise.resolve({ id: 'reversal-entry', reversalOfId: 'orig-payment' })
    );

    const res = await PUT(voidRequest(), { params: { id: 'INV-1' } } as any);
    expect(res.status).toBe(200);
    expect(mockReverseTaxPosting).toHaveBeenCalledTimes(1);
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'void' } }));
  });

  test('a live, unreversed payment still blocks voiding', async () => {
    mockJournalFindFirst.mockImplementation(({ where }: any) =>
      where.reversalOfId === null
        ? Promise.resolve({ id: 'live-payment', sourceType: 'payment', sourceId: 'INV-1', voidedAt: null, reversalOfId: null })
        : Promise.resolve(null)
    );

    const res = await PUT(voidRequest(), { params: { id: 'INV-1' } } as any);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('Reverse the payments');
    expect(mockReverseTaxPosting).not.toHaveBeenCalled();
    expect(mockInvoiceUpdate).not.toHaveBeenCalled();
  });
});
