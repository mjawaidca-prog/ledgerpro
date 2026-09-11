import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor, updatedAtFilter } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
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
