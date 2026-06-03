import { router, publicProcedure } from '../server'
import { z } from 'zod'

const ExpenseLineInput = z.object({
  category: z.string(),
  description: z.string().optional(),
  amount: z.number(),
})

const ExpenseCreateInput = z.object({
  id: z.string(),
  kind: z.enum(['bill', 'expense']),
  vendorName: z.string(),
  category: z.string(),
  payAccount: z.string(),
  date: z.string(),
  dueDate: z.string().optional(),
  billNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
  amount: z.number(),
  status: z.enum(['Draft', 'Open', 'Paid', 'Overdue']).default('Draft'),
  memo: z.string().optional(),
  taxRate: z.number().default(0),
  lines: z.array(ExpenseLineInput).optional(),
})

const ExpenseUpdateInput = z.object({
  id: z.string(),
  kind: z.enum(['bill', 'expense']).optional(),
  vendorName: z.string().optional(),
  category: z.string().optional(),
  payAccount: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional(),
  billNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
  amount: z.number().optional(),
  status: z.enum(['Draft', 'Open', 'Paid', 'Overdue']).optional(),
  memo: z.string().optional(),
  taxRate: z.number().optional(),
  lines: z.array(ExpenseLineInput).optional(),
})

// In-memory store for demo (no DB schema for expenses yet)
let EXPENSE_STORE: Array<{
  id: string
  kind: 'bill' | 'expense'
  vendorName: string
  category: string
  payAccount: string
  date: string
  dueDate?: string
  billNumber?: string
  paymentTerms?: string
  amount: number
  status: 'Draft' | 'Open' | 'Paid' | 'Overdue'
  memo?: string
  taxRate: number
  lines: Array<{ category: string; description?: string; amount: number }>
}> = [
  { id: 'BILL-2043', kind: 'bill',    date: '2026-05-20', vendorName: 'City Power & Light', category: 'Utilities',       payAccount: 'Chase ••4021', amount: 410.55,  status: 'Draft',   taxRate: 0, lines: [] },
  { id: 'BILL-2042', kind: 'bill',    date: '2026-05-18', vendorName: 'AWS',                 category: 'Software',        payAccount: 'Amex ••6700',  amount: 1284.30, status: 'Open',    taxRate: 0, lines: [] },
  { id: 'EXP-5510',  kind: 'expense', date: '2026-05-16', vendorName: 'WeWork',              category: 'Rent & lease',    payAccount: 'Chase ••4021', amount: 3500.00, status: 'Paid',    taxRate: 0, lines: [] },
  { id: 'BILL-2041', kind: 'bill',    date: '2026-05-15', vendorName: 'Gusto',               category: 'Payroll',         payAccount: 'Chase ••4021', amount: 89.00,   status: 'Paid',    taxRate: 0, lines: [] },
  { id: 'EXP-5508',  kind: 'expense', date: '2026-05-14', vendorName: 'Staples',             category: 'Office supplies', payAccount: 'Amex ••6700',  amount: 142.18,  status: 'Paid',    taxRate: 0, lines: [] },
  { id: 'BILL-2040', kind: 'bill',    date: '2026-05-12', vendorName: 'Comcast Business',    category: 'Utilities',       payAccount: 'Chase ••4021', amount: 219.99,  status: 'Overdue', taxRate: 0, lines: [] },
  { id: 'BILL-2039', kind: 'bill',    date: '2026-05-11', vendorName: 'Adobe',               category: 'Software',        payAccount: 'Amex ••6700',  amount: 599.88,  status: 'Open',    taxRate: 0, lines: [] },
  { id: 'EXP-5505',  kind: 'expense', date: '2026-05-10', vendorName: 'Delta Air Lines',     category: 'Travel & meals',  payAccount: 'Amex ••6700',  amount: 642.40,  status: 'Paid',    taxRate: 0, lines: [] },
  { id: 'BILL-2038', kind: 'bill',    date: '2026-05-08', vendorName: 'State Farm',          category: 'Insurance',       payAccount: 'Chase ••4021', amount: 1200.00, status: 'Overdue', taxRate: 0, lines: [] },
  { id: 'EXP-5502',  kind: 'expense', date: '2026-05-06', vendorName: 'Uber',                category: 'Travel & meals',  payAccount: 'Amex ••6700',  amount: 47.20,   status: 'Paid',    taxRate: 0, lines: [] },
]

export const expensesRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          search: z.string().optional(),
          kind: z.enum(['bill', 'expense']).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      let rows = [...EXPENSE_STORE]
      if (input?.status && input.status !== 'All') {
        if (input.status === 'Unpaid bills') {
          rows = rows.filter(
            (r) => r.kind === 'bill' && (r.status === 'Open' || r.status === 'Overdue'),
          )
        } else if (input.status === 'Overdue') {
          rows = rows.filter((r) => r.status === 'Overdue')
        } else if (input.status === 'Paid') {
          rows = rows.filter((r) => r.status === 'Paid')
        } else if (input.status === 'Expenses') {
          rows = rows.filter((r) => r.kind === 'expense')
        }
      }
      if (input?.kind) {
        rows = rows.filter((r) => r.kind === input.kind)
      }
      if (input?.search) {
        const q = input.search.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.vendorName.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q) ||
            (r.id && r.id.toLowerCase().includes(q)),
        )
      }
      return rows
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return EXPENSE_STORE.find((r) => r.id === input.id) ?? null
    }),

  create: publicProcedure
    .input(ExpenseCreateInput)
    .mutation(({ input }) => {
      const record = {
        ...input,
        kind: input.kind,
        status: input.status ?? 'Draft',
        taxRate: input.taxRate ?? 0,
        lines: input.lines ?? [],
      }
      EXPENSE_STORE.push(record)
      return record
    }),

  update: publicProcedure
    .input(ExpenseUpdateInput)
    .mutation(({ input }) => {
      const idx = EXPENSE_STORE.findIndex((r) => r.id === input.id)
      if (idx === -1) return null
      EXPENSE_STORE[idx] = { ...EXPENSE_STORE[idx], ...input } as typeof EXPENSE_STORE[0]
      return EXPENSE_STORE[idx]
    }),

  stats: publicProcedure.query(() => {
    const unpaidBills = EXPENSE_STORE.filter(
      (r) => r.kind === 'bill' && (r.status === 'Open' || r.status === 'Overdue'),
    ).reduce((s, r) => s + r.amount, 0)

    const overdue = EXPENSE_STORE.filter((r) => r.status === 'Overdue').reduce(
      (s, r) => s + r.amount,
      0,
    )

    const paidThisMonth = EXPENSE_STORE.filter((r) => r.status === 'Paid').reduce(
      (s, r) => s + r.amount,
      0,
    )

    const totalExpenses = EXPENSE_STORE.reduce((s, r) => s + r.amount, 0)

    return { unpaidBills, overdue, paidThisMonth, totalExpenses }
  }),
})
