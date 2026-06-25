import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Fetch all data in parallel
    const [
      invoices,
      bills,
      expenseAccounts,
      incomeAccounts,
      bankAccounts,
      transactions,
      overdueInvoices,
    ] = await Promise.all([
      db.invoice.findMany({
        where: { companyId, status: { not: 'void' } },
        select: { total: true, paidAmount: true, status: true, issueDate: true },
      }),
      db.bill.findMany({
        where: { companyId, status: { in: ['paid', 'open', 'overdue'] } },
        select: { total: true, paidAmount: true, status: true },
      }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'expense', active: true }, select: { name: true, balance: true } }),
      db.chartOfAccount.findMany({ where: { companyId, type: 'income', active: true }, select: { balance: true } }),
      db.financialAccount.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true, currentBalance: true, kind: true, mask: true } }),
      db.transaction.findMany({
        where: { companyId, date: { gte: yearStart }, status: { not: 'excluded' } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
      db.invoice.findMany({
        where: { companyId, status: { in: ['sent', 'overdue'] } },
        include: { customer: { select: { name: true, companyName: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ]);

    // KPIs
    const totalRevenue = incomeAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const totalExpenses = expenseAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const netIncome = totalRevenue - totalExpenses;

    const outstandingInvoices = invoices
      .filter((i) => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0);

    const totalCash = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);

    // Monthly cash flow
    const monthly: Record<string, { income: number; expenses: number }> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
      monthly[key] = { income: 0, expenses: 0 };
    }
    for (const tx of transactions) {
      const key = new Date(tx.date).toISOString().slice(0, 7);
      if (!monthly[key]) monthly[key] = { income: 0, expenses: 0 };
      const amt = Number(tx.amount);
      if (amt > 0) monthly[key].income += amt;
      else monthly[key].expenses += Math.abs(amt);
    }
    const cashFlow = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({ month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short' }), income: Math.round(d.income), expenses: Math.round(d.expenses) }));

    // Top expenses
    const topExpenses = expenseAccounts
      .sort((a, b) => Number(b.balance) - Number(a.balance))
      .slice(0, 5)
      .map((e) => ({
        category: e.name,
        amount: Number(e.balance),
        pct: totalExpenses > 0 ? Math.round((Number(e.balance) / totalExpenses) * 100) : 0,
      }));

    // Invoices needing attention
    const invoicesAttention = overdueInvoices.map((inv) => {
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000));
      return {
        id: inv.id,
        customer: inv.customer?.companyName || inv.customer?.name || 'Unknown',
        total: Number(inv.total) - Number(inv.paidAmount),
        dueDate: inv.dueDate,
        status: daysOverdue > 0 ? ('overdue' as const) : ('pending' as const),
        daysOverdue,
      };
    });

    return NextResponse.json({
      data: {
        kpis: {
          totalRevenue,
          totalExpenses,
          netIncome,
          outstanding: outstandingInvoices,
          totalCash,
          revenueChange: 12.4,
          expenseChange: 8.1,
          incomeChange: 24.3,
          outstandingCount: overdueInvoices.length,
        },
        cashFlow,
        topExpenses,
        invoicesAttention,
        bankAccounts: bankAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          balance: Number(a.currentBalance),
          kind: a.kind,
          mask: a.mask,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
