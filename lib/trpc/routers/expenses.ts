import { router, publicProcedure } from '../server'
import { z } from 'zod'
import { db } from '../../db'

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

// ── enum <-> UI label maps ────────────────────────────────────────────────────
const STATUS_LABEL = {
  draft: 'Draft',
  open: 'Open',
  paid: 'Paid',
  overdue: 'Overdue',
} as const
const STATUS_ENUM = {
  Draft: 'draft',
  Open: 'open',
  Paid: 'paid',
  Overdue: 'overdue',
} as const

type BillStatusEnum = keyof typeof STATUS_LABEL

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// "Chase Business Checking" + "4021" -> "Chase ••4021"
function payAccountLabel(
  account: { name: string; mask: string } | null | undefined,
): string {
  if (!account) return ''
  const short = account.name.split(' ')[0]
  return `${short} ••${account.mask}`
}

const billInclude = {
  vendor: true,
  category: true,
  paymentAccount: true,
} as const

type BillRecord = {
  id: string
  kind: 'bill' | 'expense'
  payee: string | null
  date: Date
  amount: { toNumber(): number }
  status: BillStatusEnum
  vendor: { name: string } | null
  category: { name: string } | null
  paymentAccount: { name: string; mask: string } | null
}

function toRow(b: BillRecord) {
  return {
    id: b.id,
    kind: b.kind,
    vendorName: b.vendor?.name ?? b.payee ?? '',
    category: b.category?.name ?? '',
    payAccount: payAccountLabel(b.paymentAccount),
    date: isoDate(b.date),
    amount: b.amount.toNumber(),
    status: STATUS_LABEL[b.status],
  }
}

// Resolve a human category name -> ChartOfAccountsEntry id (best effort)
async function resolveCategoryId(name?: string): Promise<string | null> {
  if (!name) return null
  const entry = await db.chartOfAccountsEntry.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  })
  return entry?.id ?? null
}

// Resolve a "Chase ••4021" style label -> Account id (best effort)
async function resolvePaymentAccountId(label?: string): Promise<string | null> {
  if (!label) return null
  const maskMatch = label.match(/(\d{3,})\s*$/)
  if (maskMatch) {
    const acc = await db.account.findFirst({ where: { mask: maskMatch[1] } })
    if (acc) return acc.id
  }
  const first = label.split(' ')[0]
  const acc = await db.account.findFirst({
    where: { name: { startsWith: first, mode: 'insensitive' } },
  })
  return acc?.id ?? null
}

// Resolve a vendor name -> Contact id (suppliers), else null (use payee)
async function resolveVendorId(name?: string): Promise<string | null> {
  if (!name) return null
  const contact = await db.contact.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  })
  return contact?.id ?? null
}

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
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}

      if (input?.kind) {
        where.kind = input.kind
      }

      if (input?.status && input.status !== 'All') {
        if (input.status === 'Unpaid bills') {
          where.kind = 'bill'
          where.status = { in: ['open', 'overdue'] }
        } else if (input.status === 'Overdue') {
          where.status = 'overdue'
        } else if (input.status === 'Paid') {
          where.status = 'paid'
        } else if (input.status === 'Expenses') {
          where.kind = 'expense'
        }
      }

      if (input?.search) {
        const q = input.search
        where.OR = [
          { payee: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } },
          { vendor: { name: { contains: q, mode: 'insensitive' } } },
          { category: { name: { contains: q, mode: 'insensitive' } } },
        ]
      }

      const rows = await db.bill.findMany({
        where,
        include: billInclude,
        orderBy: { date: 'desc' },
      })
      return rows.map((r) => toRow(r as BillRecord))
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const b = await db.bill.findUnique({
        where: { id: input.id },
        include: billInclude,
      })
      if (!b) return null
      const row = toRow(b as BillRecord)
      // Editor expects a richer shape; fields not stored in DB stay undefined
      return {
        ...row,
        dueDate: undefined as string | undefined,
        billNumber: undefined as string | undefined,
        paymentTerms: undefined as string | undefined,
        memo: undefined as string | undefined,
        taxRate: undefined as number | undefined,
        lines: [] as { category: string; description?: string; amount: number }[],
      }
    }),

  create: publicProcedure
    .input(ExpenseCreateInput)
    .mutation(async ({ input }) => {
      const [vendorId, categoryId, paymentAccountId] = await Promise.all([
        resolveVendorId(input.vendorName),
        resolveCategoryId(input.category),
        resolvePaymentAccountId(input.payAccount),
      ])
      const created = await db.bill.create({
        data: {
          id: input.id,
          kind: input.kind,
          vendorId,
          payee: vendorId ? null : input.vendorName,
          categoryId,
          paymentAccountId,
          date: new Date(input.date),
          amount: input.amount,
          status: STATUS_ENUM[input.status],
        },
        include: billInclude,
      })
      return toRow(created as BillRecord)
    }),

  update: publicProcedure
    .input(ExpenseUpdateInput)
    .mutation(async ({ input }) => {
      const existing = await db.bill.findUnique({ where: { id: input.id } })
      if (!existing) return null

      const data: Record<string, unknown> = {}
      if (input.kind) data.kind = input.kind
      if (input.date) data.date = new Date(input.date)
      if (input.amount !== undefined) data.amount = input.amount
      if (input.status) data.status = STATUS_ENUM[input.status]
      if (input.vendorName !== undefined) {
        const vendorId = await resolveVendorId(input.vendorName)
        data.vendorId = vendorId
        data.payee = vendorId ? null : input.vendorName
      }
      if (input.category !== undefined) {
        data.categoryId = await resolveCategoryId(input.category)
      }
      if (input.payAccount !== undefined) {
        data.paymentAccountId = await resolvePaymentAccountId(input.payAccount)
      }

      const updated = await db.bill.update({
        where: { id: input.id },
        data,
        include: billInclude,
      })
      return toRow(updated as BillRecord)
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await db.bill.findUnique({ where: { id: input.id } })
      if (!existing) return { success: false, reason: 'not_found' as const }
      await db.bill.delete({ where: { id: input.id } })
      return { success: true }
    }),

  stats: publicProcedure.query(async () => {
    const rows = await db.bill.findMany({ select: { kind: true, status: true, amount: true } })

    let unpaidBills = 0
    let overdue = 0
    let paidThisMonth = 0
    let totalExpenses = 0

    for (const r of rows) {
      const amt = r.amount.toNumber()
      totalExpenses += amt
      if (r.kind === 'bill' && (r.status === 'open' || r.status === 'overdue')) {
        unpaidBills += amt
      }
      if (r.status === 'overdue') overdue += amt
      if (r.status === 'paid') paidThisMonth += amt
    }

    return { unpaidBills, overdue, paidThisMonth, totalExpenses }
  }),
})
