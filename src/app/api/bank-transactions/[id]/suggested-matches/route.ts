import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { evaluateMatch, type OpenDocument } from '@/lib/banking/matching';

export const dynamic = 'force-dynamic';

/** GET /api/bank-transactions/[id]/suggested-matches — the detail-panel match. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { glAccountCode: true } } },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    const isInflow = Number(tx.amount) > 0;
    const contacts = await db.contact.findMany({ where: { companyId }, select: { id: true, name: true, companyName: true } });

    const docs: OpenDocument[] = isInflow
      ? (
          await db.invoice.findMany({
            where: { companyId, status: { in: ['sent', 'overdue'] } },
            include: { customer: { select: { id: true, name: true, companyName: true } } },
          })
        ).map((inv) => ({
          type: 'invoice',
          id: inv.id,
          ref: inv.id,
          contactId: inv.customerId,
          contactName: inv.customer.companyName || inv.customer.name,
          total: Number(inv.total),
          outstanding: Number(inv.total) - Number(inv.paidAmount),
          dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
        }))
      : (
          await db.bill.findMany({
            where: { companyId, status: { in: ['open', 'overdue'] } },
            include: { vendor: { select: { id: true, name: true, companyName: true } } },
          })
        ).map((bill) => ({
          type: 'bill',
          id: bill.id,
          ref: bill.id,
          contactId: bill.vendorId,
          contactName: bill.vendor.companyName || bill.vendor.name,
          total: Number(bill.total),
          outstanding: Number(bill.total) - Number(bill.paidAmount),
          dueDate: bill.dueDate ? bill.dueDate.toISOString().slice(0, 10) : null,
        }));

    const matches = evaluateMatch({
      row: {
        description: tx.description,
        amount: Number(tx.amount),
        date: tx.date.toISOString().slice(0, 10),
        payeeGuess: tx.payeeGuess,
      },
      docs,
      contacts,
    });

    return NextResponse.json({ data: { matches, isInflow, accountGlCode: tx.account?.glAccountCode } });
  } catch (err) {
    console.error('GET /api/bank-transactions/[id]/suggested-matches error:', err);
    return NextResponse.json({ error: 'Failed to find matches' }, { status: 500 });
  }
}
