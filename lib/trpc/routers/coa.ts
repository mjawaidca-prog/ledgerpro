import { router, publicProcedure } from '../server'
import { z } from 'zod'
import { db } from '../../db'

// Account type ordering for the ledger view
const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'] as const

export type CoaAccount = {
  code: string
  name: string
  detail: string
  desc: string
  bal: number
  active: boolean
  isParent: boolean
  isSub: boolean
  typeKey: string
}

type CoaEntry = {
  code: string
  name: string
  type: string
  detailType: string
  description: string | null
  parentCode: string | null
  balance: { toNumber(): number }
  active: boolean
}

function toAccount(e: CoaEntry): CoaAccount {
  return {
    code: e.code,
    name: e.name,
    detail: e.detailType,
    desc: e.description ?? '',
    bal: e.balance.toNumber(),
    active: e.active,
    isParent: false,
    isSub: e.parentCode != null,
    typeKey: e.type,
  }
}

function sortByType(rows: CoaAccount[]): CoaAccount[] {
  return [...rows].sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.typeKey as (typeof TYPE_ORDER)[number])
    const tb = TYPE_ORDER.indexOf(b.typeKey as (typeof TYPE_ORDER)[number])
    if (ta !== tb) return ta - tb
    return a.code.localeCompare(b.code)
  })
}

export const coaRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          type: z.string().optional(),
          search: z.string().optional(),
          active: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}

      if (input?.type && input.type !== 'all') {
        where.type = input.type
      }
      if (input?.active && input.active !== 'all') {
        where.active = input.active === 'active'
      }
      if (input?.search) {
        const q = input.search
        where.OR = [
          { code: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { detailType: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ]
      }

      const entries = await db.chartOfAccountsEntry.findMany({ where })
      return sortByType(entries.map((e) => toAccount(e as CoaEntry)))
    }),

  setActive: publicProcedure
    .input(z.object({ code: z.string(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.chartOfAccountsEntry.update({
        where: { code: input.code },
        data: { active: input.active },
      })
      return { success: true }
    }),

  delete: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ input }) => {
      const entry = await db.chartOfAccountsEntry.findUnique({
        where: { code: input.code },
      })
      if (!entry) return { success: false, reason: 'not_found' as const }

      // Guard against deleting an account that still has activity
      const [txnCount, billCount] = await Promise.all([
        db.transaction.count({ where: { categoryId: entry.id } }),
        db.bill.count({ where: { categoryId: entry.id } }),
      ])
      if (txnCount > 0 || billCount > 0) {
        return { success: false, reason: 'in_use' as const }
      }

      await db.chartOfAccountsEntry.delete({ where: { code: input.code } })
      return { success: true }
    }),

  create: publicProcedure
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
        detailType: z.string().min(1),
        description: z.string().optional(),
        parentCode: z.string().optional(),
        balance: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const entry = await db.chartOfAccountsEntry.create({
        data: {
          code: input.code,
          name: input.name,
          type: input.type,
          detailType: input.detailType,
          description: input.description ?? null,
          parentCode: input.parentCode ?? null,
          balance: input.balance ?? 0,
        },
      })
      return toAccount(entry as CoaEntry)
    }),

  update: publicProcedure
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().optional(),
        detailType: z.string().optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { code, ...rest } = input
      const data: Record<string, unknown> = {}
      if (rest.name !== undefined) data.name = rest.name
      if (rest.detailType !== undefined) data.detailType = rest.detailType
      if (rest.description !== undefined) data.description = rest.description
      if (rest.active !== undefined) data.active = rest.active
      const entry = await db.chartOfAccountsEntry.update({
        where: { code },
        data,
      })
      return toAccount(entry as CoaEntry)
    }),

  stats: publicProcedure.query(async () => {
    const entries = await db.chartOfAccountsEntry.findMany({
      select: { type: true, balance: true },
    })
    const result: Record<string, { count: number; total: number }> = {}
    for (const t of TYPE_ORDER) result[t] = { count: 0, total: 0 }
    for (const e of entries) {
      const bucket = result[e.type] ?? (result[e.type] = { count: 0, total: 0 })
      bucket.count += 1
      bucket.total += e.balance.toNumber()
    }
    return result
  }),
})
