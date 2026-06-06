import { router, publicProcedure } from '../server'
import { db } from '../../db'

export const dashboardRouter = router({
  stats: publicProcedure.query(async () => {
    // Aggregate cash on hand from checking/savings accounts
    const cashAccounts = await db.account.findMany({
      where: { kind: { in: ['checking', 'savings', 'payout_clearing'] } },
    })
    const cashOnHand = cashAccounts.reduce(
      (sum: number, a) => sum + Number(a.currentBalance),
      0
    )

    // Income/expenses: use last 30 days so seed data (May 2026) is always included
    const now = new Date()
    const last30 = new Date(now)
    last30.setDate(last30.getDate() - 30)

    const incomeTransactions = await db.transaction.findMany({
      where: {
        date: { gte: last30 },
        amount: { gt: 0 },
        status: 'categorized',
      },
    })
    const incomeThisMonth = incomeTransactions.reduce(
      (sum: number, t) => sum + Number(t.amount),
      0
    )

    const expenseTransactions = await db.transaction.findMany({
      where: {
        date: { gte: last30 },
        amount: { lt: 0 },
        status: 'categorized',
      },
    })
    const expensesThisMonth = Math.abs(
      expenseTransactions.reduce((sum: number, t) => sum + Number(t.amount), 0)
    )

    const netProfit = incomeThisMonth - expensesThisMonth

    const snaps = await db.monthlySnapshot.findMany({
      orderBy: { periodKey: 'desc' },
      take: 2,
    })
    const cur = snaps[0]
    const prev = snaps[1]

    function pctChange(c: number, p: number) {
      if (!p) return { pct: 0, dir: 'up' as const }
      const pct = Math.abs(((c - p) / Math.abs(p)) * 100)
      return { pct: Math.round(pct * 10) / 10, dir: (c >= p ? 'up' : 'down') as 'up' | 'down' }
    }

    const cashDelta = prev
      ? pctChange(Number(cur?.cashOnHand ?? 0), Number(prev.cashOnHand))
      : { pct: 0, dir: 'up' as const }
    const incDelta = prev
      ? pctChange(Number(cur?.income ?? 0), Number(prev.income))
      : { pct: 0, dir: 'up' as const }
    const expDelta = prev
      ? pctChange(Number(cur?.expenses ?? 0), Number(prev.expenses))
      : { pct: 0, dir: 'up' as const }
    const curNet = Number(cur?.income ?? 0) - Number(cur?.expenses ?? 0)
    const prevNet = Number(prev?.income ?? 0) - Number(prev?.expenses ?? 0)
    const netDelta = prev
      ? pctChange(curNet, prevNet)
      : { pct: 0, dir: 'up' as const }
    const margin = incomeThisMonth > 0
      ? Math.round((netProfit / incomeThisMonth) * 1000) / 10
      : 0

    return {
      cashOnHand,
      incomeThisMonth,
      expensesThisMonth,
      netProfit,
      kpiDeltas: {
        cashOnHandPct: cashDelta.pct,
        cashOnHandDir: cashDelta.dir,
        incomePct: incDelta.pct,
        incomeDir: incDelta.dir,
        expensesPct: expDelta.pct,
        expensesDir: expDelta.dir,
        netProfitPct: netDelta.pct,
        netProfitDir: netDelta.dir,
        netProfitMargin: margin,
      },
    }
  }),

  recentTransactions: publicProcedure.query(async () => {
    // Posted (categorized) ledger activity for the dashboard feed
    const txns = await db.transaction.findMany({
      where: { status: 'categorized' },
      orderBy: { date: 'desc' },
      take: 7,
      include: {
        account: true,
        category: true,
      },
    })
    return txns
  }),

  invoicesNeedingAttention: publicProcedure.query(async () => {
    const invoices = await db.invoice.findMany({
      where: {
        status: { in: ['overdue', 'sent'] },
      },
      include: { customer: true },
      orderBy: { dueDate: 'asc' },
      take: 4,
    })
    return invoices
  }),

  cashflowChart: publicProcedure.query(async () => {
    // 8 months of cash-on-hand from monthly snapshots
    const snaps = await db.monthlySnapshot.findMany({
      orderBy: { periodKey: 'asc' },
    })
    return snaps.map((s) => ({ m: s.label, v: Number(s.cashOnHand) }))
  }),

  incomeExpenseChart: publicProcedure.query(async () => {
    // Last 6 months of income vs expense from monthly snapshots
    const snaps = await db.monthlySnapshot.findMany({
      orderBy: { periodKey: 'asc' },
    })
    return snaps.slice(-6).map((s) => ({
      m: s.label,
      inc: Number(s.income),
      exp: Number(s.expenses),
    }))
  }),
})
