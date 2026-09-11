import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { billDraftSchema, validationErrorResponse, parseDateField } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { auditLog } from '@/lib/api-helpers';
import { emitWebhookEvent } from '@/lib/webhooks';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

function serializeBill(bill: any) {
  return {
    id: bill.id,
    kind: bill.kind,
    vendorId: bill.vendorId,
    billDate: isoDate(bill.billDate),
    dueDate: isoDate(bill.dueDate),
    terms: bill.terms,
    referenceNo: bill.referenceNo,
    subtotal: moneyString(bill.subtotal),
    taxRate: bill.taxRate === null ? null : moneyString(bill.taxRate, 3),
    taxAmount: moneyString(bill.taxAmount),
    total: moneyString(bill.total),
    currency: bill.currency,
    fxRate: bill.fxRate === null ? null : moneyString(bill.fxRate, 8),
    totalHome: bill.totalHome === null ? null : moneyString(bill.totalHome),
    paidAmountHome: moneyString(bill.paidAmountHome),
    importTaxAmount: bill.importTaxAmount === null ? null : moneyString(bill.importTaxAmount),
    status: bill.status,
    paidAt: isoDate(bill.paidAt),
    paidAmount: moneyString(bill.paidAmount),
    notes: bill.notes,
    createdAt: isoDate(bill.createdAt),
    updatedAt: isoDate(bill.updatedAt),
    lineItems: (bill.lineItems ?? []).map((l: any) => ({
      id: l.id,
      description: l.description,
      amount: moneyString(l.amount),
      categoryId: l.categoryId,
      sortOrder: l.sortOrder,
    })),
  };
}

// GET /api/v1/bills — filters: kind (bill|expense), status, vendorId,
// billFrom, billTo, updatedAfter; bounded cursor pagination. Voided bills are
// included with status 'void' for change-sync.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);
  const kind = searchParams.get('kind')?.trim() || null;
  const status = searchParams.get('status')?.trim() || null;
  const vendorId = searchParams.get('vendorId')?.trim() || null;
  const billFrom = searchParams.get('billFrom');
  const billTo = searchParams.get('billTo');

  const where: Prisma.BillWhereInput = {
    companyId: context!.companyId,
    ...updatedAtFilter(updatedAfter),
  };
  if (kind === 'bill' || kind === 'expense') where.kind = kind;
  if (status) where.status = status as Prisma.BillWhereInput['status'];
  if (vendorId) where.vendorId = vendorId;
  if (billFrom || billTo) {
    where.billDate = {};
    if (billFrom && !Number.isNaN(new Date(billFrom).getTime())) where.billDate.gte = new Date(billFrom);
    if (billTo && !Number.isNaN(new Date(billTo).getTime())) where.billDate.lte = new Date(billTo);
  }

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.bill.findMany({
        where,
        orderBy: [{ billDate: 'desc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      }),
  });

  return NextResponse.json({ data: result.data.map(serializeBill), pagination: result.pagination });
}

// POST /api/v1/bills — create a DRAFT bill (write_draft). Reviewed tax is
// applied at POST /bills/[id]/post. Idempotency-Key required.
export async function POST(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_draft' });
  if (error) return error;

  const parsed = billDraftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

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
  const vendor = await db.contact.findFirst({
    where: { id: parsed.data.vendorId, companyId: context!.companyId, type: 'supplier' },
    select: { id: true, currency: true },
  });
  if (!vendor) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { vendorId: 'vendorId must be an existing supplier of this company.' } } },
      { status: 400 }
    );
  }
  if (currency !== vendor.currency && parsed.data.currency) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { currency: `Currency must match the vendor's currency (${vendor.currency}).` } } },
      { status: 400 }
    );
  }

  const billDate = parseDateField(parsed.data.billDate);
  const dueDate = parsed.data.dueDate ? parseDateField(parsed.data.dueDate) : null;
  if (dueDate && dueDate < billDate) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { dueDate: 'dueDate cannot be before billDate.' } } },
      { status: 400 }
    );
  }

  // Foreign-currency documents freeze their FX rate at creation.
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
    const subtotal = Math.round(parsed.data.lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100;

    const bill = await tx.bill.create({
      data: {
        id: `BILL-${randomUUID()}`,
        companyId: context!.companyId,
        kind: parsed.data.kind ?? 'bill',
        vendorId: parsed.data.vendorId,
        billDate,
        dueDate,
        terms: parsed.data.terms ?? null,
        referenceNo: parsed.data.referenceNo ?? null,
        subtotal,
        taxRate: 0,
        taxAmount: 0,
        total: subtotal,
        currency,
        fxRate: parsed.data.fxRate ?? null,
        fxRateSource: parsed.data.fxRate ? 'manual' : null,
        status: 'draft',
        notes: parsed.data.notes ?? null,
        lineItems: {
          create: parsed.data.lineItems.map((line, index) => ({
            description: line.description,
            amount: line.amount,
            categoryId: line.categoryId ?? null,
            sortOrder: index,
          })),
        },
      },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });

    return {
      resourceType: 'bill',
      resourceId: bill.id,
      statusCode: 201,
      body: { data: serializeBill(bill) },
    };
  });

  await auditLog(context!.companyId, undefined, 'api.bill.create', 'bill', (outcome.body as any)?.data?.id ?? null, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
    status: 'draft',
  });

  await emitWebhookEvent({
    companyId: context!.companyId,
    eventType: 'bill.created',
    payload: {
      id: (outcome.body as any)?.data?.id,
      status: 'draft',
      occurredAt: new Date().toISOString(),
    },
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
