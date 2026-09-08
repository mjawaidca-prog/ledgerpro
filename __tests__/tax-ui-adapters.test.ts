import { assertReviewedBankTaxAdapter } from '@/lib/tax/bank-adapter';
import { invoiceSchema } from '@/lib/validators/invoice';
import { billSchema } from '@/lib/validators/bill';

const decision = {
  requestKey: 'tax-request-1234',
  lines: [{
    lineIndex: 0,
    taxCodeVersionId: 'tax-version-1',
    jurisdictionEvidence: { reference: 'Ship-to address in Ontario' },
  }],
};

describe('P1-D tax UI and import adapters', () => {
  test('keeps legacy bank posting unchanged while reviewed tax is disabled', () => {
    expect(() => assertReviewedBankTaxAdapter({
      reviewedTaxEnabled: false,
      row: {},
      splits: [{ taxCode: 'HST', taxRate: 13 }],
    })).not.toThrow();
  });

  test('allows untaxed imported rows but blocks lossy legacy tax for opted-in companies', () => {
    expect(() => assertReviewedBankTaxAdapter({ reviewedTaxEnabled: true, row: {}, splits: [{ taxCode: null, taxRate: null }] })).not.toThrow();
    expect(() => assertReviewedBankTaxAdapter({ reviewedTaxEnabled: true, row: {}, splits: [{ taxCode: 'GST', taxRate: 5 }] }))
      .toThrow(/reviewed Canadian tax/i);
  });

  test('accepts line-indexed invoice decisions with jurisdiction evidence', () => {
    const parsed = invoiceSchema.safeParse({
      customerId: 'customer-1', issueDate: '2026-09-08', dueDate: '2026-10-08',
      subtotal: 100, taxAmount: 13, total: 113, status: 'sent', taxDecision: decision,
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 100, amount: 100, categoryId: 'revenue-1', sortOrder: 0 }],
    });
    expect(parsed.success).toBe(true);
  });

  test('requires purchase recovery evidence to be non-empty', () => {
    const parsed = billSchema.safeParse({
      kind: 'bill', vendorId: 'vendor-1', billDate: '2026-09-08', subtotal: 100, taxAmount: 5, total: 105, status: 'open',
      taxDecision: { ...decision, lines: [{ ...decision.lines[0], recovery: { GST: { basisPoints: 10000, reason: 'Commercial activity', evidence: {}, reviewedById: 'owner-1' } } }] },
      lineItems: [{ description: 'Supplies', amount: 100, categoryId: 'expense-1', sortOrder: 0 }],
    });
    expect(parsed.success).toBe(false);
  });
});
