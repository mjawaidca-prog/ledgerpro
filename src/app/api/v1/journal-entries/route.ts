import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/journal-entries — the general journal with GL lines. Filters:
// sourceType, from, to, createdAfter (entries are append-only posted facts
// with no updatedAt). Bounded cursor pagination.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor } = pageParamsFrom(searchParams);
  const sourceType = searchParams.get('sourceType')?.trim() || null;
  const createdAfterRaw = searchParams.get('createdAfter');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: Prisma.JournalEntryWhereInput = { companyId: context!.companyId };
  if (sourceType) where.sourceType = sourceType as Prisma.JournalEntryWhereInput['sourceType'];
  if (createdAfterRaw && !Number.isNaN(new Date(createdAfterRaw).getTime())) {
    where.createdAt = { gte: new Date(createdAfterRaw) };
  }
  if (from || to) {
    where.entryDate = {};
    if (from && !Number.isNaN(new Date(from).getTime())) where.entryDate.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) where.entryDate.lte = new Date(to);
  }

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        include: { lines: true },
      }),
  });

  return NextResponse.json({
    data: result.data.map((e) => ({
      id: e.id,
      entryDate: isoDate(e.entryDate),
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      voidedAt: isoDate(e.voidedAt),
      reversalOfId: e.reversalOfId,
      createdAt: isoDate(e.createdAt),
      lines: e.lines.map((l) => ({
        id: l.id,
        glAccountCode: l.glAccountCode,
        description: l.description,
        debit: moneyString(l.debit),
        credit: moneyString(l.credit),
        currency: l.currency,
        fxRate: l.fxRate === null ? null : moneyString(l.fxRate, 8),
        debitForeign: l.debitForeign === null ? null : moneyString(l.debitForeign),
        creditForeign: l.creditForeign === null ? null : moneyString(l.creditForeign),
      })),
    })),
    pagination: result.pagination,
  });
}
