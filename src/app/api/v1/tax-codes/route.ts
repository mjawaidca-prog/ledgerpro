import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/tax-codes — active tax codes with their APPROVED versions and
// component rates. Draft and retired versions are omitted; effective dates
// travel with each version so consumers can resolve the rate for any date.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.taxCode.findMany({
        where: { companyId: context!.companyId, active: true, ...updatedAtFilter(updatedAfter) },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        include: {
          versions: {
            where: { reviewStatus: 'approved' },
            orderBy: { version: 'asc' },
            include: { components: true },
          },
        },
      }),
  });

  return NextResponse.json({
    data: result.data.map((tc) => ({
      id: tc.id,
      code: tc.code,
      name: tc.name,
      active: tc.active,
      updatedAt: isoDate(tc.updatedAt),
      versions: tc.versions.map((v) => ({
        version: v.version,
        treatment: v.treatment,
        jurisdiction: v.jurisdiction,
        priceMode: v.priceMode,
        effectiveFrom: isoDate(v.effectiveFrom),
        effectiveTo: isoDate(v.effectiveTo),
        sourceReference: v.sourceReference,
        components: v.components.map((c) => ({
          type: c.type,
          authority: c.authority,
          treatment: c.treatment,
          rate: moneyString(c.rate, 3),
          recoveryAllowed: c.recoveryAllowed,
        })),
      })),
    })),
    pagination: result.pagination,
  });
}
