/**
 * Receipt text extraction — the two failure modes found live on
 * 2026-10-29, locked down as regression tests:
 *
 * 1. PDF text must flow through the (modern) extractor into the
 *    parser. The previous reader (pdf-parse 1.x) failed on every
 *    modern PDF; the extractor now uses unpdf. unpdf's own ESM build
 *    uses import.meta, which jest's CJS transform cannot load, so the
 *    library is mocked here with the exact text the fixture receipt
 *    contains — the real library was verified against real modern
 *    PDFs from three generators in plain Node and again live after
 *    shipping (see PR notes). What this test pins is OUR wiring:
 *    extract → parse → merchant/date/tax/total.
 * 2. Image extraction must be time-bounded. Server-side tesseract.js
 *    never completes in the serverless environment, so an unbounded
 *    call hangs the upload and no receipt is stored. The timeout
 *    turns that into a clean 'none' (manual entry) result.
 */
import { extractReceiptText, withExtractionTimeout } from '@/lib/receipts/extract';
import { parseReceiptText } from '@/lib/receipts/parse';

// The text unpdf extracts from the Tim Hortons test receipt.
jest.mock('unpdf', () => ({
  getDocumentProxy: jest.fn(async () => ({})),
  extractText: jest.fn(async () => ({
    totalPages: 1,
    text: [
      'TIM HORTONS #4521',
      '1234 Centre St N',
      'Calgary, AB',
      '2026-10-15 08:32 AM',
      'Coffee Large 2.79',
      'Bagel 2.49',
      'Subtotal 5.28',
      'GST 0.26',
      'Total 5.54',
      'THANK YOU',
    ].join('\n'),
  })),
}));

// A hung OCR worker: createWorker returns a promise that never settles.
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(() => new Promise(() => {})),
}));

describe('extractReceiptText — PDF', () => {
  test('extracted PDF text parses into merchant, date, tax and total', async () => {
    const extracted = await extractReceiptText(Buffer.from('%PDF-fake'), 'application/pdf');
    expect(extracted.method).toBe('pdf-text');
    expect(extracted.text).toContain('TIM HORTONS');

    const parsed = parseReceiptText(extracted.text);
    expect(parsed).not.toBeNull();
    expect(parsed!.merchant).toContain('TIM HORTONS');
    expect(parsed!.total).toBe(5.54);
    expect(parsed!.taxAmount).toBe(0.26);
    expect(parsed!.date).toBe('2026-10-15');
  }, 30000);
});

describe('extractReceiptText — image timeout', () => {
  test('a stuck OCR worker resolves as method none via the timeout', async () => {
    const started = Date.now();
    const extracted = await extractReceiptText(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', {
      timeoutMs: 100,
    });
    expect(extracted.method).toBe('none');
    expect(extracted.error).toMatch(/timed out/i);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15000);
});

describe('withExtractionTimeout', () => {
  test('passes through a fast result', async () => {
    await expect(withExtractionTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  test('rejects when the deadline passes', async () => {
    await expect(withExtractionTimeout(new Promise(() => {}), 50)).rejects.toThrow(/timed out/i);
  });
});
