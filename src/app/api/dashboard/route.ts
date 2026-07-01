import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get('range') ?? 'year';

    const now = new Date();

    // Calculate date ranges
    function getPeriodRange(r: string): { start: Date; end: Date; priorStart: Date; priorEnd: Date } {
      let start: Date, end: Date, priorStart: Date, priorEnd: Date;
      end = now;

      switch (r) {
        case 'month': {
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          priorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          priorEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          break;
        }
        case 'quarter': {
          const q = Math.floor(now.getMonth() / 3);
          start = new Date(now.getFullYear(), q * 3, 1);
          const priorQ = q - 1 >= 0 ? q - 1 : 3;
          const priorYear = q - 1 >= 0 ? now.getFullYear() : now.getFullYear() - 1;
          priorStart = new Date(priorYear, priorQ * 3, 1);
          priorEnd = new Date(now.getFullYear(), q * 3, 0);
          break;
        }
        default: { // year
          start = new Date(now.getFullYear(), 0, 1);
          priorStart = new Date(now.getFullYear() - 1, 0, 1);
          priorEnd = new Date(now.getFullYear() - 1, 11, 31);
        }
      }

      return { start, end, priorStart, priorEnd };
    }

    const { start, end, priorStart, priorEnd } = getPeriodRange(rangeParam);

    // Fetch all data in parallel
    const [
      invoices,
      priorInvoices,
      expenseAccounts,
      incomeAccounts,
      bankAccounts,
      transactions,
      priorTransactions,
      recentJournalEntries,
      overdueInvoices,
      overdueCount,
      totalInvoiceCount,
    ] = await Promise.all([
      // Current period invoices
      db.invoice.findMany({
        where: { companyId, status: { not: 'void' }, issueDate: { gte: start } },
        select: { total: true, paidAmount: true, status: true, issueDate: true },
      }),
      // Prior period invoices (for delta)
      db.invoice.findMany({
        where: { companyId, status: { not: 'void' }, issueDate: { gte: priorStart, lte: priorEnd } },
        select: { total: true, paidAmount: true, status: true },
      }),
      // COA expense accounts
      db.chartOfAccount.findMany({ where: { companyId, type: 'expense', active: true }, select: { name: true, balance: true, code: true } }),
      // COA income accounts
      db.chartOfAccount.findMany({ where: { companyId, type: 'income', active: true }, select: { name: true, balance: true, code: true } }),
      // Bank accounts with unreconciled counts
      db.financialAccount.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true, name: true, currentBalance: true, kind: true, mask: true,
          syncStatus: true,
          _count: { select: { transactions: { where: { reconciledAt: null, status: { not: 'excluded' } } } } },
        },
      }),
      // Current period transactions (excluded filtered out)
      db.transaction.findMany({
        where: { companyId, date: { gte: start, lte: end }, status: { not: 'excluded' } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
      // Prior period transactions
      db.transaction.findMany({
        where: { companyId, date: { gte: priorStart, lte: priorEnd }, status: { not: 'excluded' } },
        select: { amount: true, date: true },
      }),
      // Recent journal entries
      db.journalEntry.findMany({
        where: { companyId },
        include: { lines: { select: { debit: true, credit: true, glAccountCode: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Overdue invoices
      db.invoice.findMany({
        where: { companyId, status: { in: ['sent', 'overdue'] }, dueDate: { lt: now } },
        include: { customer: { select: { name: true, companyName: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      db.invoice.count({ where: { companyId, status: { in: ['sent', 'overdue'] }, dueDate: { lt: now } } }),
      db.invoice.count({ where: { companyId, status: { not: 'void' } } }),
    ]);

    // ─── KPIs ───
    const currentRevenue = incomeAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const currentExpenses = expenseAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const netIncome = currentRevenue - currentExpenses;

    // Prior period KPIs for delta
    const priorRevenueInvoices = priorInvoices.filter(i => i.status === 'paid');
    const priorRevenue = priorRevenueInvoices.reduce((s, i) => s + Number(i.paidAmount), 0);
    const priorExpenseTransactions = priorTransactions.filter(t => Number(t.amount) < 0);
    const priorExpenses = priorExpenseTransactions.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    const revenueDelta = priorRevenue > 0 ? Math.round(((currentRevenue - priorRevenue) / priorRevenue) * 100) : null;
    const expenseDelta = priorExpenses > 0 ? Math.round(((currentExpenses - priorExpenses) / priorExpenses) * 100) : null;
    const incomeDelta = priorRevenue > 0 && priorExpenses > 0
      ? (priorRevenue - priorExpenses) > 0
        ? Math.round(((netIncome - (priorRevenue - priorExpenses)) / (priorRevenue - priorExpenses)) * 100)
        : null
      : null;

    const outstandingInvoices = invoices
      .filter(i => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + Number(i.total) - Number(i.paidAmount), 0);

    const totalCash = bankAccounts
      .filter(a => a.kind !== 'creditcard')
      .reduce((s, a) => s + Number(a.currentBalance), 0);
    const totalCreditCardDebt = bankAccounts
      .filter(a => a.kind === 'creditcard')
      .reduce((s, a) => s + Number(a.currentBalance), 0);

    // ─── Monthly Cash Flow ───
    const monthlyMap: Record<string, { income: number; expenses: number }> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`;
      monthlyMap[key] = { income: 0, expenses: 0 };
    }
    for (const tx of transactions) {
      const key = new Date(tx.date).toISOString().slice(0, 7);
      if (!monthlyMap[key]) monthlyMap[key] = { income: 0, expenses: 0 };
      const amt = Number(tx.amount);
      if (amt > 0) monthlyMap[key].income += amt;
      else monthlyMap[key].expenses += Math.abs(amt);
    }
    const cashFlow = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short' }),
        income: Math.round(d.income),
        expenses: Math.round(d.expenses),
      }));

    // ─── Top Expenses ───
    const topExpenses = expenseAccounts
      .sort((a, b) => Number(b.balance) - Number(a.balance))
      .slice(0, 5)
      .map(e => ({
        category: e.name,
        amount: Number(e.balance),
        pct: currentExpenses > 0 ? Math.round((Number(e.balance) / currentExpenses) * 100) : 0,
      }));

    // ─── Invoices Needing Attention ───
    const invoicesAttention = overdueInvoices.map(inv => {
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000));
      return {
        id: inv.id,
        customer: inv.customer?.companyName || inv.customer?.name || 'Unknown',
        total: Number(inv.total) - Number(inv.paidAmount),
        dueDate: inv.dueDate,
        status: (daysOverdue > 0 ? 'overdue' : 'pending') as 'overdue' | 'pending',
        daysOverdue,
      };
    });

    // ─── Recent Activity ───
    const recentActivity = recentJournalEntries.map(je => {
      const totalDebit = je.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = je.lines.reduce((s, l) => s + Number(l.credit), 0);
      const amount = totalDebit > 0 ? totalDebit : totalCredit;
      return {
        id: je.id,
        sourceType: je.sourceType,
        sourceId: je.sourceId,
        description: je.description,
        amount: Math.round(amount * 100) / 100,
        date: je.entryDate,
        createdAt: je.createdAt,
      };
    });

    return NextResponse.json({
      data: {
        kpis: {
          totalRevenue: Math.round(currentRevenue),
          totalExpenses: Math.round(currentExpenses),
          netIncome: Math.round(netIncome),
          outstanding: Math.round(outstandingInvoices),
          totalCash: Math.round(totalCash),
          totalCreditCardDebt: Math.round(totalCreditCardDebt),
          revenueChange: revenueDelta,
          expenseChange: expenseDelta,
          incomeChange: incomeDelta,
          outstandingCount: overdueCount,
          invoiceCount: totalInvoiceCount,
        },
        cashFlow,
        topExpenses,
        invoicesAttention,
        bankAccounts: bankAccounts.map(a => ({
          id: a.id,
          name: a.name,
          balance: Number(a.currentBalance),
          kind: a.kind,
          mask: a.mask,
          syncStatus: a.syncStatus,
          unreconciledCount: a._count.transactions,
        })),
        recentActivity,
        period: {
          range: rangeParam,
          start,
          end,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
