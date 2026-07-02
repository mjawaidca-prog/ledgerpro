import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, normalBalance, endOfDay } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

function isCOGS(acct: { code: string; detailType: string | null }): boolean {
  if (acct.detailType) return acct.detailType.trim().toLowerCase() === 'cogs';
  return acct.code === '5000'; // fallback for accounts predating the detailType convention
}

async function buildPeriodTotals(companyId: string, startDate: Date, endDate: Date) {
  const [incomeAccounts, expenseAccounts, activity] = await Promise.all([
    db.chartOfAccount.findMany({ where: { type: 'income', active: true, companyId }, orderBy: { code: 'asc' } }),
    db.chartOfAccount.findMany({ where: { type: 'expense', active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { from: startDate, to: endOfDay(endDate) }),
  ]);

  const revenueByAccount = incomeAccounts.map((acct) => ({
    code: acct.code,
    name: acct.name,
    amount: Math.round(normalBalance(acct.type, activity[acct.code]) * 100) / 100,
  }));

  const expensesByAccount = expenseAccounts.map((acct) => ({
    code: acct.code,
    name: acct.name,
    isCOGS: isCOGS(acct),
    amount: Math.round(normalBalance(acct.type, activity[acct.code]) * 100) / 100,
  }));

  const totalRevenue = revenueByAccount.reduce((s, r) => s + r.amount, 0);
  const costOfGoodsSold = expensesByAccount.filter((e) => e.isCOGS).reduce((s, e) => s + e.amount, 0);
  const operatingExpenses = expensesByAccount.filter((e) => !e.isCOGS).reduce((s, e) => s + e.amount, 0);
  const totalExpenses = costOfGoodsSold + operatingExpenses;
  const grossProfit = totalRevenue - costOfGoodsSold;
  const netIncome = totalRevenue - totalExpenses;
  const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

  return {
    revenue: revenueByAccount,
    expenses: expensesByAccount,
    totalRevenue,
    totalExpenses,
    summary: { totalRevenue, costOfGoodsSold, grossProfit, operatingExpenses, netIncome, netMargin },
  };
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') ?? new Date().getFullYear().toString();
    const compare = searchParams.get('compare') === 'true';

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const current = await buildPeriodTotals(companyId, startDate, endDate);

    let prior = null;
    if (compare) {
      const priorYear = String(Number(year) - 1);
      const priorStart = new Date(`${priorYear}-01-01`);
      const priorEnd = new Date(`${priorYear}-12-31`);
      prior = { year: priorYear, ...(await buildPeriodTotals(companyId, priorStart, priorEnd)) };
    }

    return NextResponse.json({
      data: {
        period: { year, startDate, endDate },
        ...current,
        prior,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/profit-loss error:', error);
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 });
  }
}
