import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, endOfDay, toDebitCredit, fiscalYearStartFor, parseLocalDate } from '@/lib/reporting';
import { buildTbGifiPayload, formatContractBn } from '@/lib/tb-gifi';
import type { GLType } from '@prisma/client';
import { format, startOfDay } from 'date-fns';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/trial-balance/tb-gifi?asOf=YYYY-MM-DD
 *
 * Builds the `tb-gifi/1` JSON trial balance that Nexvar Tax imports
 * (see src/lib/tb-gifi.ts for the contract). Same trial-balance
 * computation as GET /api/reports/trial-balance — active chart of
 * accounts plus GL activity through the as-of date — packaged for the
 * tax contract: fiscal-year period start, company BN, period-lock
 * state, and the canonical payload hash Nexvar Tax verifies.
 *
 * The response body is exactly the payload (so it can be saved and
 * uploaded to Nexvar Tax as-is); the unmapped-account count rides in
 * the X-Tb-Gifi-Unmapped-Count header for the export menu's notice.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const asOfDate = endOfDay(parseLocalDate(asOfParam));
    const periodEnd = asOfDate.toISOString().slice(0, 10);

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { businessNumber: true, fiscalYearStart: true, firstFiscalYearEnd: true },
    });

    const bn = formatContractBn(company?.businessNumber);
    if (!bn) {
      return NextResponse.json(
        { error: 'This company has no business number on file. Add the BN in Company Settings before exporting a tb-gifi/1 file for Nexvar Tax.' },
        { status: 422 },
      );
    }
    if (!company?.fiscalYearStart) {
      return NextResponse.json(
        { error: 'This company has no fiscal year start configured, so the export period cannot be determined.' },
        { status: 422 },
      );
    }

    const [accounts, activity, closedPeriod] = await Promise.all([
      db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } }),
      getGLActivity(companyId, { to: asOfDate }),
      db.periodClose.findFirst({
        where: {
          companyId,
          status: 'closed',
          periodEnd: { gte: startOfDay(asOfDate), lte: asOfDate },
        },
        select: { id: true },
      }),
    ]);

    const fyStart = fiscalYearStartFor(company.fiscalYearStart, asOfDate, company.firstFiscalYearEnd ?? null);

    const { payload, unmappedCount } = buildTbGifiPayload({
      companyId,
      bn,
      periodStart: format(fyStart, 'yyyy-MM-dd'),
      periodEnd,
      // Postings are included through the end of the as-of date —
      // the same cutoff getGLActivity applied above.
      postedThrough: asOfDate.toISOString(),
      periodLocked: !!closedPeriod,
      accounts: accounts.map((acct) => {
        const { debit, credit } = toDebitCredit(acct.type as GLType, activity[acct.code]);
        return {
          accountId: acct.id,
          number: acct.code,
          name: acct.name,
          type: acct.type,
          gifiCode: acct.gifiCode,
          debitCents: Math.round(debit * 100),
          creditCents: Math.round(credit * 100),
        };
      }),
    });

    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="trial-balance-tb-gifi-${periodEnd}.json"`,
        'X-Tb-Gifi-Unmapped-Count': String(unmappedCount),
      },
    });
  } catch (error) {
    console.error('GET /api/reports/trial-balance/tb-gifi error:', error);
    return NextResponse.json({ error: 'Failed to generate tb-gifi/1 trial balance export' }, { status: 500 });
  }
}
