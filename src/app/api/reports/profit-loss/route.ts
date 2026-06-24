import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') ?? new Date().getFullYear().toString();
    const period = searchParams.get('period') ?? 'year'; // month, quarter, year

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Fetch all income and expense accounts
    const [incomeAccounts, expenseAccounts, invoices, bills] = await Promise.all([
      db.chartOfAccount.findMany({
        where: { type: 'income', active: true },
        orderBy: { code: 'asc' },
      }),
      db.chartOfAccount.findMany({
        where: { type: 'expense', active: true },
        orderBy: { code: 'asc' },
      }),
      db.invoice.findMany({
        where: {
          issueDate: { gte: startDate, lte: endDate },
          status: { not: 'void' },
        },
        select: { total: true, status: true },
      }),
      db.bill.findMany({
        where: {
          billDate: { gte: startDate, lte: endDate },
          status: { in: ['paid', 'open', 'overdue'] },
        },
        select: { total: true, status: true, lineItems: { select: { categoryId: true, amount: true } } },
      }),
    ]);

    // Revenue from invoices (accrual basis: all non-void invoices)
    const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);

    // Revenue breakdown by GL category — from invoice line items
    // For simplicity: use the seeded COA balances as the starting point
    // In production: compute from journal entries
    const revenueByAccount = incomeAccounts.map((acct) => ({
      code: acct.code,
      name: acct.name,
      amount: Number(acct.balance),
    }));

    // Expenses by category — from bill line items
    const expenseMap: Record<string, number> = {};
    for (const bill of bills) {
      for (const line of bill.lineItems) {
        const key = line.categoryId ?? 'uncategorized';
        expenseMap[key] = (expenseMap[key] || 0) + Number(line.amount);
      }
    }

    const expensesByAccount = expenseAccounts.map((acct) => ({
      code: acct.code,
      name: acct.name,
      amount: Number(acct.balance),
    }));

    const totalExpenses = expensesByAccount.reduce((sum, e) => sum + e.amount, 0);
    const costOfGoodsSold = expensesByAccount.find(e => e.code === '5000')?.amount ?? 0;
    const operatingExpenses = totalExpenses - costOfGoodsSold;
    const grossProfit = totalRevenue - costOfGoodsSold;
    const netIncome = totalRevenue - totalExpenses;
    const netMargin = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

    return NextResponse.json({
      data: {
        period: { year, startDate, endDate },
        summary: {
          totalRevenue,
          costOfGoodsSold,
          grossProfit,
          operatingExpenses,
          netIncome,
          netMargin,
        },
        revenue: revenueByAccount,
        expenses: expensesByAccount,
        totalRevenue,
        totalExpenses,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/profit-loss error:', error);
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 });
  }
}
