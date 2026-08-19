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

export const invoiceSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  issueDate: z.string().min(1, 'Issue date is required'),
  dueDate: z.string().min(1, 'Due date is required'),
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
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const invoiceUpdateSchema = invoiceSchema.partial();
