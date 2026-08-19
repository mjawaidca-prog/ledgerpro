import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { postBillPayment } from '@/lib/journal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bills/[id]/payments — record a bill payment (FX-aware settlement,
 * payable sign flip). Ships for parity and tests; no dedicated UI in v1.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const amount = Number(body.amount);
    const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10);
    const accountId = typeof body.accountId === 'string' ? body.accountId : null;
    const manualRate = Number(body.fxRate) || undefined;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
    }
    if (!accountId) {
      return NextResponse.json({ error: 'A payment account is required.' }, { status: 400 });
    }

    const guardError = await closedPeriodGuard(companyId, new Date(date));
    if (guardError) return guardError;

    const [bill, company, account] = await Promise.all([
      db.bill.findUnique({ where: { id: params.id, companyId } }),
      db.company.findUnique({ where: { id: companyId } }),
      db.financialAccount.findUnique({ where: { id: accountId, companyId } }),
    ]);
    if (!bill) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 });
    if (bill.status === 'void') return NextResponse.json({ error: 'Cannot pay a voided bill.' }, { status: 400 });
    if (bill.status === 'paid') return NextResponse.json({ error: 'This bill is already fully paid.' }, { status: 409 });
    if (!account) return NextResponse.json({ error: 'Payment account not found.' }, { status: 404 });
    if (!account.glAccountCode) return NextResponse.json({ error: 'The payment account is not linked to a GL account.' }, { status: 400 });

    const homeCurrency = company?.currency ?? 'CAD';
    let settlementRate: number;
    if (manualRate) {
      settlementRate = manualRate;
    } else {
      const resolved = await resolveRate(bill.currency, homeCurrency, date, 'daily');
      if (!resolved.rate) {
        return NextResponse.json(
          { error: `No ${bill.currency} → ${homeCurrency} rate for ${date}. Enter a rate to continue.` },
          { status: 400 }
        );
      }
      settlementRate = resolved.rate;
    }

    const entry = await postBillPayment({
      documentId: params.id,
      counterpartyName: 'Vendor',
      companyId,
      amountForeign: amount,
      currency: bill.currency,
      invoiceRate: Number(bill.fxRate),
      settlementRate,
      paymentDate: new Date(date),
      paymentAccountCode: account.glAccountCode,
      paymentAccountCurrency: account.currency,
      fxAccountCode: company?.realizedFxAccountCode ?? '4310',
      roundingAccountCode: company?.fxRoundingAccountCode ?? '4390',
      userId: userId ?? undefined,
      paymentAccountId: account.id,
    });

    await auditLog(companyId, userId, 'bill.payment', 'bill', params.id, { amount, currency: bill.currency, settlementRate } as any);

    return NextResponse.json({ data: { entry, settlementRate } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/bills/[id]/payments error:', err);
    if (err.message?.includes('already fully paid')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to record payment' }, { status: 500 });
  }
}
