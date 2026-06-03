import { router, publicProcedure } from '../server'
import { z } from 'zod'

// In-memory store for banking demo data
type BankAccount = {
  id: string
  name: string
  mask: string
  kind: 'checking' | 'credit' | 'payout'
  currentBalance: number
  syncStatus: 'synced' | 'warning' | 'error'
  lastSyncedAt: string
}

type BankTransaction = {
  id: number
  status: 'to_review' | 'categorized' | 'excluded'
  date: string
  description: string
  accountId: string
  spent?: number
  received?: number
  suggestedCategory?: string
  category?: string
  matchRef?: string
  excludeReason?: string
}

const ACCOUNTS: BankAccount[] = [
  { id: 'chase', name: 'Chase Business Checking', mask: '••4021', kind: 'checking', currentBalance: 142580.00, syncStatus: 'synced', lastSyncedAt: '2 min ago' },
  { id: 'amex',  name: 'Amex Business',           mask: '••6700', kind: 'credit',   currentBalance: -8420.55,  syncStatus: 'synced', lastSyncedAt: '11 min ago' },
  { id: 'stripe',name: 'Stripe Payouts',          mask: '••9930', kind: 'payout',   currentBalance: 6961.55,   syncStatus: 'warning', lastSyncedAt: '6h ago' },
]

let TRANSACTIONS: BankTransaction[] = [
  // To review
  { id: 1,  status: 'to_review', date: '2026-05-18', description: 'Stripe payout',            accountId: 'stripe', received: 4820.00,  suggestedCategory: 'Sales income',  matchRef: '2 invoices' },
  { id: 2,  status: 'to_review', date: '2026-05-17', description: 'AWS',                       accountId: 'amex',   spent: 1284.30,     suggestedCategory: 'Software' },
  { id: 3,  status: 'to_review', date: '2026-05-16', description: 'WeWork',                    accountId: 'chase',  spent: 3500.00,     suggestedCategory: 'Rent & lease' },
  { id: 4,  status: 'to_review', date: '2026-05-15', description: 'Delta Air Lines',           accountId: 'amex',   spent: 642.40,      suggestedCategory: 'Travel & meals' },
  { id: 5,  status: 'to_review', date: '2026-05-14', description: 'Gusto',                     accountId: 'chase',  spent: 89.00,       suggestedCategory: 'Bank fees' },
  { id: 6,  status: 'to_review', date: '2026-05-13', description: 'Shopify payout',            accountId: 'stripe', received: 2140.55,  suggestedCategory: 'Sales income' },
  { id: 7,  status: 'to_review', date: '2026-05-12', description: 'Staples',                   accountId: 'amex',   spent: 142.18,      suggestedCategory: 'Office supplies' },
  { id: 8,  status: 'to_review', date: '2026-05-11', description: 'Comcast Business',          accountId: 'chase',  spent: 219.99,      suggestedCategory: 'Utilities' },
  { id: 9,  status: 'to_review', date: '2026-05-10', description: 'Payment — Vertex Partners', accountId: 'chase',  received: 23110.00, suggestedCategory: 'Sales income',  matchRef: 'INV-1044' },
  { id: 10, status: 'to_review', date: '2026-05-09', description: 'Adobe',                     accountId: 'amex',   spent: 599.88,      suggestedCategory: 'Software' },
  // Categorized
  { id: 11, status: 'categorized', date: '2026-05-08', description: 'Verizon',              accountId: 'amex',   spent: 180.00,     category: 'Utilities' },
  { id: 12, status: 'categorized', date: '2026-05-07', description: 'Payroll run',          accountId: 'chase',  spent: 18400.00,   category: 'Payroll' },
  { id: 13, status: 'categorized', date: '2026-05-06', description: 'Deposit — Summit Health', accountId: 'chase', received: 18200.00, category: 'Sales income', matchRef: 'INV-1045' },
  { id: 14, status: 'categorized', date: '2026-05-05', description: 'Uber',                 accountId: 'amex',   spent: 47.20,      category: 'Travel & meals' },
  { id: 15, status: 'categorized', date: '2026-05-04', description: 'Notion',               accountId: 'amex',   spent: 96.00,      category: 'Software' },
  // Excluded
  { id: 16, status: 'excluded', date: '2026-05-03', description: 'Owner transfer → savings', accountId: 'chase',  spent: 5000.00, excludeReason: 'Transfer' },
  { id: 17, status: 'excluded', date: '2026-05-02', description: 'Stripe payout (dup)',      accountId: 'stripe', received: 4820.00, excludeReason: 'Duplicate' },
]

export const bankingRouter = router({
  accounts: publicProcedure.query(() => {
    return ACCOUNTS
  }),

  transactions: publicProcedure
    .input(
      z.object({
        status: z.enum(['to_review', 'categorized', 'excluded']).optional(),
        accountId: z.string().optional(),
      }).optional(),
    )
    .query(({ input }) => {
      let rows = [...TRANSACTIONS]
      if (input?.status) {
        rows = rows.filter((r) => r.status === input.status)
      }
      if (input?.accountId) {
        rows = rows.filter((r) => r.accountId === input.accountId)
      }
      return rows
    }),

  acceptTransaction: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      const txn = TRANSACTIONS.find((t) => t.id === input.id)
      if (!txn) return { success: false }
      txn.status = 'categorized'
      if (txn.suggestedCategory && !txn.category) {
        txn.category = txn.suggestedCategory
      }
      return { success: true }
    }),

  excludeTransaction: publicProcedure
    .input(z.object({ id: z.number(), reason: z.string() }))
    .mutation(({ input }) => {
      const txn = TRANSACTIONS.find((t) => t.id === input.id)
      if (!txn) return { success: false }
      txn.status = 'excluded'
      txn.excludeReason = input.reason
      return { success: true }
    }),

  reconciliation: publicProcedure
    .input(z.object({ accountId: z.string() }))
    .query(({ input }) => {
      const account = ACCOUNTS.find((a) => a.id === input.accountId) ?? ACCOUNTS[0]
      const bankBalance = Math.abs(account.currentBalance)

      const toReview = TRANSACTIONS.filter(
        (t) => t.status === 'to_review' && t.accountId === input.accountId,
      )
      const remNet = toReview.reduce(
        (s, t) => s + ((t.received ?? 0) - (t.spent ?? 0)),
        0,
      )
      const bookBalance = bankBalance - remNet
      const difference = bankBalance - bookBalance

      const cleared = TRANSACTIONS.filter(
        (t) => t.status === 'categorized' && t.accountId === input.accountId,
      ).length + 132

      const uncleared = toReview.length

      return {
        bookBalance,
        bankBalance,
        cleared,
        uncleared,
        difference,
      }
    }),
})
