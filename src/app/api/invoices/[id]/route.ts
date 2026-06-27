import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { invoiceUpdateSchema } from '@/lib/validators/invoice';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const invoice = await db.invoice.findUnique({
      where: { id: params.id, companyId },
      include: {
        customer: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
        paymentAccount: { select: { id: true, name: true, mask: true, kind: true } },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    return NextResponse.json({ data: invoice });
  } catch (error) {
    console.error('GET /api/invoices/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const parsed = invoiceUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.invoice.findUnique({ where: { id: params.id, companyId } });
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { lineItems, ...invoiceData } = parsed.data;

    // Update invoice header
    await db.invoice.update({
      where: { id: params.id, companyId },
      data: {
        ...invoiceData,
        issueDate: invoiceData.issueDate ? new Date(invoiceData.issueDate) : undefined,
        dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : undefined,
      },
    });

    // Replace line items if provided
    if (lineItems) {
      await db.invoiceLineItem.deleteMany({ where: { invoiceId: params.id } });
      await db.invoiceLineItem.createMany({
        data: lineItems.map((item, idx) => ({
          invoiceId: params.id,
          description: item.description!,
          quantity: item.quantity ?? 1,
          unitPrice: item.unitPrice ?? 0,
          amount: item.amount ?? 0,
          categoryId: item.categoryId ?? null,
          sortOrder: idx,
        })),
      });
    }

    const updated = await db.invoice.findUnique({
      where: { id: params.id, companyId },
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/invoices/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.invoice.findUnique({ where: { id: params.id, companyId } });
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (existing.status === 'paid') {
      return NextResponse.json(
        { error: 'Cannot delete a paid invoice. Void it instead.' },
        { status: 400 }
      );
    }

    await db.invoiceLineItem.deleteMany({ where: { invoiceId: params.id } });
    await db.invoice.delete({ where: { id: params.id } });

    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/invoices/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
