import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { billUpdateSchema } from '@/lib/validators/bill';
import { voidJournalEntry, postBillToLedger } from '@/lib/journal';
export const dynamic = 'force-dynamic';

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
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
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
    const isVoidTransition = billData.status === 'void' && existing.status !== 'void';
    const isOnlyStatusChange = Object.keys(billData).every((k) => k === 'status') && !lineItems;
    const newTotal = billData.total !== undefined ? Number(billData.total) : Number(existing.total);
    const totalChanged = Math.abs(newTotal - Number(existing.total)) > 0.005;

    // Paid or voided bills are locked to status-only transitions (e.g. void)
    // — unwinding a payment or a void takes more than a field edit.
    if ((existing.status === 'paid' || existing.status === 'void') && !isOnlyStatusChange) {
      return NextResponse.json(
        { error: 'This bill is paid or voided. Void it to make corrections instead of editing it directly.' },
        { status: 409 }
      );
    }

    const guardError = await closedPeriodGuard(companyId, existing.billDate);
    if (guardError) return guardError;
    if (billData.billDate) {
      const newDateGuard = await closedPeriodGuard(companyId, new Date(billData.billDate));
      if (newDateGuard) return newDateGuard;
    }

    const existingBillEntry = await db.journalEntry.findFirst({
      where: { companyId, sourceId: params.id, sourceType: 'bill', voidedAt: null },
    });
    const becomingPosted = existing.status === 'draft' && billData.status && billData.status !== 'draft';

    if (isVoidTransition) {
      const reversalGuard = await closedPeriodGuard(companyId, new Date());
      if (reversalGuard) return reversalGuard;

      const entries = await db.journalEntry.findMany({
        where: { companyId, sourceId: params.id, sourceType: { in: ['bill', 'payment'] }, voidedAt: null },
      });
      for (const entry of entries) {
        await voidJournalEntry(entry.id, companyId, userId);
      }
    } else if (existingBillEntry && (totalChanged || lineItems)) {
      // Already posted and the total or categorization changed — void the
      // stale posting and repost below so the GL matches the new lines.
      const reversalGuard = await closedPeriodGuard(companyId, new Date());
      if (reversalGuard) return reversalGuard;
      await voidJournalEntry(existingBillEntry.id, companyId, userId);
    }

    if ((becomingPosted || (existingBillEntry && (totalChanged || lineItems))) && lineItems?.some((li) => !li.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL category before the bill can be posted.' },
        { status: 400 }
      );
    }

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

    if (!isVoidTransition && updated && (becomingPosted || (existingBillEntry && (totalChanged || lineItems)))) {
      await postBillToLedger(
        params.id,
        updated.vendor?.name ?? 'Unknown',
        updated.lineItems.map((li) => ({ categoryId: li.categoryId, amount: Number(li.amount) })),
        Number(updated.taxAmount),
        Number(updated.total),
        companyId
      );
    }

    await auditLog(companyId, userId, isVoidTransition ? 'bill.void' : 'bill.update', 'bill', params.id, { before: existing, after: updated });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/bills/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update bill' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.bill.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Cannot delete a posted bill. Void it instead.' }, { status: 400 });
    }

    await db.billLineItem.deleteMany({ where: { billId: params.id } });
    await db.bill.delete({ where: { id: params.id } });

    await auditLog(companyId, userId, 'bill.delete', 'bill', params.id, { before: existing });

    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/bills/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete bill' }, { status: 500 });
  }
}
