/**
 * Receipt OCR-text parser — pure extraction of merchant / date / subtotal /
 * tax / total from Canadian receipt text. These samples mirror what
 * pdf-parse and tesseract.js actually emit (plain lines, $ amounts).
 */
import { parseReceiptText, parseReceiptDate } from '@/lib/receipts/parse';

describe('parseReceiptText', () => {
  test('Alberta grocery receipt: GST line, MM/DD/YYYY date', () => {
    const parsed = parseReceiptText(
      [
        'SAFEWAY #4912',
        '123 MAIN ST CALGARY AB',
        '10/27/2026 14:32',
        'MILK 3.99',
        'BREAD 2.50',
        'SUBTOTAL 6.49',
        'GST 0.32',
        'TOTAL $6.81',
        'VISA ****1234',
      ].join('\n'),
    );
    expect(parsed.merchant).toBe('SAFEWAY #4912');
    expect(parsed.date).toBe('2026-10-27');
    expect(parsed.subtotal).toBe(6.49);
    expect(parsed.taxAmount).toBe(0.32);
    expect(parsed.gstHstAmount).toBe(0.32);
    expect(parsed.total).toBe(6.81);
    expect(parsed.confidence).toBe(1);
  });

  test('BC receipt: GST + PST lines sum, GST/HST portion separated', () => {
    const parsed = parseReceiptText(
      [
        'PETRO-CANADA',
        'VANCOUVER BC',
        '2026-09-14',
        'REGULAR FUEL 62.50',
        'SUBTOTAL $62.50',
        'GST 3.13',
        'PST 4.38',
        'TOTAL $70.01',
      ].join('\n'),
    );
    expect(parsed.merchant).toBe('PETRO-CANADA');
    expect(parsed.date).toBe('2026-09-14');
    expect(parsed.taxAmount).toBe(7.51);
    expect(parsed.gstHstAmount).toBe(3.13);
    expect(parsed.total).toBe(70.01);
  });

  test('restaurant receipt: TOTAL DUE and tax derived from subtotal', () => {
    const parsed = parseReceiptText(
      [
        'THE KEG STEAKHOUSE',
        'OCT 5, 2026',
        'STEAK 45.00',
        'WINE 18.00',
        'SUBTOTAL 63.00',
        'TOTAL DUE 66.15',
      ].join('\n'),
    );
    expect(parsed.merchant).toBe('THE KEG STEAKHOUSE');
    expect(parsed.date).toBe('2026-10-05');
    expect(parsed.taxAmount).toBe(3.15);
    expect(parsed.gstHstAmount).toBeNull();
    expect(parsed.total).toBe(66.15);
  });

  test('a GST registration number line is not mistaken for tax', () => {
    const parsed = parseReceiptText(
      ['COFFEE SHOP', 'OCT 27 2026', 'LATTE 5.25', 'GST/HST # 123456789 RT0001', 'TOTAL 5.51'].join('\n'),
    );
    expect(parsed.total).toBe(5.51);
    expect(parsed.taxAmount).toBeNull();
    expect(parsed.gstHstAmount).toBeNull();
  });

  test('TOTAL ITEMS is not a total; the footer TOTAL wins', () => {
    const parsed = parseReceiptText(['CORNER STORE', 'TOTAL ITEMS 3', 'TOTAL $25.00'].join('\n'));
    expect(parsed.total).toBe(25);
  });

  test('no TOTAL line: falls back to the largest amount, low confidence without tax', () => {
    const parsed = parseReceiptText(['COFFEE SHOP', 'OCT 27 2026', 'LATTE 5.25', 'MUffIN 3.75'].join('\n'));
    expect(parsed.total).toBe(5.25);
    expect(parsed.taxAmount).toBeNull();
    expect(parsed.confidence).toBe(0.85);
  });

  test('empty text parses to an all-null, zero-confidence suggestion', () => {
    const parsed = parseReceiptText('');
    expect(parsed.merchant).toBeNull();
    expect(parsed.date).toBeNull();
    expect(parsed.total).toBeNull();
    expect(parsed.confidence).toBe(0);
  });
});

describe('parseReceiptDate', () => {
  test('DD/MM flips when the first component cannot be a month', () => {
    expect(parseReceiptDate('27/10/2026')).toBe('2026-10-27');
  });
  test('two-digit years are accepted', () => {
    expect(parseReceiptDate('10/27/26')).toBe('2026-10-27');
  });
  test('impossible dates are rejected', () => {
    expect(parseReceiptDate('2026-02-30')).toBeNull();
  });
});
