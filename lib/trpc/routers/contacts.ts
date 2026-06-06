import { router, publicProcedure } from '../server'
import { z } from 'zod'
import { db } from '../../db'

const AVATAR_COLORS = [
  '#0f8a53', '#3074ef', '#4b5666', '#1f6feb', '#697587',
  '#ec912d', '#cf353c', '#b97c12', '#e0484e', '#16a063',
]

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function shape(c: {
  id: string
  name: string
  company: string | null
  type: string
  email: string | null
  phone: string | null
  outstandingBalance: { toNumber(): number } | number
  status: string
}) {
  return {
    id: c.id,
    name: c.name,
    company: c.company ?? '',
    type: c.type === 'customer' ? ('Customer' as const) : ('Supplier' as const),
    email: c.email ?? '',
    phone: c.phone ?? '',
    outstandingBalance:
      typeof c.outstandingBalance === 'number'
        ? c.outstandingBalance
        : c.outstandingBalance.toNumber(),
    status: c.status === 'active' ? ('Active' as const) : ('Inactive' as const),
    initials: initials(c.name),
    color: avatarColor(c.id),
  }
}

export const contactsRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          type: z.string().optional(),
          search: z.string().optional(),
          status: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}

      if (input?.type && input.type !== 'All') {
        where.type = input.type.toLowerCase()
      }
      if (input?.status && input.status !== 'All') {
        where.status = input.status.toLowerCase()
      }
      if (input?.search) {
        const q = input.search
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ]
      }

      const rows = await db.contact.findMany({
        where,
        orderBy: { name: 'asc' },
      })

      return rows.map(shape)
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        company: z.string().optional(),
        type: z.enum(['customer', 'supplier']),
        email: z.string().optional(),
        phone: z.string().optional(),
        status: z.enum(['active', 'inactive']).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const contact = await db.contact.create({
        data: {
          name: input.name,
          company: input.company ?? null,
          type: input.type,
          email: input.email ?? null,
          phone: input.phone ?? null,
          status: input.status ?? 'active',
        },
      })
      return shape(contact)
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        company: z.string().optional(),
        type: z.enum(['customer', 'supplier']).optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        status: z.enum(['active', 'inactive']).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input
      const updateData: Record<string, unknown> = {}
      if (data.name !== undefined) updateData.name = data.name
      if (data.company !== undefined) updateData.company = data.company || null
      if (data.type !== undefined) updateData.type = data.type
      if (data.email !== undefined) updateData.email = data.email || null
      if (data.phone !== undefined) updateData.phone = data.phone || null
      if (data.status !== undefined) updateData.status = data.status
      const contact = await db.contact.update({
        where: { id },
        data: updateData,
      })
      return shape(contact)
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const contact = await db.contact.findUnique({ where: { id: input.id } })
      if (!contact) return { success: false, reason: 'not_found' as const }

      const [invoiceCount, billCount] = await Promise.all([
        db.invoice.count({ where: { customerId: input.id } }),
        db.bill.count({ where: { vendorId: input.id } }),
      ])
      if (invoiceCount > 0 || billCount > 0) {
        return { success: false, reason: 'in_use' as const }
      }

      await db.contact.delete({ where: { id: input.id } })
      return { success: true }
    }),

  stats: publicProcedure.query(async () => {
    const rows = await db.contact.findMany()
    const shaped = rows.map(shape)
    const customers = shaped.filter((r) => r.type === 'Customer')
    const suppliers = shaped.filter((r) => r.type === 'Supplier')
    const customerBalance = customers.reduce((s, r) => s + r.outstandingBalance, 0)
    const supplierBalance = suppliers.reduce((s, r) => s + r.outstandingBalance, 0)
    return {
      total: shaped.length,
      customers: customers.length,
      suppliers: suppliers.length,
      customerBalance,
      supplierBalance,
      outstandingBalance: customerBalance - supplierBalance,
    }
  }),
})
