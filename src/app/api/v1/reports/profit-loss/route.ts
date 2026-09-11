import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { parseLocalDate, formatReportPeriod, endOfDay, fiscalYearStartFor } from '@/lib/reporting';
import { buildProfitLoss } from '@/lib/api/reports';
import { reportMeta } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/reports/profit-loss?from=YYYY-MM-DD&to=YYYY-MM-DD — income,
// COGS, operating expenses and net income over a period. from defaults to
// the company's fiscal-year start.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read', rateScope: 'report' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const toRaw = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
  const fromRaw = searchParams.get('from');

  const to = parseLocalDate(toRaw);
  if (Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: { code: 'invalid_parameter', message: 'to must be a valid date (YYYY-MM-DD).' } }, { status: 400 });
  }
  const parsedFrom = fromRaw ? parseLocalDate(fromRaw) : null;
  if (fromRaw && Number.isNaN(parsedFrom!.getTime())) {
    return NextResponse.json({ error: { code: 'invalid_parameter', message: 'from must be a valid date (YYYY-MM-DD).' } }, { status: 400 });
  }

  const company = await db.company.findUniqueOrThrow({
    where: { id: context!.companyId },
    select: { currency: true, fiscalYearStart: true },
  });

  // from defaults to the company's fiscal-year start (the same anchor the
  // dashboard P&L uses).
  const from = parsedFrom ?? fiscalYearStartFor(company.fiscalYearStart, to);
  const report = await buildProfitLoss(context!.companyId, from, to);

  return NextResponse.json({
    data: {
      ...report,
      meta: reportMeta({
        periodLabel: formatReportPeriod('period-range', to, from),
        from,
        to: endOfDay(to),
        currency: company.currency,
      }),
    },
  });
}
