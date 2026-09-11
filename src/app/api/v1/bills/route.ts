import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
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
