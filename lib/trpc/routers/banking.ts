import { router, publicProcedure } from '../server'
import { z } from 'zod'
import { db } from '../../db'

// ─── Shapes consumed by BankingContent ────────────────────────────────────────
export type BankAccountView = {
  id: string
  name: string
  mask: string
  logo: string
  logoColor: string
  balance: number
  balanceLabel: string
  syncStatus: 'ok' | 'warn'
  syncLabel: string
}

export type BankTxView = {
  id: number
  dbId: string
  st: 'review' | 'cat' | 'excl'
  date: string
  m: string
  acct: string
  spent?: number
  recv?: number
  sug?: string
  cat?: string
  match?: string
  reason?: string
}

// Map full CoA category names -> the short labels BankingContent colors
const CATEGORY_LABEL: Record<string, string> = {
  'Sales Income': 'Sales income',
  'Service Revenue': 'Sales income',
  'Other Income': 'Sales income',
  'Software & Subscriptions': 'Software',
  'Rent & Lease': 'Rent & lease',
  'Travel & Entertainment': 'Travel & meals',
  'Office Supplies': 'Office supplies',
  'Bank Charges & Fees': 'Bank fees',
  'Payroll Expense': 'Payroll',
  'Marketing & Advertising': 'Advertising',
}

function shortCategory(name?: string | null): string | undefined {
  if (!name) return undefined
  return CATEGORY_LABEL[name] ?? name
}

// Reverse: short label -> a representative full CoA name to resolve a category id
const LABEL_TO_COA: Record<string, string> = {
  'Sales income': 'Sales Income',
  Software: 'Software & Subscriptions',
  'Rent & lease': 'Rent & Lease',
  'Travel & meals': 'Travel & Entertainment',
  'Office supplies': 'Office Supplies',
  'Bank fees': 'Bank Charges & Fees',
  Payroll: 'Payroll Expense',
  Advertising: 'Marketing & Advertising',
  Utilities: 'Software & Subscriptions',
}

async function resolveCategoryId(label?: string): Promise<string | null> {
  if (!label) return null
  const target = LABEL_TO_COA[label] ?? label
  const entry = await db.chartOfAccountsEntry.findFirst({
    where: { name: { equals: target, mode: 'insensitive' } },
  })
  return entry?.id ?? null
}

const STATUS_VIEW = {
  to_review: 'review',
  categorized: 'cat',
  excluded: 'excl',
} as const

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function acctShort(name: string, mask: string): string {
  return `${name.split(' ')[0]} ••${mask}`
}

type AccountRow = {
  id: string
  name: string
  mask: string
  kind: string
  currentBalance: { toNumber(): number }
  syncStatus: string
  displayColor: string | null
  logoInitials: string | null
}

function toAccountView(a: AccountRow): BankAccountView {
  return {
    id: a.id,
    name: a.name,
    mask: `•••• ${a.mask}`,
    logo: a.logoInitials ?? a.name.slice(0, 2).toUpperCase(),
    logoColor: a.displayColor ?? '#4b5666',
    balance: a.currentBalance.toNumber(),
    balanceLabel: a.kind === 'payout_clearing' ? 'Pending payout' : 'Current balance',
    syncStatus: a.syncStatus === 'synced' ? 'ok' : 'warn',
    syncLabel: a.syncStatus === 'synced' ? 'Synced recently' : 'Syncs daily',
  }
}

