import { router, publicProcedure } from '../server'
import { db } from '../../db'
import { z } from 'zod'

const InvoiceLineInput = z.object({
  description: z.string(),
  subDescription: z.string().optional(),
  qty: z.number(),
  rate: z.number(),
  taxRate: z.number().default(0),
  amount: z.number(),
})

const InvoiceCreateInput = z.object({
  id: z.string(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  issueDate: z.string(),
  dueDate: z.string(),
  amount: z.number(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']).default('draft'),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(InvoiceLineInput),
})

const InvoiceUpdateInput = z.object({
  id: z.string(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  amount: z.number().optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(InvoiceLineInput).optional(),
})

// Resolve a customer by id or name; create the contact on the fly if needed.
async function resolveCustomerId(
  customerId?: string,
  customerName?: string,
): Promise<string> {
  if (customerId) {
    const byId = await db.contact.findUnique({ where: { id: customerId } })
    if (byId) return byId.id
  }
  if (customerName) {
    const byName = await db.contact.findFirst({
      where: { name: { equals: customerName, mode: 'insensitive' } },
    })
    if (byName) return byName.id
    const created = await db.contact.create({
      data: { name: customerName, company: customerName, type: 'customer', status: 'active' },
    })
    return created.id
  }
  throw new Error('A customer is required to save an invoice.')
}

export const invoicesRouter = router({
  list: publicProcedure
    .input(z.object({ status: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {}
      if (input?.status && input.status !== 'All' && input.status !== 'Unpaid') {
        where.status = input.status.toLowerCase()
      }
      if (input?.status === 'Unpaid') {
        where.status = { in: ['sent', 'overdue'] }
      }
      if (input?.search) {
        where.OR = [
          { id: { contains: input.search, mode: 'insensitive' } },
          { customer: { name: { contains: input.search, mode: 'insensitive' } } },
        ]
      }
      const invoices = await db.invoice.findMany({
        where,
        include: { customer: true },
        orderBy: { issueDate: 'desc' },
      })
      return invoices.map((inv) => ({
        id: inv.id,
        customerId: inv.customerId,
        customerName: (inv as unknown as { customer: { name: string } }).customer?.name ?? 'Unknown',
        issueDate: inv.issueDate instanceof Date ? inv.issueDate.toISOString().slice(0, 10) : String(inv.issueDate),
        dueDate: inv.dueDate instanceof Date ? inv.dueDate.toISOString().slice(0, 10) : String(inv.dueDate),
        amount: Number(inv.amount),
        status: inv.status,
      }))
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const inv = await db.invoice.findUnique({
        where: { id: input.id },
        include: { customer: true, lines: true },
      })
      if (!inv) return null
      const cust = (inv as unknown as { customer: { name: string; email: string | null } }).customer
      return {
        id: inv.id,
        customerId: inv.customerId,
        customerName: cust?.name ?? 'Unknown',
        customerEmail: cust?.email ?? '',
        issueDate: inv.issueDate instanceof Date ? inv.issueDate.toISOString().slice(0, 10) : String(inv.issueDate),
        dueDate: inv.dueDate instanceof Date ? inv.dueDate.toISOString().slice(0, 10) : String(inv.dueDate),
        amount: Number(inv.amount),
        status: inv.status,
        lines: inv.lines.map((l) => ({
          id: l.id,
          description: l.description,
          qty: Number(l.qty),
          rate: Number(l.rate),
          taxRate: Number(l.taxRate),
          amount: Number(l.amount),
        })),
      }
    }),

  create: publicProcedure
    .input(InvoiceCreateInput)
    .mutation(async ({ input }) => {
      const customerId = await resolveCustomerId(input.customerId, input.customerName)
      const invoice = await db.invoice.create({
        data: {
          id: input.id,
          customerId,
          issueDate: new Date(input.issueDate),
          dueDate: new Date(input.dueDate),
          amount: input.amount,
          status: input.status ?? 'draft',
          lines: {
            create: input.lines.map((l) => ({
              description: l.description,
              qty: l.qty,
              rate: l.rate,
              taxRate: l.taxRate,
              amount: l.amount,
            })),
          },
        },
      })
      return invoice
    }),

  update: publicProcedure
    .input(InvoiceUpdateInput)
    .mutation(async ({ input }) => {
      const { id, lines, ...rest } = input
      const data: Record<string, unknown> = {}
      if (rest.customerId !== undefined || rest.customerName !== undefined) {
        data.customerId = await resolveCustomerId(rest.customerId, rest.customerName)
      }
      if (rest.issueDate !== undefined) data.issueDate = new Date(rest.issueDate)
      if (rest.dueDate !== undefined) data.dueDate = new Date(rest.dueDate)
      if (rest.amount !== undefined) data.amount = rest.amount
      if (rest.status !== undefined) data.status = rest.status

      if (lines !== undefined) {
        await db.invoiceLine.deleteMany({ where: { invoiceId: id } })
        data.lines = {
          create: lines.map((l) => ({
            description: l.description,
            qty: l.qty,
            rate: l.rate,
            taxRate: l.taxRate,
            amount: l.amount,
          })),
        }
      }

      const invoice = await db.invoice.update({
        where: { id },
        data,
      })
      return invoice
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.invoiceLine.deleteMany({ where: { invoiceId: input.id } })
      await db.invoice.delete({ where: { id: input.id } })
      return { success: true }
    }),

  stats: publicProcedure.query(async () => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const all = await db.invoice.findMany()

    const outstanding = all
      .filter((i) => i.status === 'sent' || i.status === 'overdue')
      .reduce((s, i) => s + Number(i.amount), 0)

    const overdue = all
      .filter((i) => i.status === 'overdue')
      .reduce((s, i) => s + Number(i.amount), 0)

    const paidInvoices = await db.invoice.findMany({
      where: {
        status: 'paid',
        updatedAt: { gte: startOfMonth, lte: endOfMonth },
      },
    })
    const paidThisMonth = paidInvoices.reduce((s, i) => s + Number(i.amount), 0)

    const draftTotal = all
      .filter((i) => i.status === 'draft')
      .reduce((s, i) => s + Number(i.amount), 0)

    return { outstanding, overdue, paidThisMonth, draft: draftTotal }
  }),
})
