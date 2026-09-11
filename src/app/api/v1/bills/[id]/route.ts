import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { moneyString, isoDate } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/bills/[id] — one bill with its line items, scoped to the key's
// company (foreign ids resolve to 404).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const bill = await db.bill.findFirst({
    where: { id: params.id, companyId: context!.companyId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } }, vendor: { select: { id: true, name: true } } },
  });

  if (!bill) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Bill not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: bill.id,
      kind: bill.kind,
      vendor: bill.vendor,
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
      lineItems: bill.lineItems.map((l) => ({
        id: l.id,
        description: l.description,
        amount: moneyString(l.amount),
        categoryId: l.categoryId,
        sortOrder: l.sortOrder,
      })),
    },
  });
}
