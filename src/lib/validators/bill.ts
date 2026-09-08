import { isTaxDate } from '@/lib/tax/date';
import { z } from 'zod';

const billLineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  amount: z.coerce.number().min(0),
  categoryId: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
});

const recoveryDecisionSchema = z.object({
  basisPoints: z.coerce.number().int().min(0).max(10000),
  reason: z.string().min(1).max(500),
  evidence: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, 'Recovery evidence is required'),
  reviewedById: z.string().min(1),
});

const taxLineDecisionSchema = z.object({
  lineIndex: z.coerce.number().int().min(0),
  taxCodeVersionId: z.string().min(1),
  jurisdictionEvidence: z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, 'Jurisdiction evidence is required'),
  jurisdictionOverrideReason: z.string().max(500).optional(),
  recovery: z.record(recoveryDecisionSchema).optional(),
});

const taxDecisionSchema = z.object({
  requestKey: z.string().min(8).max(200),
  lines: z.array(taxLineDecisionSchema).min(1),
});

export const billSchema = z.object({
  kind: z.enum(['bill', 'expense']),
  vendorId: z.string().min(1, 'Vendor is required'),
  billDate: z.string().refine(isTaxDate, 'Enter a valid date (YYYY-MM-DD)'),
  dueDate: z.string().refine(value => value === '' || isTaxDate(value), 'Enter a valid due date').nullable().optional(),
  terms: z.string().max(50).nullable().optional(),
  referenceNo: z.string().max(100).nullable().optional(),
  subtotal: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).nullable().optional(),
  taxAmount: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  currency: z.string().optional(), // set by the server from the vendor — payload is informational
  status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).default('draft'),
  notes: z.string().max(2000).nullable().optional(),
  paymentAccountId: z.string().nullable().optional(),
  // FX — same freeze rules as invoices.
  fxRate: z.coerce.number().positive('Enter a positive rate.').nullable().optional(),
  fxRateConfirmed: z.boolean().optional(),
  // Import GST/HST assessed by CBSA in CAD on its own valuation.
  importTaxAmount: z.coerce.number().min(0).nullable().optional(),
  lineItems: z.array(billLineItemSchema).min(1, 'At least one line item is required'),
  taxDecision: taxDecisionSchema.optional(),
});

export type BillInput = z.infer<typeof billSchema>;
export const billUpdateSchema = billSchema.partial();
