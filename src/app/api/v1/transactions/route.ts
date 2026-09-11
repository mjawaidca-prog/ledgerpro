import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/transactions — bank and card transactions. Filters:
// financialAccountId, status, from, to, updatedAfter; bounded cursor
// pagination. Voided rows are included with their status for change-sync.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor, updatedAfter } = pageParamsFrom(searchParams);
  const accountId = searchParams.get('financialAccountId')?.trim() || null;
  const status = searchParams.get('status')?.trim() || null;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: Prisma.TransactionWhereInput = {
    companyId: context!.companyId,
    ...updatedAtFilter(updatedAfter),
  };
  if (accountId) where.financialAccountId = accountId;
  if (status) where.status = status as Prisma.TransactionWhereInput['status'];
  if (from || to) {
    where.date = {};
    if (from && !Number.isNaN(new Date(from).getTime())) where.date.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) where.date.lte = new Date(to);
  }

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
      }),
  });

  return NextResponse.json({
    data: result.data.map((t) => ({
      id: t.id,
      financialAccountId: t.financialAccountId,
      date: isoDate(t.date),
      description: t.description,
      merchant: t.merchant,
      amount: moneyString(t.amount),
      currency: t.currency,
      fxRate: t.fxRate === null ? null : moneyString(t.fxRate, 8),
      amountHome: t.amountHome === null ? null : moneyString(t.amountHome),
      status: t.status,
      contactId: t.contactId,
      categoryId: t.categoryId,
      taxCode: t.taxCode,
      taxRate: t.taxRate === null ? null : moneyString(t.taxRate, 3),
      taxAmount: moneyString(t.taxAmount),
      memo: t.memo,
      reference: t.reference,
      reconciled: t.reconciledInId !== null,
      reconciledAt: isoDate(t.reconciledAt),
      voidedAt: isoDate(t.voidedAt),
      createdAt: isoDate(t.createdAt),
      updatedAt: isoDate(t.updatedAt),
    })),
    pagination: result.pagination,
  });
}
