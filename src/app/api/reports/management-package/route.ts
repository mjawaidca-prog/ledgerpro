import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, normalBalance, toDebitCredit, endOfDay } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
    const asOfDate = endOfDay(new Date(asOf));
    const yearStart = new Date(new Date(asOf).getFullYear(), 0, 1);

    const [
      incomeAccounts, expenseAccounts, assetAccounts, liabilityAccounts, equityAccounts,
      transactions, bankAccounts, invoices, bills,
      periodActivity, cumulativeActivity,
    ] = await Promise.all([
      db.chartOfAccount.findMany({ where: { companyId, type: 'income', active: true }, select: { code: true, name: true, type: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'expense', active: true }, select: { code: true, name: true, type: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'asset', active: true }, select: { code: true, name: true, type: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'liability', active: true }, select: { code: true, name: true, type: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'equity', active: true }, select: { code: true, name: true, type: true } }),
      db.transaction.findMany({
        where: { companyId, date: { gte: yearStart, lte: asOfDate }, status: { not: 'excluded' } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
      db.financialAccount.findMany({ where: { companyId, isActive: true }, select: { name: true, currentBalance: true, kind: true } }),
      db.invoice.findMany({ where: { companyId, status: { not: 'void' }, issueDate: { gte: yearStart, lte: asOfDate } }, select: { total: true, paidAmount: true, status: true } }),
      db.bill.findMany({ where: { companyId, status: { not: 'void' }, billDate: { gte: yearStart, lte: asOfDate } }, select: { total: true, paidAmount: true, status: true } }),
      // Income/expense are period flows (this fiscal year to date)
      getGLActivity(companyId, { from: yearStart, to: asOfDate }),
      // Assets/liabilities/equity are cumulative balances (since inception, as of the date)
      getGLActivity(companyId, { to: asOfDate }),
    ]);

    // ─── P&L (period-scoped) ───
    const revenueRows = incomeAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(normalBalance(a.type, periodActivity[a.code])) }));
    const expenseRows = expenseAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(normalBalance(a.type, periodActivity[a.code])) }));
    const totalRevenue = revenueRows.reduce((s, a) => s + a.amount, 0);
    const totalExpenses = expenseRows.reduce((s, a) => s + a.amount, 0);
    const netIncome = totalRevenue - totalExpenses;

    const pnl = {
      revenue: revenueRows,
      expenses: expenseRows,
      totalRevenue: Math.round(totalRevenue),
      totalExpenses: Math.round(totalExpenses),
      netIncome: Math.round(netIncome),
    };

    // ─── Balance Sheet (cumulative as of asOfDate) ───
    const assetRows = assetAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(normalBalance(a.type, cumulativeActivity[a.code])) }));
    const liabilityRows = liabilityAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(normalBalance(a.type, cumulativeActivity[a.code])) }));
    const equityRows = equityAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(normalBalance(a.type, cumulativeActivity[a.code])) }));
    const totalAssets = assetRows.reduce((s, a) => s + a.amount, 0);
    const totalLiabilities = liabilityRows.reduce((s, a) => s + a.amount, 0);
    const totalEquityAccounts = equityRows.reduce((s, a) => s + a.amount, 0);

    const bs = {
      assets: assetRows,
      liabilities: liabilityRows,
      equity: equityRows,
      retainedEarnings: Math.round(netIncome),
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities),
      // This is the page's "Total Liabilities + Equity" line — the full right-hand
      // side of the accounting equation, including current-year earnings not yet
      // closed to retained earnings. It should equal totalAssets above.
      totalEquity: Math.round(totalLiabilities + totalEquityAccounts + netIncome),
    };

    // ─── Cash Flow ───
    const monthlyMap: Record<string, { inflow: number; outflow: number }> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${asOfDate.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
      monthlyMap[key] = { inflow: 0, outflow: 0 };
    }
    for (const tx of transactions) {
      const key = new Date(tx.date).toISOString().slice(0, 7);
      if (!monthlyMap[key]) monthlyMap[key] = { inflow: 0, outflow: 0 };
      const amt = Number(tx.amount);
      if (amt > 0) monthlyMap[key].inflow += amt;
      else monthlyMap[key].outflow += Math.abs(amt);
    }
    const cashFlow = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short' }),
        inflow: Math.round(d.inflow),
        outflow: Math.round(d.outflow),
        netFlow: Math.round(d.inflow - d.outflow),
      }));

    const totalInflow = cashFlow.reduce((s, m) => s + m.inflow, 0);
    const totalOutflow = cashFlow.reduce((s, m) => s + m.outflow, 0);
    const netCashFlow = totalInflow - totalOutflow;

    // ─── Trial Balance (cumulative as of asOfDate, correct per-type debit/credit side) ───
    const allAccounts = [
      ...incomeAccounts, ...expenseAccounts, ...assetAccounts, ...liabilityAccounts, ...equityAccounts,
    ];
    const tbRows = allAccounts.map(a => {
      // Income/expense TB balances reflect the same fiscal-year-to-date activity as the P&L above.
      const isFlowAccount = a.type === 'income' || a.type === 'expense';
      const { debit, credit } = toDebitCredit(a.type, (isFlowAccount ? periodActivity : cumulativeActivity)[a.code]);
      return { code: a.code, name: a.name, debit: Math.round(debit), credit: Math.round(credit) };
    });
    const totalDebits = tbRows.reduce((s, r) => s + r.debit, 0);
    const totalCredits = tbRows.reduce((s, r) => s + r.credit, 0);

    return NextResponse.json({
      data: {
        asOf,
        profitLoss: pnl,
        balanceSheet: bs,
        cashFlow: { months: cashFlow, totalInflow: Math.round(totalInflow), totalOutflow: Math.round(totalOutflow), netCashFlow: Math.round(netCashFlow) },
        trialBalance: { rows: tbRows, totalDebits: Math.round(totalDebits), totalCredits: Math.round(totalCredits) },
        bankAccounts: bankAccounts.map(a => ({ name: a.name, balance: Number(a.currentBalance), kind: a.kind })),
        summary: {
          outstandingInvoices: invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0),
          outstandingBills: bills.filter(b => b.status === 'open' || b.status === 'overdue').reduce((s, b) => s + Number(b.total) - Number(b.paidAmount), 0),
        },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/management-package error:', error);
    return NextResponse.json({ error: 'Failed to generate management package' }, { status: 500 });
  }
}
