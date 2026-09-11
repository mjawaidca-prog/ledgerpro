import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/payments — payments recorded against invoices or bills. A
// payment is the posted journal entry (sourceType 'payment'); it records a
// payment already made externally and never implies a bank transfer.
//
// Journal entries are append-only posted facts with no updatedAt, so change
// sync uses createdAfter instead of updatedAfter.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor } = pageParamsFrom(searchParams);
  const createdAfterRaw = searchParams.get('createdAfter');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: Prisma.JournalEntryWhereInput = {
    companyId: context!.companyId,
    sourceType: 'payment',
  };
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
    data: result.data.map((p) => ({
      id: p.id,
      entryDate: isoDate(p.entryDate),
      description: p.description,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      voidedAt: isoDate(p.voidedAt),
      createdAt: isoDate(p.createdAt),
      lines: p.lines.map((l) => ({
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
