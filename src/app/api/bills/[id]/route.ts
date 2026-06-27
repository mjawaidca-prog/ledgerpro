import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { billUpdateSchema } from '@/lib/validators/bill';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const bill = await db.bill.findUnique({
      where: { id: params.id, companyId },
      include: {
        vendor: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
        paymentAccount: { select: { id: true, name: true, mask: true, kind: true } },
      },
    });

    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    return NextResponse.json({ data: bill });
  } catch (error) {
    console.error('GET /api/bills/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch bill' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const parsed = billUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.bill.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const { lineItems, ...billData } = parsed.data;

    await db.bill.update({
      where: { id: params.id, companyId },
      data: {
        ...billData,
        billDate: billData.billDate ? new Date(billData.billDate) : undefined,
        dueDate: billData.dueDate !== undefined ? (billData.dueDate ? new Date(billData.dueDate) : null) : undefined,
      },
    });

    if (lineItems) {
      await db.billLineItem.deleteMany({ where: { billId: params.id } });
      await db.billLineItem.createMany({
        data: lineItems.map((item, idx) => ({
          billId: params.id,
          description: item.description!,
          amount: item.amount ?? 0,
          categoryId: item.categoryId ?? null,
          sortOrder: idx,
        })),
      });
    }

    const updated = await db.bill.findUnique({
      where: { id: params.id, companyId },
      include: {
        vendor: { select: { id: true, name: true, companyName: true } },
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/bills/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update bill' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.bill.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    if (existing.status === 'paid') {
      return NextResponse.json({ error: 'Cannot delete a paid bill. Void it instead.' }, { status: 400 });
    }

    await db.billLineItem.deleteMany({ where: { billId: params.id } });
    await db.bill.delete({ where: { id: params.id } });
    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/bills/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete bill' }, { status: 500 });
  }
}
