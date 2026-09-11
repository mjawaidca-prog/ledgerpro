import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { invoiceDraftSchema, validationErrorResponse, parseDateField } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { auditLog } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

function serializeInvoice(inv: any) {
  return {
    id: inv.id,
    customerId: inv.customerId,
    issueDate: isoDate(inv.issueDate),
    dueDate: isoDate(inv.dueDate),
    terms: inv.terms,
    currency: inv.currency,
    subtotal: moneyString(inv.subtotal),
    taxRate: inv.taxRate === null ? null : moneyString(inv.taxRate, 3),
    taxAmount: moneyString(inv.taxAmount),
    total: moneyString(inv.total),
    fxRate: inv.fxRate === null ? null : moneyString(inv.fxRate, 8),
    totalHome: inv.totalHome === null ? null : moneyString(inv.totalHome),
    paidAmountHome: moneyString(inv.paidAmountHome),
    status: inv.status,
    sentAt: isoDate(inv.sentAt),
    paidAt: isoDate(inv.paidAt),
    paidAmount: moneyString(inv.paidAmount),
    notes: inv.notes,
    createdAt: isoDate(inv.createdAt),
    updatedAt: isoDate(inv.updatedAt),
    lineItems: (inv.lineItems ?? []).map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: moneyString(l.quantity),
      unitPrice: moneyString(l.unitPrice),
      amount: moneyString(l.amount),
      categoryId: l.categoryId,
      sortOrder: l.sortOrder,
    })),
  };
}

// GET /api/v1/invoices — filters: status, customerId, issueFrom, issueTo,
// updatedAfter; bounded cursor pagination. Voided invoices are included with
// status 'void' so synchronizing clients can mirror them.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);
  const status = searchParams.get('status')?.trim() || null;
  const customerId = searchParams.get('customerId')?.trim() || null;
  const issueFrom = searchParams.get('issueFrom');
  const issueTo = searchParams.get('issueTo');

  const where: Prisma.InvoiceWhereInput = {
    companyId: context!.companyId,
    ...updatedAtFilter(updatedAfter),
  };
  if (status) where.status = status as Prisma.InvoiceWhereInput['status'];
  if (customerId) where.customerId = customerId;
  if (issueFrom || issueTo) {
    where.issueDate = {};
    if (issueFrom && !Number.isNaN(new Date(issueFrom).getTime())) where.issueDate.gte = new Date(issueFrom);
    if (issueTo && !Number.isNaN(new Date(issueTo).getTime())) where.issueDate.lte = new Date(issueTo);
  }

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.invoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      }),
  });

  return NextResponse.json({ data: result.data.map(serializeInvoice), pagination: result.pagination });
}

// POST /api/v1/invoices — create a DRAFT invoice (write_draft).
// Tax decisions are NOT part of draft creation — reviewed tax is applied at
// POST /invoices/[id]/post, exactly like the dashboard's reviewed workflow.
// Idempotency-Key required.
export async function POST(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_draft' });
  if (error) return error;

  const parsed = invoiceDraftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // Cross-record validation happens before the transaction: the customer must
  // belong to this company and be a customer, and the currency must be enabled.
  const company = await db.company.findUniqueOrThrow({
    where: { id: context!.companyId },
    select: { currency: true, enabledCurrencies: true },
  });
  const currency = parsed.data.currency ?? company.currency;
  if (!company.enabledCurrencies.includes(currency)) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { currency: `Currency ${currency} is not enabled for this company.` } } },
      { status: 400 }
    );
  }
  const customer = await db.contact.findFirst({
    where: { id: parsed.data.customerId, companyId: context!.companyId, type: 'customer' },
    select: { id: true, currency: true },
  });
  if (!customer) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { customerId: 'customerId must be an existing customer of this company.' } } },
      { status: 400 }
    );
  }
  if (currency !== customer.currency && parsed.data.currency) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { currency: `Currency must match the customer's currency (${customer.currency}).` } } },
      { status: 400 }
    );
  }

  const issueDate = parseDateField(parsed.data.issueDate);
  const dueDate = parseDateField(parsed.data.dueDate);
  if (dueDate && dueDate < issueDate) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { dueDate: 'dueDate cannot be before issueDate.' } } },
      { status: 400 }
    );
  }

  // Foreign-currency documents freeze their FX rate at creation — the same
  // rule the dashboard applies; the rate is never recomputed later.
  const isForeign = currency !== company.currency;
  if (isForeign && !parsed.data.fxRate) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { fxRate: `fxRate is required for foreign-currency documents (${currency} vs home ${company.currency}).` } } },
      { status: 400 }
    );
  }

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  const outcome = await withIdempotency(idem.context, async (tx) => {
    // Totals are computed server-side, never from the browser/API caller.
    const subtotal = Math.round(parsed.data.lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    const invoice = await tx.invoice.create({
      data: {
        id: `INV-${randomUUID()}`,
        companyId: context!.companyId,
        customerId: parsed.data.customerId,
        issueDate,
        dueDate,
        terms: parsed.data.terms ?? null,
        currency,
        fxRate: parsed.data.fxRate ?? null,
        fxRateSource: parsed.data.fxRate ? 'manual' : null,
        subtotal,
        taxRate: 0,
        taxAmount: 0,
        total: subtotal,
        status: 'draft',
        notes: parsed.data.notes ?? null,
        lineItems: {
          create: parsed.data.lineItems.map((line, index) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
            categoryId: line.categoryId ?? null,
            sortOrder: index,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    return {
      resourceType: 'invoice',
      resourceId: invoice.id,
      statusCode: 201,
      body: { data: serializeInvoice(invoice) },
    };
  });

  await auditLog(context!.companyId, undefined, 'api.invoice.create', 'invoice', (outcome.body as any)?.data?.id ?? null, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
    status: 'draft',
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
