import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { contactCreateSchema, validationErrorResponse } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { auditLog } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/contacts — customers and vendors. Filters: type
// (customer|supplier), status (active|inactive), updatedAfter; bounded
// cursor pagination.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);
  const type = searchParams.get('type')?.trim() || null;
  const status = searchParams.get('status')?.trim() || null;

  const where: Prisma.ContactWhereInput = {
    companyId: context!.companyId,
    ...updatedAtFilter(updatedAfter),
  };
  if (type === 'customer' || type === 'supplier') where.type = type;
  if (status === 'active' || status === 'inactive') where.status = status;

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.contact.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        select: {
          id: true, name: true, companyName: true, type: true, email: true, phone: true,
          address: true, currency: true, outstandingBalance: true, status: true, notes: true,
          createdAt: true, updatedAt: true,
        },
      }),
  });

  return NextResponse.json({
    data: result.data.map((c) => ({
      id: c.id,
      name: c.name,
      companyName: c.companyName,
      type: c.type,
      email: c.email,
      phone: c.phone,
      address: c.address,
      currency: c.currency,
      outstandingBalance: moneyString(c.outstandingBalance),
      status: c.status,
      notes: c.notes,
      createdAt: isoDate(c.createdAt),
      updatedAt: isoDate(c.updatedAt),
    })),
    pagination: result.pagination,
  });
}

// POST /api/v1/contacts — create a customer or vendor (write_draft).
// Idempotency-Key required; field-level errors on invalid input.
export async function POST(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_draft' });
  if (error) return error;

  const parsed = contactCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const company = await db.company.findUniqueOrThrow({
    where: { id: context!.companyId },
    select: { currency: true, enabledCurrencies: true },
  });
  const currency = parsed.data.currency ?? company.currency;
  if (!company.enabledCurrencies.includes(currency)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'One or more fields failed validation.',
          fields: { currency: `Currency ${currency} is not enabled for this company.` },
        },
      },
      { status: 400 }
    );
  }

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  const outcome = await withIdempotency(idem.context, async (tx) => {
    const contact = await tx.contact.create({
      data: {
        companyId: context!.companyId,
        name: parsed.data.name,
        companyName: parsed.data.companyName ?? null,
        type: parsed.data.type,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        currency,
        notes: parsed.data.notes ?? null,
      },
    });
    return {
      resourceType: 'contact',
      resourceId: contact.id,
      statusCode: 201,
      body: { data: { id: contact.id, name: contact.name, type: contact.type, currency } },
    };
  });

  await auditLog(context!.companyId, undefined, 'api.contact.create', 'contact', (outcome.body as any)?.data?.id ?? null, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
