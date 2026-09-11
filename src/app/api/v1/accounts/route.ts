import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/accounts — chart of accounts. Filters: type (GL type),
// active=1|0, updatedAfter; bounded cursor pagination.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);
  const type = searchParams.get('type')?.trim() || null;
  const active = searchParams.get('active');

  const where: Prisma.ChartOfAccountWhereInput = {
    companyId: context!.companyId,
    ...updatedAtFilter(updatedAfter),
  };
  if (type) where.type = type as Prisma.ChartOfAccountWhereInput['type'];
  if (active === '1') where.active = true;
  if (active === '0') where.active = false;

  const [company, result] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: context!.companyId },
      select: { currency: true },
    }),
    cursorPage({
      limit,
      cursor,
      fetch: (take) =>
        db.chartOfAccount.findMany({
          where,
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
          take,
          cursor: prismaCursor(cursor),
          select: {
            id: true, code: true, name: true, type: true, subType: true, gifiCode: true,
            parentCode: true, balance: true, active: true, createdAt: true, updatedAt: true,
          },
        }),
    }),
  ]);

  return NextResponse.json({
    data: result.data.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      gifiCode: a.gifiCode,
      parentCode: a.parentCode,
      balance: moneyString(a.balance),
      currency: company.currency, // chart balances are denominated in the company currency
      active: a.active,
      createdAt: isoDate(a.createdAt),
      updatedAt: isoDate(a.updatedAt),
    })),
    pagination: result.pagination,
  });
}
