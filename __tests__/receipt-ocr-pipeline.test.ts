/**
 * Phase 2 item 2 — the AI extraction pipeline against a mocked db and
 * FAKE providers (no network, no real OCR):
 *
 *  - configured + succeeding → status 'extracted', the raw result is
 *    stored verbatim in extractionFields, and found values are
 *    mirrored into the ocr* suggestion columns;
 *  - NOT configured → status 'unavailable' and the update carries NO
 *    field values at all (the document is stored; nothing is
 *    fabricated to fill the gap);
 *  - configured + throwing → status 'failed' with the error recorded
 *    and the ocr* columns untouched.
 */
jest.mock('@/lib/db', () => ({
  db: {
    receipt: { findFirst: jest.fn(), update: jest.fn() },
    company: { findUnique: jest.fn() },
    bankRule: { findMany: jest.fn() },
    categorizationRule: { findMany: jest.fn() },
    chartOfAccount: { findFirst: jest.fn() },
  },
}));

import { db } from '@/lib/db';
import { runReceiptExtraction, overallExtractionConfidence } from '@/lib/receipts/extraction-pipeline';
import type { ReceiptExtraction, ReceiptOcrProvider } from '@/lib/receipts/ocr-provider';

const mockDb = db as any;

const receiptRow = {
  id: 'r1',
  companyId: 'c1',
  storageBackend: 'db',
  imageData: Buffer.from('fake-image-bytes'),
  mimeType: 'image/png',
  ocrMerchant: null,
  ocrTotal: null,
  suggestedSource: null,
  suggestedCategoryId: null,
};

const EXTRACTION: ReceiptExtraction = {
  vendor: { value: 'STAPLES', confidence: 0.97 },
  date: { value: '2026-10-15', confidence: 0.99 },
  total: { value: 5.54, confidence: 0.96 },
  subtotal: { value: 5.28, confidence: 0.93 },
  taxAmount: { value: 0.26, confidence: 0.88 },
  currency: { value: 'CAD', confidence: 0.96 },
  lineItems: [],
};

const succeedingProvider: ReceiptOcrProvider = {
  id: 'fake-provider',
  isConfigured: () => true,
  extract: jest.fn(async () => EXTRACTION),
};

const failingProvider: ReceiptOcrProvider = {
  id: 'fake-provider',
  isConfigured: () => true,
  extract: jest.fn(async () => {
    throw new Error('provider exploded');
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow });
  mockDb.receipt.update.mockResolvedValue({});
  mockDb.company.findUnique.mockResolvedValue({ province: 'AB' });
  mockDb.bankRule.findMany.mockResolvedValue([]);
  mockDb.categorizationRule.findMany.mockResolvedValue([]);
});

describe('runReceiptExtraction', () => {
  test('extracted: stores the raw read verbatim and mirrors found fields into the suggestion columns', async () => {
    const result = await runReceiptExtraction(
      { companyId: 'c1', receiptId: 'r1' },
      { provider: succeedingProvider },
    );
    expect(result).toEqual({ status: 'extracted', providerId: 'fake-provider', error: null });

    const update = mockDb.receipt.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'r1' });
    expect(update.data.extractionStatus).toBe('extracted');
    expect(update.data.extractionProvider).toBe('fake-provider');
    expect(update.data.extractionFields).toEqual(EXTRACTION);
    expect(update.data.ocrMerchant).toBe('STAPLES');
    expect(update.data.ocrTotal).toBe(5.54);
    expect(update.data.ocrSubtotal).toBe(5.28);
    expect(update.data.ocrTaxAmount).toBe(0.26);
    expect(update.data.ocrDate).toEqual(new Date('2026-10-15T12:00:00Z'));
    // Weighted like the text parser's scale: .25·.97 + .25·.99 + .35·.96 + .15·.88
    expect(update.data.ocrConfidence).toBe(0.96);
    expect(update.data.ocrStatus).toBe('done');
  });

  test('unavailable: no provider configured — the document is stored and NO values are written', async () => {
    const result = await runReceiptExtraction(
      { companyId: 'c1', receiptId: 'r1' },
      { provider: null },
    );
    expect(result.status).toBe('unavailable');

    const update = mockDb.receipt.update.mock.calls[0][0];
    expect(update.data).toEqual({
      extractionStatus: 'unavailable',
      extractionProvider: null,
      extractionError: null,
    });
    // The whole point: an unconfigured pipeline fabricates nothing.
    expect(update.data.ocrMerchant).toBeUndefined();
    expect(update.data.ocrTotal).toBeUndefined();
    expect(update.data.extractionFields).toBeUndefined();
  });

  test('failed: a provider error is recorded on the row and the suggestion columns stay untouched', async () => {
    const result = await runReceiptExtraction(
      { companyId: 'c1', receiptId: 'r1' },
      { provider: failingProvider },
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/provider exploded/);

    const update = mockDb.receipt.update.mock.calls[0][0];
    expect(update.data.extractionStatus).toBe('failed');
    expect(update.data.extractionError).toMatch(/provider exploded/);
    expect(update.data.ocrMerchant).toBeUndefined();
    expect(update.data.ocrTotal).toBeUndefined();
    expect(update.data.extractionFields).toBeUndefined();
  });

  test('a null field from the model never overwrites an existing suggestion value', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({
      ...receiptRow,
      ocrMerchant: 'Typed By User',
      ocrTotal: 9.99,
    });
    const partial: ReceiptExtraction = {
      ...EXTRACTION,
      vendor: { value: null, confidence: null },
      total: { value: null, confidence: null },
    };
    const provider: ReceiptOcrProvider = {
      id: 'fake-provider',
      isConfigured: () => true,
      extract: jest.fn(async () => partial),
    };
    await runReceiptExtraction({ companyId: 'c1', receiptId: 'r1' }, { provider });
    const update = mockDb.receipt.update.mock.calls[0][0];
    expect(update.data.ocrMerchant).toBeUndefined();
    expect(update.data.ocrTotal).toBeUndefined();
    expect(update.data.ocrTaxAmount).toBe(0.26);
  });
});

describe('overallExtractionConfidence', () => {
  test('weights fields like the text parser and returns null when nothing was found', () => {
    expect(overallExtractionConfidence(EXTRACTION)).toBe(0.96);
    const empty: ReceiptExtraction = {
      vendor: { value: null, confidence: null },
      date: { value: null, confidence: null },
      total: { value: null, confidence: null },
      subtotal: { value: null, confidence: null },
      taxAmount: { value: null, confidence: null },
      currency: { value: null, confidence: null },
      lineItems: [],
    };
    expect(overallExtractionConfidence(empty)).toBeNull();
  });
});
