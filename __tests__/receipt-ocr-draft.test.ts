/**
 * Phase 2 item 2 — receipt → DRAFT expense.
 *
 * Part 1 pins the pure shape builder: extracted line items become the
 * draft's lines when they reconcile to the net, the draft is balanced
 * to the cent (lines sum to subtotal; subtotal + tax == total), tax
 * follows the app's document model, and missing vendor/date/total are
 * hard errors — a draft is never built on invented figures.
 *
 * Part 2 pins the DB creation against a mocked db: a Bill with
 * kind='expense', status='draft' (nothing posts), the vendor found or
 * created as a supplier in the document currency, the source document
 * linked from both sides, the already-created and not-extracted
 * guards, and the history fallback for the category.
 */
jest.mock('@/lib/db', () => ({
  db: {
    receipt: { findFirst: jest.fn(), update: jest.fn() },
    company: { findUnique: jest.fn() },
    contact: { findFirst: jest.fn(), create: jest.fn() },
    bill: { create: jest.fn() },
    transaction: { findMany: jest.fn() },
    chartOfAccount: { findFirst: jest.fn() },
  },
}));
jest.mock('@/lib/api-helpers', () => ({
  closedPeriodGuard: jest.fn(async () => null),
  accountLockedGuard: jest.fn(async () => null),
}));

import { db } from '@/lib/db';
import { buildDraftExpense, createDraftExpenseFromReceipt } from '@/lib/receipts/draft';

const mockDb = db as any;

