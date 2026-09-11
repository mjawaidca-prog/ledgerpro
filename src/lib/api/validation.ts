// Public API (v1) write validation. Zod schemas produce FIELD-LEVEL errors —
// the v1 envelope is { error: { code: 'validation_error', message, fields } }.

import { z } from 'zod';
import { NextResponse } from 'next/server';

export const contactCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  type: z.enum(['customer', 'supplier'], { errorMap: () => ({ message: 'Type must be "customer" or "supplier".' }) }),
  companyName: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email('Email must be a valid address.').max(160).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code.').optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const contactUpdateSchema = contactCreateSchema.partial().omit({ type: true });

const draftLineSchema = z.object({
  description: z.string().trim().min(1, 'Description is required.').max(300),
  quantity: z.number().positive('Quantity must be positive.').max(1_000_000).default(1),
  unitPrice: z.number().min(0, 'Unit price cannot be negative.').max(1_000_000_000),
  amount: z.number().min(0, 'Amount cannot be negative.').max(1_000_000_000),
  categoryId: z.string().min(1).optional().nullable(),
});

export const invoiceDraftSchema = z.object({
  customerId: z.string().min(1, 'customerId is required.'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be YYYY-MM-DD.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD.'),
  terms: z.string().trim().max(200).optional().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code.').optional(),
  fxRate: z.number().positive('fxRate must be positive.').max(1_000_000).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lineItems: z.array(draftLineSchema).min(1, 'At least one line item is required.').max(200),
});

export const billDraftSchema = z.object({
  kind: z.enum(['bill', 'expense'], { errorMap: () => ({ message: 'Kind must be "bill" or "expense".' }) }).default('bill'),
  vendorId: z.string().min(1, 'vendorId is required.'),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'billDate must be YYYY-MM-DD.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD.').optional().nullable(),
  terms: z.string().trim().max(200).optional().nullable(),
  referenceNo: z.string().trim().max(100).optional().nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code.').optional(),
  fxRate: z.number().positive('fxRate must be positive.').max(1_000_000).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lineItems: z.array(draftLineSchema).min(1, 'At least one line item is required.').max(200),
});

export const taxDecisionSchema = z.object({
  requestKey: z.string().min(1).max(200),
  lines: z
    .array(
      z.object({
        lineIndex: z.number().int().min(0),
        taxCodeVersionId: z.string().min(1, 'taxCodeVersionId is required.'),
        jurisdictionEvidence: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, {
          message: 'jurisdictionEvidence must be a non-empty object.',
        }),
      })
    )
    .min(1, 'Every document line requires one tax decision.'),
});

export const paymentCreateSchema = z.object({
  documentType: z.enum(['invoice', 'bill'], { errorMap: () => ({ message: 'documentType must be "invoice" or "bill".' }) }),
  documentId: z.string().min(1, 'documentId is required.'),
  amount: z.number().positive('amount must be positive.').max(1_000_000_000),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paymentDate must be YYYY-MM-DD.'),
  paymentAccountId: z.string().min(1, 'paymentAccountId is required.'),
  settlementRate: z.number().positive('settlementRate must be positive.').max(1_000_000).optional(),
});

export const journalCreateSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'entryDate must be YYYY-MM-DD.'),
  description: z.string().trim().min(1, 'description is required.').max(500),
  lines: z
    .array(
      z
        .object({
          glAccountCode: z.string().min(1, 'glAccountCode is required.'),
          description: z.string().trim().max(300).optional().nullable(),
          debit: z.number().min(0, 'debit cannot be negative.').max(1_000_000_000),
          credit: z.number().min(0, 'credit cannot be negative.').max(1_000_000_000),
        })
        .refine((l) => l.debit > 0 || l.credit > 0, { message: 'Each line needs a non-zero debit or credit.' })
    )
    .min(2, 'A journal needs at least two lines.')
    .max(500),
});

/** Maps a ZodError to the v1 field-level error response. */
export function validationErrorResponse(error: z.ZodError): NextResponse {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return NextResponse.json(
    { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields } },
    { status: 400 }
  );
}

/** Parse a YYYY-MM-DD body field into a local-midnight Date (same rule as the dashboard). */
export function parseDateField(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}
