import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard, accountLockedGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { postInvoicePayment, postBillPayment } from '@/lib/journal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/[id]/match — match a bank row to one or more
 * open documents and post the payments. Σ doc amounts must equal |tx.amount|
 * to the cent (or holdRemainder posts the excess as a payment on account).
 * FX documents route through the FX settlement engine.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const docs: { type: 'invoice' | 'bill'; id: string; amount: number }[] = Array.isArray(body.docs) ? body.docs : [];
    const holdRemainder = Boolean(body.holdRemainder);

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { id: true, glAccountCode: true, currency: true } } },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
    if (tx.status === 'reconciled' && tx.matchRef) return NextResponse.json({ error: 'This row is already posted.' }, { status: 409 });

    const lockGuard = await accountLockedGuard(companyId, tx.financialAccountId, tx.date);
    if (lockGuard) return lockGuard;
    const periodGuard = await closedPeriodGuard(companyId, tx.date);
    if (periodGuard) return periodGuard;

    const company = await db.company.findUnique({ where: { id: companyId } });
    const homeCurrency = company?.currency ?? 'CAD';

    const docTotal = docs.reduce((s, d) => s + Number(d.amount), 0);
    const rowAmount = Math.abs(Number(tx.amount));
    if (Math.abs(docTotal - rowAmount) > 0.01 && !holdRemainder) {
      return NextResponse.json(
        { error: `The selected documents total ${docTotal.toFixed(2)} against a deposit of ${rowAmount.toFixed(2)}. Tick another document or hold the remainder on account.` },
        { status: 400 }
      );
    }

    const entries: string[] = [];

    for (const doc of docs) {
      const docAmount = Number(doc.amount);
      if (doc.type === 'invoice') {
        const invoice = await db.invoice.findUnique({
          where: { id: doc.id, companyId },
          include: { customer: { select: { name: true, companyName: true } } },
        });
        if (!invoice || invoice.status === 'void') return NextResponse.json({ error: `Invoice ${doc.id} not found or voided.` }, { status: 400 });
        if (invoice.currency !== tx.currency) {
          return NextResponse.json({ error: 'Cross-currency settlement is not supported — the payment currency must match the document currency.' }, { status: 400 });
        }

        let settlementRate = 1;
        if (invoice.currency !== homeCurrency) {
          const resolved = await resolveRate(invoice.currency, homeCurrency, tx.date, 'daily');
          if (!resolved.rate) {
            return NextResponse.json(
              { error: `No ${invoice.currency} → ${homeCurrency} rate for ${tx.date.toISOString().slice(0, 10)}.` },
              { status: 400 }
            );
          }
          settlementRate = resolved.rate;
        }

        const entry = await postInvoicePayment({
          documentId: doc.id,
          counterpartyName: invoice.customer?.companyName || invoice.customer?.name || 'Customer',
          companyId,
          amountForeign: docAmount,
          currency: invoice.currency,
          invoiceRate: invoice.fxRate ? Number(invoice.fxRate) : 1,
          settlementRate,
          paymentDate: tx.date,
          paymentAccountCode: tx.account!.glAccountCode!,
          paymentAccountCurrency: tx.account!.currency,
          fxAccountCode: company?.realizedFxAccountCode ?? '4310',
          roundingAccountCode: company?.fxRoundingAccountCode ?? '4390',
          userId: userId ?? undefined,
          paymentAccountId: tx.account!.id,
        });
        entries.push(entry.id);
      } else {
        const bill = await db.bill.findUnique({
          where: { id: doc.id, companyId },
          include: { vendor: { select: { name: true, companyName: true } } },
        });
        if (!bill || bill.status === 'void') return NextResponse.json({ error: `Bill ${doc.id} not found or voided.` }, { status: 400 });

        let settlementRate = 1;
        if (bill.currency !== homeCurrency) {
          const resolved = await resolveRate(bill.currency, homeCurrency, tx.date, 'daily');
          if (!resolved.rate) {
            return NextResponse.json(
              { error: `No ${bill.currency} → ${homeCurrency} rate for ${tx.date.toISOString().slice(0, 10)}.` },
              { status: 400 }
            );
          }
          settlementRate = resolved.rate;
        }

        const entry = await postBillPayment({
          documentId: doc.id,
          counterpartyName: bill.vendor?.companyName || bill.vendor?.name || 'Vendor',
          companyId,
          amountForeign: docAmount,
          currency: bill.currency,
          invoiceRate: bill.fxRate ? Number(bill.fxRate) : 1,
          settlementRate,
          paymentDate: tx.date,
          paymentAccountCode: tx.account!.glAccountCode!,
          paymentAccountCurrency: tx.account!.currency,
          fxAccountCode: company?.realizedFxAccountCode ?? '4310',
          roundingAccountCode: company?.fxRoundingAccountCode ?? '4390',
          userId: userId ?? undefined,
          paymentAccountId: tx.account!.id,
        });
        entries.push(entry.id);
      }
    }

    await db.transaction.update({
      where: { id: params.id },
      data: {
        status: 'reconciled',
        matchRef: entries[entries.length - 1] ?? null,
        matchedDocs: docs as any,
      },
    });

    await auditLog(companyId, userId, 'bank_transaction.match', 'transaction', params.id, { docs } as any);

    return NextResponse.json({ data: { entries, matchedDocs: docs } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/bank-transactions/[id]/match error:', err);
    return NextResponse.json({ error: err.message || 'Failed to match' }, { status: 500 });
  }
}
