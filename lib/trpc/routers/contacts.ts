import { router, publicProcedure } from '../server'
import { z } from 'zod'

const CONTACTS_DATA = [
  { id: '1', name: 'Marcus Webb',  company: 'Atlas Logistics',      type: 'Customer' as const, email: 'marcus.webb@atlaslogistics.com', phone: '(415) 555-0142', outstandingBalance: 24900.00, status: 'Active' as const,   initials: 'MW', color: '#0f8a53' },
  { id: '2', name: 'Priya Nair',   company: 'Summit Health',        type: 'Customer' as const, email: 'priya.nair@summithealth.org',   phone: '(617) 555-0119', outstandingBalance: 18200.00, status: 'Active' as const,   initials: 'PN', color: '#3074ef' },
  { id: '3', name: 'Tom Vega',     company: 'Vertex Partners',      type: 'Customer' as const, email: 't.vega@vertexpartners.com',     phone: '(312) 555-0173', outstandingBalance: 7300.00,  status: 'Active' as const,   initials: 'TV', color: '#4b5666' },
  { id: '4', name: 'Renee Park',   company: 'WeWork',               type: 'Supplier' as const, email: 'ar@wework.com',                 phone: '(646) 555-0111', outstandingBalance: 3500.00,  status: 'Active' as const,   initials: 'RP', color: '#1f6feb' },
  { id: '5', name: 'Harold Means', company: 'Harbor Foods',         type: 'Customer' as const, email: 'accounts@harborfoods.com',      phone: '(206) 555-0164', outstandingBalance: 1540.00,  status: 'Inactive' as const, initials: 'HM', color: '#697587' },
  { id: '6', name: 'Jordan Pike',  company: 'Amazon Web Services',  type: 'Supplier' as const, email: 'billing@aws.amazon.com',        phone: '(206) 555-0100', outstandingBalance: 1284.30,  status: 'Active' as const,   initials: 'JP', color: '#ec912d' },
  { id: '7', name: 'Carla Boyd',   company: 'State Farm',           type: 'Supplier' as const, email: 'billing@statefarm.com',         phone: '(309) 555-0177', outstandingBalance: 1200.00,  status: 'Inactive' as const, initials: 'CB', color: '#cf353c' },
  { id: '8', name: 'Dana Cho',     company: 'Brightline Studio',    type: 'Customer' as const, email: 'dana@brightlinestudio.com',     phone: '(212) 555-0188', outstandingBalance: 980.00,   status: 'Active' as const,   initials: 'DC', color: '#b97c12' },
  { id: '9', name: 'Sam Idris',    company: 'Adobe Inc.',           type: 'Supplier' as const, email: 'ar@adobe.com',                  phone: '(408) 555-0136', outstandingBalance: 599.88,   status: 'Active' as const,   initials: 'SI', color: '#e0484e' },
  { id: '10', name: 'Elena Ruiz',  company: 'Riverside Café',       type: 'Customer' as const, email: 'elena@riversidecafe.com',       phone: '(503) 555-0150', outstandingBalance: 0.00,     status: 'Active' as const,   initials: 'ER', color: '#16a063' },
]

export const contactsRouter = router({
  list: publicProcedure
    .input(z.object({
      type: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      let rows = [...CONTACTS_DATA]
      if (input?.type && input.type !== 'All') {
        rows = rows.filter((r) => r.type === input.type)
      }
      if (input?.status && input.status !== 'All') {
        rows = rows.filter((r) => r.status === input.status)
      }
      if (input?.search) {
        const q = input.search.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.company.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q),
        )
      }
      return rows
    }),

  stats: publicProcedure.query(() => {
    const customers = CONTACTS_DATA.filter((r) => r.type === 'Customer')
    const suppliers = CONTACTS_DATA.filter((r) => r.type === 'Supplier')
    const customerBalance = customers.reduce((s, r) => s + r.outstandingBalance, 0)
    const supplierBalance = suppliers.reduce((s, r) => s + r.outstandingBalance, 0)
    return {
      total: CONTACTS_DATA.length,
      customers: customers.length,
      suppliers: suppliers.length,
      customerBalance,
      supplierBalance,
      outstandingBalance: customerBalance - supplierBalance,
    }
  }),
})
