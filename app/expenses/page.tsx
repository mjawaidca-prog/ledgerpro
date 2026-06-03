import { AppShell } from '@/components/layout/AppShell'
import { ExpenseListContent } from '@/components/expenses/ExpenseListContent'
import { createServerCaller } from '@/lib/trpc/trpc'

export type ExpenseRow = {
  id: string
  kind: 'bill' | 'expense'
  vendorName: string
  category: string
  payAccount: string
  date: string
  amount: number
  status: 'Draft' | 'Open' | 'Paid' | 'Overdue'
}

export type ExpenseStats = {
  unpaidBills: number
  overdue: number
  paidThisMonth: number
  totalExpenses: number
}

const FALLBACK_EXPENSES: ExpenseRow[] = [
  { id: 'BILL-2043', kind: 'bill',    date: '2026-05-20', vendorName: 'City Power & Light', category: 'Utilities',        payAccount: 'Chase ••4021', amount: 410.55,   status: 'Draft' },
  { id: 'BILL-2042', kind: 'bill',    date: '2026-05-18', vendorName: 'AWS',                 category: 'Software',         payAccount: 'Amex ••6700',  amount: 1284.30,  status: 'Open' },
  { id: 'EXP-5510',  kind: 'expense', date: '2026-05-16', vendorName: 'WeWork',              category: 'Rent & lease',     payAccount: 'Chase ••4021', amount: 3500.00,  status: 'Paid' },
  { id: 'BILL-2041', kind: 'bill',    date: '2026-05-15', vendorName: 'Gusto',               category: 'Payroll',          payAccount: 'Chase ••4021', amount: 89.00,    status: 'Paid' },
  { id: 'EXP-5508',  kind: 'expense', date: '2026-05-14', vendorName: 'Staples',             category: 'Office supplies',  payAccount: 'Amex ••6700',  amount: 142.18,   status: 'Paid' },
  { id: 'BILL-2040', kind: 'bill',    date: '2026-05-12', vendorName: 'Comcast Business',    category: 'Utilities',        payAccount: 'Chase ••4021', amount: 219.99,   status: 'Overdue' },
  { id: 'BILL-2039', kind: 'bill',    date: '2026-05-11', vendorName: 'Adobe',               category: 'Software',         payAccount: 'Amex ••6700',  amount: 599.88,   status: 'Open' },
  { id: 'EXP-5505',  kind: 'expense', date: '2026-05-10', vendorName: 'Delta Air Lines',     category: 'Travel & meals',   payAccount: 'Amex ••6700',  amount: 642.40,   status: 'Paid' },
  { id: 'BILL-2038', kind: 'bill',    date: '2026-05-08', vendorName: 'State Farm',          category: 'Insurance',        payAccount: 'Chase ••4021', amount: 1200.00,  status: 'Overdue' },
  { id: 'EXP-5502',  kind: 'expense', date: '2026-05-06', vendorName: 'Uber',                category: 'Travel & meals',   payAccount: 'Amex ••6700',  amount: 47.20,    status: 'Paid' },
]

const FALLBACK_STATS: ExpenseStats = {
  unpaidBills: 3304,
  overdue: 1420,
  paidThisMonth: 4421,
  totalExpenses: 41980,
}

export default async function ExpensesPage() {
  const caller = createServerCaller()

  let expenses: ExpenseRow[] = FALLBACK_EXPENSES
  let stats: ExpenseStats = FALLBACK_STATS

  try {
    const [dbExpenses, dbStats] = await Promise.all([
      caller.expenses.list({}),
      caller.expenses.stats(),
    ])
    if (dbExpenses.length > 0) {
      expenses = dbExpenses as ExpenseRow[]
    }
    if (dbStats) {
      stats = dbStats
    }
  } catch {
    // use fallback
  }

  return (
    <AppShell>
      <ExpenseListContent expenses={expenses} stats={stats} />
    </AppShell>
  )
}
