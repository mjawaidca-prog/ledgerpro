import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
    const asOfDate = new Date(asOf);
    const yearStart = new Date(asOfDate.getFullYear(), 0, 1);

    // Fetch all data in parallel
    const [
      incomeAccounts, expenseAccounts, assetAccounts, liabilityAccounts, equityAccounts,
      transactions, bankAccounts, invoices, bills,
    ] = await Promise.all([
      db.chartOfAccount.findMany({ where: { companyId, type: 'income', active: true }, select: { code: true, name: true, balance: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'expense', active: true }, select: { code: true, name: true, balance: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'asset', active: true }, select: { code: true, name: true, balance: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'liability', active: true }, select: { code: true, name: true, balance: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'equity', active: true }, select: { code: true, name: true, balance: true } }),
      db.transaction.findMany({
        where: { companyId, date: { gte: yearStart, lte: asOfDate }, status: { not: 'excluded' } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
      db.financialAccount.findMany({ where: { companyId, isActive: true }, select: { name: true, currentBalance: true, kind: true } }),
      db.invoice.findMany({ where: { companyId, status: { not: 'void' }, issueDate: { gte: yearStart, lte: asOfDate } }, select: { total: true, paidAmount: true, status: true } }),
      db.bill.findMany({ where: { companyId, status: { not: 'void' }, billDate: { gte: yearStart, lte: asOfDate } }, select: { total: true, paidAmount: true, status: true } }),
    ]);

    // ─── P&L ───
    const totalRevenue = incomeAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const totalExpenses = expenseAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const netIncome = totalRevenue - totalExpenses;

    const pnl = {
      revenue: incomeAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(Number(a.balance)) })),
      expenses: expenseAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(Number(a.balance)) })),
      totalRevenue: Math.round(totalRevenue),
      totalExpenses: Math.round(totalExpenses),
      netIncome: Math.round(netIncome),
    };

    // ─── Balance Sheet ───
    const totalAssets = assetAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = liabilityAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const totalEquity = equityAccounts.reduce((s, a) => s + Number(a.balance), 0) + netIncome;

    const bs = {
      assets: assetAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(Number(a.balance)) })),
      liabilities: liabilityAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(Number(a.balance)) })),
      equity: equityAccounts.map(a => ({ code: a.code, name: a.name, amount: Math.round(Number(a.balance)) })),
      retainedEarnings: Math.round(netIncome),
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities),
      totalEquity: Math.round(totalEquity + netIncome),
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

    // ─── Trial Balance ───
    const allAccounts = [
      ...incomeAccounts, ...expenseAccounts, ...assetAccounts, ...liabilityAccounts, ...equityAccounts,
    ];
    const tbRows = allAccounts.map(a => {
      const bal = Number(a.balance);
      return {
        code: a.code,
        name: a.name,
        debit: bal > 0 ? bal : 0,
        credit: bal < 0 ? Math.abs(bal) : 0,
      };
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
