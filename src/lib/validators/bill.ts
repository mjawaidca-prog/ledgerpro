import { z } from 'zod';

const billLineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  amount: z.coerce.number().min(0),
  categoryId: z.string().nullable().optional(),
  sortOrder: z.coerce.number().int().default(0),
});

export const billSchema = z.object({
  kind: z.enum(['bill', 'expense']),
  vendorId: z.string().min(1, 'Vendor is required'),
  billDate: z.string().min(1, 'Bill date is required'),
  dueDate: z.string().nullable().optional(),
  terms: z.string().max(50).nullable().optional(),
  referenceNo: z.string().max(100).nullable().optional(),
  subtotal: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).nullable().optional(),
  taxAmount: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0),
  currency: z.string().default('USD'),
  status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).default('draft'),
  notes: z.string().max(2000).nullable().optional(),
  paymentAccountId: z.string().nullable().optional(),
  lineItems: z.array(billLineItemSchema).min(1, 'At least one line item is required'),
});

export type BillInput = z.infer<typeof billSchema>;
export const billUpdateSchema = billSchema.partial();
