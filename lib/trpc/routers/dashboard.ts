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

    // Income this month: positive transactions in current month
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const incomeTransactions = await db.transaction.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        amount: { gt: 0 },
        status: { not: 'excluded' },
      },
    })
    const incomeThisMonth = incomeTransactions.reduce(
      (sum: number, t) => sum + Number(t.amount),
      0
    )

    const expenseTransactions = await db.transaction.findMany({
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        amount: { lt: 0 },
        status: { not: 'excluded' },
      },
    })
    const expensesThisMonth = Math.abs(
      expenseTransactions.reduce((sum: number, t) => sum + Number(t.amount), 0)
    )

    const netProfit = incomeThisMonth - expensesThisMonth

    return {
      cashOnHand,
      incomeThisMonth,
      expensesThisMonth,
      netProfit,
      kpiDeltas: {
        cashOnHandPct: 8.5,
        cashOnHandDir: 'up' as const,
        incomePct: 12.4,
        incomeDir: 'up' as const,
        expensesPct: 3.3,
        expensesDir: 'down' as const,
        netProfitPct: 9.8,
        netProfitDir: 'up' as const,
        netProfitMargin: 50.1,
      },
    }
  }),

  recentTransactions: publicProcedure.query(async () => {
    const txns = await db.transaction.findMany({
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
    // Return 8 months of cash-on-hand snapshot data
    return [
      { m: 'Oct', v: 96400 },
      { m: 'Nov', v: 102300 },
      { m: 'Dec', v: 88100 },
      { m: 'Jan', v: 109600 },
      { m: 'Feb', v: 118200 },
      { m: 'Mar', v: 112900 },
      { m: 'Apr', v: 131400 },
      { m: 'May', v: 142580 },
    ]
  }),

  incomeExpenseChart: publicProcedure.query(async () => {
    // Return 6 months of income vs expense data
    return [
      { m: 'Dec', inc: 61200, exp: 39800 },
      { m: 'Jan', inc: 72400, exp: 44100 },
      { m: 'Feb', inc: 69800, exp: 41200 },
      { m: 'Mar', inc: 78600, exp: 46900 },
      { m: 'Apr', inc: 80100, exp: 43400 },
      { m: 'May', inc: 84210, exp: 41980 },
    ]
  }),
})
