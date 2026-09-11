import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { parseLocalDate, formatReportPeriod, endOfDay } from '@/lib/reporting';
import { buildBalanceSheet } from '@/lib/api/reports';
import { reportMeta } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/reports/balance-sheet?asOf=YYYY-MM-DD — assets, liabilities,
// equity and current-year earnings as of a date.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read', rateScope: 'report' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const asOfRaw = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
  const asOf = parseLocalDate(asOfRaw);
  if (Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: { code: 'invalid_parameter', message: 'asOf must be a valid date (YYYY-MM-DD).' } }, { status: 400 });
  }

  const [company, report] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: context!.companyId }, select: { currency: true } }),
    buildBalanceSheet(context!.companyId, asOf),
  ]);

  return NextResponse.json({
    data: {
      ...report,
      meta: reportMeta({
        periodLabel: formatReportPeriod('point-in-time', asOf),
        to: endOfDay(asOf),
        currency: company.currency,
      }),
    },
  });
}
