import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { isMonetaryAccount, buildRevaluationRows, type ForeignBalance } from '@/lib/fx/revaluation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fx/revaluation/preview?asOf&rateType=closing
 * The revaluation preview table + net. Monetary FX balances only.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);

    const [accounts, company] = await Promise.all([
      db.chartOfAccount.findMany({ where: { companyId, active: true } }),
      db.company.findUnique({ where: { id: companyId } }),
    ]);
    const home = company?.currency ?? 'CAD';

    const monetary = accounts.filter((a) => isMonetaryAccount(a as any));

    // Foreign balances come from the JournalLine foreign columns; carrying
    // comes from the home columns (each document's frozen-rate value).
    const lines = await db.journalLine.findMany({
      where: { glAccountCode: { in: monetary.map((a) => a.code) }, journalEntry: { companyId, voidedAt: null, entryDate: { lte: new Date(asOf) } } },
      select: { glAccountCode: true, currency: true, debit: true, credit: true, debitForeign: true, creditForeign: true },
    });

    const byAccount = new Map<string, ForeignBalance>();
    for (const l of lines) {
      if (!l.currency || l.currency === home) continue;
      const key = l.glAccountCode;
      let b = byAccount.get(key);
      if (!b) {
        const acct = monetary.find((a) => a.code === key)!;
        b = { accountCode: key, accountName: acct.name, type: acct.type as 'asset' | 'liability', currency: l.currency, balanceForeign: 0, carryingHome: 0 };
        byAccount.set(key, b);
      }
      b.balanceForeign += Number(l.debitForeign ?? 0) - Number(l.creditForeign ?? 0);
      b.carryingHome += Number(l.debit) - Number(l.credit);
    }

    const currencies = [...new Set([...byAccount.values()].map((b) => b.currency))];
    const rates: Record<string, number> = {};
    for (const ccy of currencies) {
      const resolved = await resolveRate(ccy, home, asOf, 'closing');
      if (resolved.rate) rates[ccy] = resolved.rate;
    }

    const result = buildRevaluationRows({ balances: [...byAccount.values()], rates });

    return NextResponse.json({ data: { asOf, homeCurrency: home, ...result } });
  } catch (err) {
    console.error('GET /api/fx/revaluation/preview error:', err);
    return NextResponse.json({ error: 'Failed to build revaluation preview' }, { status: 500 });
  }
}