export const bankingRouter = router({
  accounts: publicProcedure.query(async () => {
    const rows = await db.account.findMany({ orderBy: { glAccountCode: 'asc' } })
    return rows.map((r) => toAccountView(r as AccountRow))
  }),

  transactions: publicProcedure
    .input(
      z
        .object({
          status: z.enum(['to_review', 'categorized', 'excluded']).optional(),
          accountId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}
      if (input?.status) where.status = input.status
      if (input?.accountId) where.accountId = input.accountId

      const rows = await db.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { account: true, category: true, suggestedCategory: true },
      })

      return rows.map((t, i): BankTxView => {
        const amount = Number(t.amount)
        return {
          id: i + 1,
          dbId: t.id,
          st: STATUS_VIEW[t.status],
          date: isoDate(t.date),
          m: t.description,
          acct: acctShort(t.account.name, t.account.mask),
          spent: amount < 0 ? Math.abs(amount) : undefined,
          recv: amount > 0 ? amount : undefined,
          sug: shortCategory(t.suggestedCategory?.name),
          cat: shortCategory(t.category?.name),
          match: t.matchRef ?? undefined,
          reason: t.excludeReason ?? undefined,
        }
      })
    }),

  reconciliation: publicProcedure
    .input(z.object({ accountId: z.string() }).optional())
    .query(async ({ input }) => {
      const account = input?.accountId
        ? await db.account.findUnique({ where: { id: input.accountId } })
        : await db.account.findFirst({ where: { kind: 'checking' } })

      const bankBalance = account ? Math.abs(account.currentBalance.toNumber()) : 0

      const toReview = await db.transaction.findMany({
        where: {
          status: 'to_review',
          ...(account ? { accountId: account.id } : {}),
        },
      })
      const remNet = toReview.reduce((s, t) => s + Number(t.amount), 0)
      const bookBalance = bankBalance - remNet
      const difference = bankBalance - bookBalance

      const clearedCount =
        (await db.transaction.count({
          where: {
            status: 'categorized',
            ...(account ? { accountId: account.id } : {}),
          },
        })) + 132

      return {
        bookBalance,
        bankBalance,
        cleared: clearedCount,
        uncleared: toReview.length,
        difference,
      }
    }),

  // ── Mutations ───────────────────────────────────────────────────────────────
  acceptTransaction: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const txn = await db.transaction.findUnique({ where: { id: input.id } })
      if (!txn) return { success: false }
      await db.transaction.update({
        where: { id: input.id },
        data: {
          status: 'categorized',
          // promote the suggested category if none was set
          ...(txn.categoryId == null && txn.suggestedCategoryId != null
            ? { categoryId: txn.suggestedCategoryId }
            : {}),
        },
      })
      return { success: true }
    }),

  excludeTransaction: publicProcedure
    .input(z.object({ id: z.string(), reason: z.string().default('Manual') }))
    .mutation(async ({ input }) => {
      await db.transaction.update({
        where: { id: input.id },
        data: { status: 'excluded', excludeReason: input.reason },
      })
      return { success: true }
    }),

  reopenTransaction: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.transaction.update({
        where: { id: input.id },
        data: { status: 'to_review', excludeReason: null },
      })
      return { success: true }
    }),

  categorizeTransaction: publicProcedure
    .input(z.object({ id: z.string(), category: z.string() }))
    .mutation(async ({ input }) => {
      const categoryId = await resolveCategoryId(input.category)
      await db.transaction.update({
        where: { id: input.id },
        data: {
          status: 'categorized',
          ...(categoryId ? { categoryId } : {}),
        },
      })
      return { success: true }
    }),

  bulkAccept: publicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const txns = await db.transaction.findMany({
        where: { id: { in: input.ids }, status: 'to_review' },
      })
      await Promise.all(
        txns.map((t) =>
          db.transaction.update({
            where: { id: t.id },
            data: {
              status: 'categorized',
              ...(t.categoryId == null && t.suggestedCategoryId != null
                ? { categoryId: t.suggestedCategoryId }
                : {}),
            },
          }),
        ),
      )
      return { success: true, count: txns.length }
    }),

  bulkExclude: publicProcedure
    .input(z.object({ ids: z.array(z.string()), reason: z.string().default('Manual') }))
    .mutation(async ({ input }) => {
      await db.transaction.updateMany({
        where: { id: { in: input.ids } },
        data: { status: 'excluded', excludeReason: input.reason },
      })
      return { success: true, count: input.ids.length }
    }),

  importTransactions: publicProcedure
    .input(
      z.object({
        accountKey: z.string(),
        rows: z.array(
          z.object({
            date: z.string(),
            description: z.string(),
            merchant: z.string().optional(),
            amount: z.number(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const ACCT_MAP: Record<string, string> = {
        chase: 'acc-chase-4021',
        amex: 'acc-amex-6700',
        stripe: 'acc-stripe-9230',
      }
      let accountId = ACCT_MAP[input.accountKey]
      if (!accountId) {
        const acct = await db.account.findFirst({
          where: { name: { contains: input.accountKey, mode: 'insensitive' } },
        })
        accountId = acct?.id ?? ACCT_MAP.chase
      }

      const created = await Promise.all(
        input.rows.map((row) =>
          db.transaction.create({
            data: {
              accountId,
              date: new Date(row.date),
              description: row.description,
              merchant: row.merchant ?? null,
              amount: row.amount,
              status: 'to_review',
              source: 'csv',
            },
          }),
        ),
      )
      return { success: true, count: created.length }
    }),
})
