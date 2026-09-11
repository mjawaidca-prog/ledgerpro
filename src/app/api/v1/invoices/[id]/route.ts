import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { moneyString, isoDate } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/invoices/[id] — one invoice with its line items, scoped to the
// key's company: an id from another company resolves to 404, never to data.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: context!.companyId },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } }, customer: { select: { id: true, name: true } } },
  });

  if (!invoice) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Invoice not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: invoice.id,
      customer: invoice.customer,
      issueDate: isoDate(invoice.issueDate),
      dueDate: isoDate(invoice.dueDate),
      terms: invoice.terms,
      currency: invoice.currency,
      subtotal: moneyString(invoice.subtotal),
      taxRate: invoice.taxRate === null ? null : moneyString(invoice.taxRate, 3),
      taxAmount: moneyString(invoice.taxAmount),
      total: moneyString(invoice.total),
      fxRate: invoice.fxRate === null ? null : moneyString(invoice.fxRate, 8),
      totalHome: invoice.totalHome === null ? null : moneyString(invoice.totalHome),
      paidAmountHome: moneyString(invoice.paidAmountHome),
      status: invoice.status,
      sentAt: isoDate(invoice.sentAt),
      paidAt: isoDate(invoice.paidAt),
      paidAmount: moneyString(invoice.paidAmount),
      notes: invoice.notes,
      createdAt: isoDate(invoice.createdAt),
      updatedAt: isoDate(invoice.updatedAt),
      lineItems: invoice.lineItems.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: moneyString(l.quantity),
        unitPrice: moneyString(l.unitPrice),
        amount: moneyString(l.amount),
        categoryId: l.categoryId,
        sortOrder: l.sortOrder,
      })),
    },
  });
}