describe('buildDraftExpense (pure)', () => {
  const base = {
    vendor: 'STAPLES',
    date: '2026-10-15',
    total: 5.54,
    subtotal: 5.28,
    taxAmount: 0.26,
    currency: 'CAD',
    lineItems: [] as any[],
    categoryId: 'coa1',
  };

  test('extracted line items that reconcile to the net become the draft lines; the draft balances', () => {
    const built = buildDraftExpense({
      ...base,
      lineItems: [{ description: 'Copy Paper', quantity: 1, unitPrice: 5.28, amount: 5.28, confidence: 0.9 }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.lines).toEqual([{ description: 'Copy Paper', amount: 5.28, categoryId: 'coa1' }]);
    expect(built.draft.subtotal).toBe(5.28);
    expect(built.draft.taxAmount).toBe(0.26);
    expect(built.draft.total).toBe(5.54);
    const linesSum = built.draft.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(linesSum * 100)).toBe(Math.round(built.draft.subtotal * 100));
    expect(Math.round((built.draft.subtotal + built.draft.taxAmount) * 100)).toBe(
      Math.round(built.draft.total * 100),
    );
    // taxRate is the document-model percent: 0.26 / 5.28
    expect(built.draft.taxRate).toBe(4.924);
  });

  test('no line items → one line at the net amount', () => {
    const built = buildDraftExpense(base);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.lines).toEqual([{ description: 'STAPLES', amount: 5.28, categoryId: 'coa1' }]);
  });

  test('line items that do NOT reconcile are not trusted as the split', () => {
    const built = buildDraftExpense({
      ...base,
      lineItems: [{ description: 'Wrong read', quantity: 1, unitPrice: 99, amount: 99, confidence: 0.4 }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.lines).toEqual([{ description: 'STAPLES', amount: 5.28, categoryId: 'coa1' }]);
  });

  test('a cent of rounding drift is folded into the last line so the draft balances exactly', () => {
    const built = buildDraftExpense({
      ...base,
      total: 7.53,
      subtotal: null,
      taxAmount: 0.86,
      lineItems: [
        { description: 'A', quantity: 1, unitPrice: 3.33, amount: 3.33, confidence: 0.9 },
        { description: 'B', quantity: 1, unitPrice: 3.33, amount: 3.33, confidence: 0.9 },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.subtotal).toBe(6.67);
    expect(built.draft.lines.map((l) => l.amount)).toEqual([3.33, 3.34]);
    expect(built.draft.subtotal + built.draft.taxAmount).toBe(7.53);
  });

  test('tax is derived from total − subtotal when the tax line itself was not read', () => {
    const built = buildDraftExpense({ ...base, total: 113, subtotal: 100, taxAmount: null });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.taxAmount).toBe(13);
    expect(built.draft.subtotal).toBe(100);
  });

  test('missing vendor, date or total are errors — never invented', () => {
    expect(buildDraftExpense({ ...base, vendor: null })).toMatchObject({ ok: false });
    expect(buildDraftExpense({ ...base, vendor: '  ' })).toMatchObject({ ok: false });
    expect(buildDraftExpense({ ...base, date: null })).toMatchObject({ ok: false });
    expect(buildDraftExpense({ ...base, total: null })).toMatchObject({ ok: false });
    expect(buildDraftExpense({ ...base, total: 0 })).toMatchObject({ ok: false });
  });
});

describe('createDraftExpenseFromReceipt (mocked db)', () => {
  const receiptRow = {
    id: 'r1',
    companyId: 'c1',
    originalFileName: 'staples.png',
    extractionStatus: 'extracted',
    extractionProvider: 'azure-document-intelligence',
    extractionFields: {
      currency: { value: 'CAD', confidence: 0.96 },
      lineItems: [
        { description: 'Copy Paper', quantity: 1, unitPrice: 5.28, amount: 5.28, confidence: 0.9 },
      ],
    },
    ocrMerchant: 'STAPLES',
    ocrDate: new Date('2026-10-15T12:00:00.000Z'),
    ocrTotal: 5.54,
    ocrSubtotal: 5.28,
    ocrTaxAmount: 0.26,
    suggestedCategoryId: 'coa1',
    suggestedSource: 'categorization_rule',
    draftBillId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow });
    mockDb.receipt.update.mockResolvedValue({});
    mockDb.company.findUnique.mockResolvedValue({ currency: 'CAD' });
    mockDb.contact.findFirst.mockResolvedValue({ id: 'v1', currency: 'CAD' });
    mockDb.contact.create.mockResolvedValue({ id: 'v-new', currency: 'CAD' });
    mockDb.bill.create.mockImplementation(async ({ data }: any) => ({
      id: data.id,
      status: data.status,
      total: data.total,
      currency: data.currency,
      lineItems: [{ id: 'li1' }],
    }));
    mockDb.transaction.findMany.mockResolvedValue([]);
    mockDb.chartOfAccount.findFirst.mockResolvedValue(null);
  });

  test('creates a DRAFT expense bill — balanced, categorized, source document linked, nothing posted', async () => {
    const result = await createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1' });
    expect(result?.billId).toMatch(/^EXP-\d{4}$/);
    expect(result?.status).toBe('draft');

    const createArg = mockDb.bill.create.mock.calls[0][0];
    expect(createArg.data.kind).toBe('expense');
    expect(createArg.data.status).toBe('draft');
    expect(createArg.data.vendorId).toBe('v1');
    expect(createArg.data.subtotal).toBe(5.28);
    expect(createArg.data.taxAmount).toBe(0.26);
    expect(createArg.data.total).toBe(5.54);
    expect(createArg.data.lineItems.create).toEqual([
      { description: 'Copy Paper', amount: 5.28, categoryId: 'coa1', sortOrder: 0 },
    ]);
    // The source document is linked from the bill…
    expect(createArg.data.attachments).toEqual(['/api/receipts/r1/image']);
    expect(createArg.data.notes).toMatch(/staples\.png/);
    // …and from the receipt.
    expect(mockDb.receipt.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { draftBillId: result?.billId },
    });
  });

  test('creates the vendor as a supplier in the document currency when it is new', async () => {
    mockDb.contact.findFirst.mockResolvedValue(null);
    await createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1' });
    expect(mockDb.contact.create).toHaveBeenCalledWith({
      data: { companyId: 'c1', name: 'STAPLES', type: 'supplier', currency: 'CAD' },
      select: { id: true, currency: true },
    });
    expect(mockDb.bill.create.mock.calls[0][0].data.vendorId).toBe('v-new');
  });

  test('refuses a second draft for the same receipt', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, draftBillId: 'EXP-9999' });
    await expect(createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1' })).rejects.toThrow(
      /already created/,
    );
    expect(mockDb.bill.create).not.toHaveBeenCalled();
  });

  test('refuses a receipt the AI has not read yet', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, extractionStatus: 'unavailable' });
    await expect(createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1' })).rejects.toThrow(
      /AI read/,
    );
    expect(mockDb.bill.create).not.toHaveBeenCalled();
  });

  test('falls back to the company’s own history for the category when no rule suggested one', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, suggestedCategoryId: null, suggestedSource: null });
    mockDb.transaction.findMany.mockResolvedValue([
      { splits: [{ categoryCode: '6810', amount: 5.28 }] },
    ]);
    mockDb.chartOfAccount.findFirst.mockResolvedValue({ id: 'coa-hist' });

    await createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1' });
    const createArg = mockDb.bill.create.mock.calls[0][0];
    expect(createArg.data.lineItems.create[0].categoryId).toBe('coa-hist');
    // …and the suggestion is written back to the receipt as history-sourced.
    expect(mockDb.receipt.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { suggestedCategoryId: 'coa-hist', suggestedSource: 'history' },
    });
  });

  test('returns null for a receipt of another company', async () => {
    mockDb.receipt.findFirst.mockResolvedValue(null);
    await expect(createDraftExpenseFromReceipt({ companyId: 'c1', receiptId: 'nope' })).resolves.toBeNull();
  });
});
