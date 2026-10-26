import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import {
  anchorMonthDay,
  fiscalYearRangeContaining,
  chooseDefaultFiscalYear,
} from '@/lib/fiscal-year';
export const dynamic = 'force-dynamic';

/**
 * Phase 0 (P0-5) — server-computed fiscal-year defaults for report pages.
 *
 * Report pages previously defaulted to the fiscal year containing TODAY
 * (via useFiscalYear), so a company whose trading all happened last fiscal
 * year opened every report on an empty current year (Muja: default P&L
 * $0.00 everywhere on Oct 26, 2026, with $180k of income in FY2025).
 * The default is now the fiscal year containing the most recent
 * income/expense journal activity — see chooseDefaultFiscalYear.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true },
    });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const anchor = anchorMonthDay(company.fiscalYearStart);
    const todayYmd = new Date().toISOString().slice(0, 10);

    const [latestJournal, ieAccounts] = await Promise.all([
      db.journalEntry.findFirst({
        where: { companyId },
        orderBy: { entryDate: 'desc' },
        select: { entryDate: true },
      }),
      db.chartOfAccount.findMany({
        where: { companyId, type: { in: ['income', 'expense'] }, active: true },
        select: { code: true },
      }),
    ]);

    let latestIncomeExpense: { entryDate: Date } | null = null;
    if (ieAccounts.length > 0) {
      latestIncomeExpense = await db.journalEntry.findFirst({
        where: {
          companyId,
          lines: { some: { glAccountCode: { in: ieAccounts.map((a: { code: string }) => a.code) } } },
        },
        orderBy: { entryDate: 'desc' },
        select: { entryDate: true },
      });
    }

    const toYmd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
    const latestJournalYmd = toYmd(latestJournal?.entryDate);
    const latestIncomeExpenseYmd = toYmd(latestIncomeExpense?.entryDate);

    const current = fiscalYearRangeContaining(anchor, todayYmd);
    const def = chooseDefaultFiscalYear({
      anchor,
      todayYmd,
      latestIncomeExpenseYmd,
      latestJournalYmd,
    });

    return NextResponse.json({
      data: {
        anchorMonthDay: anchor,
        current,
        default: def,
        isDefaultCurrent: def.labelYear === current.labelYear,
        latestJournalDate: latestJournalYmd,
        latestIncomeExpenseDate: latestIncomeExpenseYmd,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/fiscal-defaults error:', error);
    return NextResponse.json({ error: 'Failed to resolve fiscal-year defaults' }, { status: 500 });
  }
}
