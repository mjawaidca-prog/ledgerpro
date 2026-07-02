import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { invoiceUpdateSchema } from '@/lib/validators/invoice';
import { voidJournalEntry, postInvoiceToLedger } from '@/lib/journal';
export const dynamic = 'force-dynamic';

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
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const parsed = invoiceUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const existing = await db.invoice.findUnique({
      where: { id: params.id, companyId },
      include: { lineItems: { select: { categoryId: true, amount: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { lineItems, ...invoiceData } = parsed.data;
    const isVoidTransition = invoiceData.status === 'void' && existing.status !== 'void';
    const isOnlyStatusChange = Object.keys(invoiceData).every((k) => k === 'status') && !lineItems;
    const newTotal = invoiceData.total !== undefined ? Number(invoiceData.total) : Number(existing.total);
    const newTaxAmount = invoiceData.taxAmount !== undefined ? Number(invoiceData.taxAmount) : Number(existing.taxAmount);
    const totalChanged = Math.abs(newTotal - Number(existing.total)) > 0.005;

    // Paid or voided invoices are locked to status-only transitions (e.g. void)
    // — unwinding a payment or a void takes more than a field edit.
    if ((existing.status === 'paid' || existing.status === 'void') && !isOnlyStatusChange) {
      return NextResponse.json(
        { error: 'This invoice is paid or voided. Void it to make corrections instead of editing it directly.' },
        { status: 409 }
      );
    }

    const guardError = await closedPeriodGuard(companyId, existing.issueDate);
    if (guardError) return guardError;
    if (invoiceData.issueDate) {
      const newDateGuard = await closedPeriodGuard(companyId, new Date(invoiceData.issueDate));
      if (newDateGuard) return newDateGuard;
    }

    const existingInvoiceEntry = await db.journalEntry.findFirst({
      where: { companyId, sourceId: params.id, sourceType: 'invoice', voidedAt: null },
    });
    const becomingPosted = existing.status === 'draft' && invoiceData.status && invoiceData.status !== 'draft';
    const willPost = !isVoidTransition && (becomingPosted || (existingInvoiceEntry && totalChanged));
    const effectiveLineItems = lineItems ?? existing.lineItems;

    if (willPost && effectiveLineItems.some((li: any) => !li.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL revenue category before the invoice can be posted.' },
        { status: 400 }
      );
    }

    if (isVoidTransition) {
      const reversalGuard = await closedPeriodGuard(companyId, new Date());
      if (reversalGuard) return reversalGuard;

      const entries = await db.journalEntry.findMany({
        where: { companyId, sourceId: params.id, sourceType: { in: ['invoice', 'payment'] }, voidedAt: null },
      });
      for (const entry of entries) {
        await voidJournalEntry(entry.id, companyId, userId);
      }
    } else if (existingInvoiceEntry && totalChanged) {
      // Already posted and the total changed (e.g. a line item was edited on
      // a sent-but-unpaid invoice) — void the stale posting and repost so the
      // GL reflects the updated total instead of silently drifting from it.
      const reversalGuard = await closedPeriodGuard(companyId, new Date());
      if (reversalGuard) return reversalGuard;
      await voidJournalEntry(existingInvoiceEntry.id, companyId, userId);
    }

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

    if (willPost && updated) {
      await postInvoiceToLedger(
        params.id,
        updated.customer?.name ?? 'Unknown',
        updated.lineItems.map((li) => ({ categoryId: li.categoryId, amount: Number(li.amount) })),
        newTaxAmount,
        newTotal,
        companyId
      );
    }

    await auditLog(companyId, userId, isVoidTransition ? 'invoice.void' : 'invoice.update', 'invoice', params.id, { before: existing, after: updated });

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    console.error('PUT /api/invoices/[id] error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update invoice' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.invoice.findUnique({ where: { id: params.id, companyId } });
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot delete a posted invoice. Void it instead.' },
        { status: 400 }
      );
    }

    await db.invoiceLineItem.deleteMany({ where: { invoiceId: params.id } });
    await db.invoice.delete({ where: { id: params.id } });

    await auditLog(companyId, userId, 'invoice.delete', 'invoice', params.id, { before: existing });

    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/invoices/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
