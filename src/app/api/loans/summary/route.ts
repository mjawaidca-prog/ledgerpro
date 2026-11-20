import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { fiscalYearTotals, toDollars } from '@/lib/loans/engine';
import { loanToScheduleRows } from '@/lib/loans/server';
import { fiscalContextOf, shareholderSummary } from '@/lib/loans/present';

export const dynamic = 'force-dynamic';

/**
 * Company-wide loan figures for the T2 and the dashboard:
 *   - fiscal-year interest totals across every term loan (the GIFI 8710
 *     figure, sliced on the company's own year-end), with a per-loan
 *     breakdown so the total can be tied back to each schedule;
 *   - every live shareholder-loan warning (s.15(2) deadlines inside the
 *     180-day window or past it) and series-of-repayments flag.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true, firstFiscalYearEnd: true },
    });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const ctx = fiscalContextOf(company);
    const today = new Date().toISOString().slice(0, 10);

    const loans = await db.loan.findMany({
      where: { companyId, status: 'active' },
      include: { payments: true, advances: true },
      orderBy: { createdAt: 'asc' },
    });

    const byYear = new Map<
      number,
      { label: string; start: string; end: string; interestCents: number; principalCents: number; paymentsCents: number }
    >();
    const perLoan: {
      loanId: string;
      lenderName: string;
      fiscalYears: { label: string; interest: number; principal: number; payments: number }[];
    }[] = [];

    for (const loan of loans) {
      if (loan.kind !== 'term') continue;
      const rows = loanToScheduleRows(loan.payments);
      const totals = fiscalYearTotals(rows, ctx.anchor, ctx.firstYear);
      perLoan.push({
        loanId: loan.id,
        lenderName: loan.lenderName,
        fiscalYears: totals.map((fy) => ({
          label: fy.label,
          interest: toDollars(fy.interestCents),
          principal: toDollars(fy.principalCents),
          payments: toDollars(fy.paymentsCents),
        })),
      });
      for (const fy of totals) {
        const bucket = byYear.get(fy.labelYear) ?? {
          label: fy.label,
          start: fy.start,
          end: fy.end,
          interestCents: 0,
          principalCents: 0,
          paymentsCents: 0,
        };
        bucket.interestCents += fy.interestCents;
        bucket.principalCents += fy.principalCents;
        bucket.paymentsCents += fy.paymentsCents;
        byYear.set(fy.labelYear, bucket);
      }
    }

    const shareholderWarnings: {
      loanId: string;
      lenderName: string;
      advanceDate: string;
      outstanding: number;
      deadline: string;
      daysRemaining: number;
      level: string | null;
      message: string;
    }[] = [];
    const seriesFlags: { loanId: string; lenderName: string; message: string }[] = [];

    for (const loan of loans) {
      if (loan.kind !== 'shareholder_advance') continue;
      const summary = shareholderSummary(loan, loan.advances, ctx, today);
      for (const d of summary.deadlines) {
        if (d.level == null) continue;
        shareholderWarnings.push({
          loanId: loan.id,
          lenderName: loan.lenderName,
          advanceDate: d.advanceDate,
          outstanding: d.outstanding,
          deadline: d.deadline,
          daysRemaining: d.daysRemaining,
          level: d.level,
          message: d.message,
        });
      }
      for (const flag of summary.seriesFlags) {
        seriesFlags.push({ loanId: loan.id, lenderName: loan.lenderName, message: flag.message });
      }
    }
    shareholderWarnings.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return NextResponse.json({
      data: {
        fiscalYearInterest: [...byYear.values()]
          .sort((a, b) => (a.start < b.start ? -1 : 1))
          .map((fy) => ({
            label: fy.label,
            start: fy.start,
            end: fy.end,
            interest: toDollars(fy.interestCents),
            principal: toDollars(fy.principalCents),
            payments: toDollars(fy.paymentsCents),
          })),
        perLoan,
        shareholderWarnings,
        seriesFlags,
      },
    });
  } catch (error) {
    console.error('GET /api/loans/summary error:', error);
    return NextResponse.json({ error: 'Failed to fetch loan summary' }, { status: 500 });
  }
}
