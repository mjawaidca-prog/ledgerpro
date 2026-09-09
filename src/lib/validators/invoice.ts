import { isTaxDate } from '@/lib/tax/date';
import { z } from 'zod';

const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().min(0.01).default(1),
  unitPrice: z.coerce.number().min(0),
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

export const invoiceSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  issueDate: z.string().refine(isTaxDate, 'Enter a valid date (YYYY-MM-DD)'),
  dueDate: z.string().refine(isTaxDate, 'Enter a valid date (YYYY-MM-DD)'),
  terms: z.string().max(50).nullable().optional(),
  currency: z.string().optional(), // set by the server from the contact — payload is informational
  subtotal: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).nullable().optional(),
  taxAmount: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).default('draft'),
  notes: z.string().max(2000).nullable().optional(),
  paymentAccountId: z.string().nullable().optional(),
  // FX — fxRate is only honoured on foreign-currency invoices; the server
  // re-resolves it unless fxRateConfirmed covers a manual entry.
  fxRate: z.coerce.number().positive('Enter a positive rate.').nullable().optional(),
  fxRateConfirmed: z.boolean().optional(),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
  taxDecision: taxDecisionSchema.optional(),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const invoiceUpdateSchema = invoiceSchema.partial();
