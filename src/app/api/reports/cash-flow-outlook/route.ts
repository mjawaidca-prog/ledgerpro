import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { assembleCashflowOutlook } from '@/lib/cashflow/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/cash-flow-outlook
 *
 * The 13-week cash-flow lookahead for the active company
 * (src/lib/cashflow/): opening bank position, then week-by-week in /
 * out / net / running balance built from due dates and stated cadence
 * assumptions only — open invoices and bills, loan amortization
 * schedules, recurring bank legs, the payroll cadence inferred from
 * Nexvar Pay's posted journals with CRA remittances on the 15th, and
 * GST/HST remittances from the GST module's computed position. Every
 * week drills down to its source items.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const asOf = new URL(req.url).searchParams.get('asOf') ?? undefined;
    if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 });
    }

    const { companyName, outlook } = await assembleCashflowOutlook(companyId, asOf);
    return NextResponse.json({ data: { companyName, ...outlook } });
  } catch (error) {
    console.error('GET /api/reports/cash-flow-outlook error:', error);
    return NextResponse.json({ error: 'Failed to build the cash-flow outlook' }, { status: 500 });
  }
}
