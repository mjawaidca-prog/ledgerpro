import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { billUpdateSchema } from '@/lib/validators/bill';
import { voidJournalEntry, postBillToLedger } from '@/lib/journal';
import { reverseTaxPosting, TaxPostingError } from '@/lib/tax/posting-service';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const bill = await db.bill.findUnique({
      where: { id: params.id, companyId },
      include: {
        vendor: true,
        lineItems: {
          orderBy: { sortOrder: 'asc' },
          include: { taxSnapshot: { include: { components: true, taxCodeVersion: { include: { taxCode: true } } } } },
        },
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

    const { lineItems, taxDecision: _taxDecision, ...billData } = parsed.data;
    const isVoidTransition = billData.status === 'void' && existing.status !== 'void';
    const isOnlyStatusChange = Object.keys(billData).every((k) => k === 'status') && !lineItems;
    const newTotal = billData.total !== undefined ? Number(billData.total) : Number(existing.total);
    const totalChanged = Math.abs(newTotal - Number(existing.total)) > 0.005;
    const existingTaxPosting = await db.taxPosting.findFirst({
      where: { companyId, journalEntry: { sourceId: params.id, sourceType: 'bill' }, reversalOfId: null },
      include: { reversedBy: true },
    });

    if (existingTaxPosting) {
      if (!isOnlyStatusChange || !['void', existing.status].includes(billData.status ?? '')) {
        throw new TaxPostingError('tax_document_immutable', 'Posted tax documents cannot be edited or returned to draft. Void and recreate the document to correct it.', 409);
      }
      if (billData.status === existing.status) return NextResponse.json({ data: existing });
      const updated = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${params.id} AND "companyId" = ${companyId} FOR UPDATE`;
        const current = await tx.bill.findUniqueOrThrow({ where: { id: params.id, companyId } });
        if (current.status === 'void') return current;
        const payment = await tx.journalEntry.findFirst({ where: { companyId, sourceId: params.id, sourceType: 'payment', voidedAt: null } });
        if (Number(current.paidAmount) !== 0 || payment) {
          throw new TaxPostingError('tax_settlement_reversal_required', 'Reverse the payments and bank matches before voiding this reviewed-tax document.', 409);
        }
        await reverseTaxPosting({ companyId, userId, postingId: existingTaxPosting.id, sourceKey: 'bill-void:' + params.id, reversalDate: new Date(), reason: 'bill voided by user' }, tx);
        return tx.bill.update({ where: { id: params.id, companyId }, data: { status: 'void' } });
      });
      return NextResponse.json({ data: updated });
    }
    const taxConfiguration = await db.companyTaxConfiguration.findUnique({ where: { companyId }, select: { enabled: true } });
    if (taxConfiguration?.enabled && !isVoidTransition) {
      throw new TaxPostingError('legacy_tax_review_required', 'This document predates reviewed tax. Void it if posted, then create a new document with explicit line tax decisions.', 409);
    }

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

      {
        const entries = await db.journalEntry.findMany({
          where: { companyId, sourceId: params.id, sourceType: { in: ['bill', 'payment'] }, voidedAt: null },
        });
        for (const entry of entries) await voidJournalEntry(entry.id, companyId, userId);
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
    if (error instanceof TaxPostingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
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
