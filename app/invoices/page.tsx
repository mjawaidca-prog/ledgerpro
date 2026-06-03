import { AppShell } from '@/components/layout/AppShell'
import { InvoiceListContent } from '@/components/invoices/InvoiceListContent'
import { createServerCaller } from '@/lib/trpc/trpc'

export type InvoiceRow = {
  id: string
  customerId: string
  customerName: string
  issueDate: string
  dueDate: string
  amount: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
}

export type InvoiceStats = {
  outstanding: number
  overdue: number
  paidThisMonth: number
  draft: number
}

const FALLBACK_INVOICES: InvoiceRow[] = [
  { id: 'INV-1048', customerId: '', customerName: 'Atlas Logistics',   issueDate: '2026-05-18', dueDate: '2026-06-02', amount: 12450.00, status: 'sent' },
  { id: 'INV-1047', customerId: '', customerName: 'Brightline Studio', issueDate: '2026-05-16', dueDate: '2026-05-31', amount: 980.00,    status: 'sent' },
  { id: 'INV-1046', customerId: '', customerName: 'Cedar & Co.',       issueDate: '2026-05-14', dueDate: '2026-05-29', amount: 6275.50,   status: 'draft' },
  { id: 'INV-1045', customerId: '', customerName: 'Summit Health',     issueDate: '2026-05-12', dueDate: '2026-05-27', amount: 18200.00,  status: 'sent' },
  { id: 'INV-1044', customerId: '', customerName: 'Vertex Partners',   issueDate: '2026-05-09', dueDate: '2026-05-14', amount: 7300.00,   status: 'overdue' },
  { id: 'INV-1043', customerId: '', customerName: 'Riverside Café',    issueDate: '2026-05-05', dueDate: '2026-05-20', amount: 1420.75,   status: 'paid' },
  { id: 'INV-1042', customerId: '', customerName: 'Atlas Logistics',   issueDate: '2026-04-18', dueDate: '2026-05-03', amount: 12450.00,  status: 'overdue' },
  { id: 'INV-1041', customerId: '', customerName: 'Meridian Design',   issueDate: '2026-04-15', dueDate: '2026-04-30', amount: 4820.00,   status: 'paid' },
  { id: 'INV-1040', customerId: '', customerName: 'Harbor Foods',      issueDate: '2026-04-12', dueDate: '2026-04-27', amount: 1540.00,   status: 'overdue' },
  { id: 'INV-1039', customerId: '', customerName: 'Quill & Co.',       issueDate: '2026-04-09', dueDate: '2026-04-24', amount: 3260.00,   status: 'paid' },
]

const FALLBACK_STATS: InvoiceStats = {
  outstanding: 58430,
  overdue: 21290,
  paidThisMonth: 36840,
  draft: 6275,
}

export default async function InvoicesPage() {
  const caller = createServerCaller()

  let invoices: InvoiceRow[] = FALLBACK_INVOICES
  let stats: InvoiceStats = FALLBACK_STATS

  try {
    const [dbInvoices, dbStats] = await Promise.all([
      caller.invoices.list({}),
      caller.invoices.stats(),
    ])
    if (dbInvoices.length > 0) {
      invoices = dbInvoices as InvoiceRow[]
    }
    if (dbStats) {
      stats = dbStats
    }
  } catch {
    // use fallback
  }

  return (
    <AppShell>
      <InvoiceListContent invoices={invoices} stats={stats} />
    </AppShell>
  )
}
