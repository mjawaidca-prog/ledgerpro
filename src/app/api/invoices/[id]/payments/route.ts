import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { postInvoicePayment } from '@/lib/journal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/[id]/payments — record a payment (FX-aware settlement).
 * Body: { amount, currency, date, accountId, fxRate? }.
 * The server recomputes all FX math — client totals are never trusted.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const amount = Number(body.amount);
    const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
    const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10);
    const accountId = typeof body.accountId === 'string' ? body.accountId : null;
    const manualRate = Number(body.fxRate) || undefined;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
    }
    if (!accountId) {
      return NextResponse.json({ error: 'A deposit account is required.' }, { status: 400 });
    }

    // Closed-period guard runs BEFORE any FX math.
    const guardError = await closedPeriodGuard(companyId, new Date(date));
    if (guardError) return guardError;

    const [invoice, company, account] = await Promise.all([
      db.invoice.findUnique({ where: { id: params.id, companyId } }),
      db.company.findUnique({ where: { id: companyId } }),
      db.financialAccount.findUnique({ where: { id: accountId, companyId } }),
    ]);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (invoice.status === 'void') return NextResponse.json({ error: 'Cannot pay a voided invoice.' }, { status: 400 });
    if (invoice.status === 'paid') return NextResponse.json({ error: 'This invoice is already fully paid.' }, { status: 409 });
    if (!account) return NextResponse.json({ error: 'Deposit account not found.' }, { status: 404 });
    if (!account.glAccountCode) return NextResponse.json({ error: 'The deposit account is not linked to a GL account.' }, { status: 400 });

    // Cross-currency settlement is out of scope for v1.
    if (currency && currency !== invoice.currency) {
      return NextResponse.json({ error: 'Cross-currency settlement is not supported — the payment currency must match the invoice currency.' }, { status: 400 });
    }

    const homeCurrency = company?.currency ?? 'CAD';
    const invoiceRate = Number(invoice.fxRate);
    let settlementRate: number;
    let rateSource: 'feed' | 'manual';

    if (manualRate) {
      settlementRate = manualRate;
      rateSource = 'manual';
    } else {
      const resolved = await resolveRate(invoice.currency, homeCurrency, date, 'daily');
      if (!resolved.rate) {
        return NextResponse.json(
          { error: `No ${invoice.currency} → ${homeCurrency} rate for ${date}. Enter a rate to continue.` },
          { status: 400 }
        );
      }
      settlementRate = resolved.rate;
      rateSource = resolved.source === 'feed' ? 'feed' : 'manual';
    }

    const entry = await postInvoicePayment({
      documentId: params.id,
      counterpartyName: 'Customer',
      companyId,
      amountForeign: amount,
      currency: invoice.currency,
      invoiceRate,
      settlementRate,
      paymentDate: new Date(date),
      paymentAccountCode: account.glAccountCode,
      paymentAccountCurrency: account.currency,
      fxAccountCode: company?.realizedFxAccountCode ?? '4310',
      roundingAccountCode: company?.fxRoundingAccountCode ?? '4390',
      userId: userId ?? undefined,
      paymentAccountId: account.id,
    });

    await auditLog(companyId, userId, 'invoice.payment', 'invoice', params.id, {
      amount,
      currency: invoice.currency,
      settlementRate,
      rateSource,
    } as any);

    return NextResponse.json({ data: { entry, settlementRate, rateSource } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/invoices/[id]/payments error:', err);
    if (err.message?.includes('already fully paid')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to record payment' }, { status: 500 });
  }
}
