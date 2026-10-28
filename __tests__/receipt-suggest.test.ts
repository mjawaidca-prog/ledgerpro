/**
 * Receipt suggestions + upload validation.
 *
 * Category suggestions must come from the company's OWN rules via the
 * shared engines (categorization rules, then bank rules) — the same
 * matchers import and manual apply use. The DB and Prisma client are
 * stubbed exactly as in categorization-autoapply-import.test.ts, because
 * the matcher module imports them.
 */
class DecimalStub {
  v: number;
  constructor(value: unknown) {
    this.v = value instanceof DecimalStub ? value.v : Number(value as never);
  }
  toNumber() {
    return this.v;
  }
  valueOf() {
    return this.v;
  }
  toString() {
    return String(this.v);
  }
}

jest.mock('@prisma/client', () => ({ Prisma: { Decimal: DecimalStub } }));
jest.mock('@/lib/db', () => ({ db: {} }));

import { suggestForReceipt, buildReceiptSplit } from '@/lib/receipts/suggest';
import { validateReceiptUpload, RECEIPT_MAX_BYTES } from '@/lib/receipts/validate';
import type { CategorizationRuleRecord } from '@/lib/banking/categorization-apply';
import type { BankRuleLike } from '@/lib/banking/rules';

const catRule = (over: Record<string, unknown>): CategorizationRuleRecord =>
  ({
    id: 'cr-1',
    name: 'Rule',
    pattern: '',
    patternType: 'description_contains',
    minAmount: null,
    maxAmount: null,
    categoryId: 'coa-6100',
    category: { code: '6100' },
    taxEnabled: false,
    taxProvince: null,
    taxInclusive: true,
    taxRecoverable: true,
    taxRecoveryPercent: null,
    priority: 0,
    ...over,
  }) as unknown as CategorizationRuleRecord;

const bankRule = (over: Partial<BankRuleLike>): BankRuleLike => ({
  id: 'br-1',
  name: 'Bank rule',
  order: 0,
  op: 'contains',
  value: '',
  anyOf: [],
  scope: { accountIds: 'all', direction: 'both' },
  setCategoryCode: null,
  setTaxCode: null,
  setTaxRate: null,
  setTaxInclusive: true,
  setContactId: null,
  autoPost: false,
  enabled: true,
  ...over,
});

describe('suggestForReceipt', () => {
  test('a categorization rule wins and carries its category id + code', () => {
    const hit = suggestForReceipt({
      merchant: 'SAFEWAY #4912',
      total: 6.81,
      province: 'AB',
      receiptTaxAmount: 0.32,
      categorizationRules: [catRule({ pattern: 'SAFEWAY', name: 'Groceries' })],
      bankRules: [],
    });
    expect(hit.source).toBe('categorization_rule');
    expect(hit.categoryId).toBe('coa-6100');
    expect(hit.categoryCode).toBe('6100');
    expect(hit.ruleName).toBe('Groceries');
    expect(hit.taxProvince).toBe('AB');
    expect(hit.provinceRatePct).toBe(5);
    // The receipt's printed tax wins over any estimate.
    expect(hit.estimatedTaxAmount).toBe(0.32);
  });

  test('falls back to a bank rule (category code only) when no categorization rule matches', () => {
    const s = suggestForReceipt({
      merchant: 'STAPLES STORE 88',
      total: 210,
      province: 'ON',
      receiptTaxAmount: null,
      categorizationRules: [],
      bankRules: [bankRule({ value: 'STAPLES', setCategoryCode: '6200', name: 'Office supplies' })],
    });
    expect(s.source).toBe('bank_rule');
    expect(s.categoryCode).toBe('6200');
    expect(s.categoryId).toBeNull();
    expect(s.ruleName).toBe('Office supplies');
    // Inclusive back-out at Ontario's 13% HST when the receipt tax is unknown.
    expect(s.estimatedTaxAmount).toBe(24.16);
  });

  test('no merchant means no category suggestion, tax still estimable', () => {
    const s = suggestForReceipt({
      merchant: null,
      total: 105,
      province: 'AB',
      receiptTaxAmount: null,
      categorizationRules: [catRule({ pattern: 'ANYTHING' })],
      bankRules: [bankRule({ value: 'ANYTHING', setCategoryCode: '6200' })],
    });
    expect(s.source).toBeNull();
    expect(s.categoryCode).toBeNull();
    expect(s.estimatedTaxAmount).toBe(5);
  });

  test('an unknown province yields no tax province and no estimate', () => {
    const s = suggestForReceipt({
      merchant: 'X',
      total: 100,
      province: null,
      receiptTaxAmount: null,
      categorizationRules: [],
      bankRules: [],
    });
    expect(s.taxProvince).toBeNull();
    expect(s.provinceRatePct).toBeNull();
    expect(s.estimatedTaxAmount).toBeNull();
  });
});

describe('buildReceiptSplit', () => {
  test('mirrors a rule tax stamp: province split, inclusive, recoverable', () => {
    const split = buildReceiptSplit({ categoryCode: '6100', amount: -105, taxProvince: 'AB' });
    expect(split).toEqual({
      categoryCode: '6100',
      amount: 105,
      taxCode: 'Tax — AB',
      taxRate: null,
      taxInclusive: true,
      taxProvince: 'AB',
      taxRecoverable: true,
    });
  });

  test('without a province the split carries no tax treatment', () => {
    const split = buildReceiptSplit({ categoryCode: '6100', amount: 50, taxProvince: null });
    expect(split.taxProvince).toBeUndefined();
    expect(split.taxCode).toBeNull();
    expect(split.amount).toBe(50);
  });
});

describe('validateReceiptUpload', () => {
  test('accepts a normal JPEG and a PDF', () => {
    expect(validateReceiptUpload({ mimeType: 'image/jpeg', sizeBytes: 250_000 }).ok).toBe(true);
    expect(validateReceiptUpload({ mimeType: 'application/pdf', sizeBytes: 250_000 }).ok).toBe(true);
  });
  test('rejects empty and oversize files', () => {
    expect(validateReceiptUpload({ mimeType: 'image/png', sizeBytes: 0 }).ok).toBe(false);
    const big = validateReceiptUpload({ mimeType: 'image/png', sizeBytes: RECEIPT_MAX_BYTES + 1 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error).toMatch(/5 MB/);
  });
  test('HEIC gets the iPhone-specific explanation', () => {
    const v = validateReceiptUpload({ mimeType: 'image/heic', sizeBytes: 1000 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/Most Compatible/);
  });
  test('rejects unsupported types', () => {
    expect(validateReceiptUpload({ mimeType: 'text/csv', sizeBytes: 1000 }).ok).toBe(false);
  });
});
