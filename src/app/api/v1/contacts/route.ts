import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
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
