import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { computeSettlement, round2, journalLinesForPayment } from '@/lib/fx/settlement';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fx/settlement-preview?invoiceId&amount&date&accountId&fxRate?
 * The breakdown card + journal preview for settling a document, without
 * posting. Same math as the POST.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get('invoiceId');
    const amount = Number(searchParams.get('amount'));
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    const accountId = searchParams.get('accountId');
    const manualRate = Number(searchParams.get('fxRate')) || undefined;

    if (!invoiceId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'invoiceId and a positive amount are required.' }, { status: 400 });
    }

    // Closed-period guard runs BEFORE any FX math.
    const guardError = await closedPeriodGuard(companyId, new Date(date));
    if (guardError) return guardError;

    const [invoice, company] = await Promise.all([
      db.invoice.findUnique({ where: { id: invoiceId, companyId } }),
      db.company.findUnique({ where: { id: companyId } }),
    ]);
    if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (invoice.status === 'void') return NextResponse.json({ error: 'Cannot pay a voided invoice.' }, { status: 400 });
    if (!invoice.fxRate) return NextResponse.json({ error: 'The invoice has no frozen FX rate to settle against.' }, { status: 400 });

    const homeCurrency = company?.currency ?? 'CAD';
    const invoiceRate = Number(invoice.fxRate);
    const remainingForeign = round2(Number(invoice.total) - Number(invoice.paidAmount));
    const remainingHome = round2(Number(invoice.totalHome ?? invoice.total) - Number(invoice.paidAmountHome ?? invoice.paidAmount));

    // Cross-currency settlement is out of scope for v1.
    if (manualRate === undefined) {
      const resolved = await resolveRate(invoice.currency, homeCurrency, date, 'daily');
      const settlementRate = resolved.rate;
      if (!settlementRate) {
        return NextResponse.json({ error: `No ${invoice.currency} → ${homeCurrency} rate for ${date}. Enter a rate to continue.` }, { status: 400 });
      }
      return NextResponse.json({ data: buildPreview({ invoice, amount, date, accountId, homeCurrency, settlementRate, rateSource: resolved.source, invoiceRate, remainingForeign, remainingHome }) });
    }

    return NextResponse.json({
      data: buildPreview({ invoice, amount, date, accountId, homeCurrency, settlementRate: manualRate, rateSource: 'manual', invoiceRate, remainingForeign, remainingHome }),
    });
  } catch (err) {
    console.error('GET /api/fx/settlement-preview error:', err);
    return NextResponse.json({ error: 'Failed to build settlement preview' }, { status: 500 });
  }
}

function buildPreview(opts: {
  invoice: any;
  amount: number;
  date: string;
  accountId: string | null;
  homeCurrency: string;
  settlementRate: number;
  rateSource: 'feed' | 'manual' | 'none';
  invoiceRate: number;
  remainingForeign: number;
  remainingHome: number;
}) {
  const { invoice, amount, date, accountId, homeCurrency, settlementRate, rateSource, invoiceRate, remainingForeign, remainingHome } = opts;

  const reliefForeign = Math.min(amount, remainingForeign);
  const c = computeSettlement({
    amountForeign: reliefForeign,
    invoiceRate,
    settlementRate,
    remainingForeign,
    remainingHome,
  });

  const fxAccountCode = '4310';
  const roundingAccountCode = '4390';

  const journal = journalLinesForPayment(c, {
    cashAccountCode: '1010', // placeholder — resolved per account on POST
    receivableAccountCode: '1100',
    fxAccountCode,
    roundingAccountCode,
    documentId: invoice.id,
    counterpartyName: 'Customer',
    currency: invoice.currency,
  }).map((l) => ({
    code: l.glAccountCode,
    name: l.glAccountCode === '1100' ? 'Accounts receivable' : l.glAccountCode === fxAccountCode ? 'Realized FX gain/loss' : l.glAccountCode === roundingAccountCode ? 'FX rounding' : 'Bank account',
    memo: l.description,
    debit: l.debit,
    credit: l.credit,
  }));

  return {
    currency: invoice.currency,
    homeCurrency,
    amountForeign: reliefForeign,
    invoiceRate,
    settlementRate,
    rateSource,
    cashHome: c.cashHome,
    receivableRelievedHome: c.reliefHome,
    fxDifference: c.fxDifference,
    outcome: c.outcome,
    glAccountCode: c.outcome === 'none' ? null : fxAccountCode,
    journal,
    remainingForeign: c.remainingForeign,
    remainingHome: c.remainingHome,
    depositAccountCurrency: null, // resolved client-side from the account list
  };
}
