import { AppShell } from '@/components/layout/AppShell'
import { DashboardContent } from '@/components/dashboard/DashboardContent'
import { createServerCaller } from '@/lib/trpc/trpc'

type TxnRow = {
  id: string
  date: string
  dateLabel: string
  description: string
  category: string
  categoryColor: string
  account: string
  amount: number
  amountDisplay: string
}

type AttentionInvoice = {
  id: string
  clientName: string
  clientInitials: string
  clientColor: string
  invoiceId: string
  dueLabel: string
  amount: string
  badgeClass: 'badge-overdue' | 'badge-pending'
  badgeText: string
}

const FALLBACK_STATS = {
  cashOnHand: 142580,
  incomeThisMonth: 84210,
  expensesThisMonth: 41980,
  netProfit: 42230,
  kpiDeltas: {
    cashOnHandPct: 8.5,
    cashOnHandDir: 'up' as const,
    incomePct: 12.4,
    incomeDir: 'up' as const,
    expensesPct: 3.3,
    expensesDir: 'down' as const,
    netProfitPct: 9.8,
    netProfitDir: 'up' as const,
    netProfitMargin: 50.1,
  },
}

const FALLBACK_CASHFLOW = [
  { m: 'Oct', v: 96400 }, { m: 'Nov', v: 102300 }, { m: 'Dec', v: 88100 },
  { m: 'Jan', v: 109600 }, { m: 'Feb', v: 118200 }, { m: 'Mar', v: 112900 },
  { m: 'Apr', v: 131400 }, { m: 'May', v: 142580 },
]

const FALLBACK_IE = [
  { m: 'Dec', inc: 61200, exp: 39800 }, { m: 'Jan', inc: 72400, exp: 44100 },
  { m: 'Feb', inc: 69800, exp: 41200 }, { m: 'Mar', inc: 78600, exp: 46900 },
  { m: 'Apr', inc: 80100, exp: 43400 }, { m: 'May', inc: 84210, exp: 41980 },
]

const FALLBACK_TXNS: TxnRow[] = [
  { id: '1', date: '2026-05-12', dateLabel: 'May 12', description: 'Stripe payout', category: 'Sales income', categoryColor: 'var(--success)', account: 'Chase ••4021', amount: 4820, amountDisplay: '+$4,820.00' },
  { id: '2', date: '2026-05-11', dateLabel: 'May 11', description: 'AWS — cloud hosting', category: 'Software', categoryColor: 'var(--accent)', account: 'Amex ••6700', amount: -1284.30, amountDisplay: '−$1,284.30' },
  { id: '3', date: '2026-05-10', dateLabel: 'May 10', description: 'Office rent — May', category: 'Rent & lease', categoryColor: 'var(--warning)', account: 'Chase ••4021', amount: -3500, amountDisplay: '−$3,500.00' },
  { id: '4', date: '2026-05-09', dateLabel: 'May 9', description: 'Payment — Vertex Partners', category: 'Sales income', categoryColor: 'var(--success)', account: 'Chase ••4021', amount: 23110, amountDisplay: '+$23,110.00' },
  { id: '5', date: '2026-05-07', dateLabel: 'May 7', description: 'Payroll — bi-weekly', category: 'Payroll', categoryColor: 'var(--text-faint)', account: 'Chase ••4021', amount: -18400, amountDisplay: '−$18,400.00' },
  { id: '6', date: '2026-05-05', dateLabel: 'May 5', description: 'Shopify payout', category: 'Sales income', categoryColor: 'var(--success)', account: 'Chase ••4021', amount: 2140.55, amountDisplay: '+$2,140.55' },
  { id: '7', date: '2026-05-04', dateLabel: 'May 4', description: 'Staples — supplies', category: 'Office supplies', categoryColor: 'var(--accent)', account: 'Amex ••6700', amount: -142.18, amountDisplay: '−$142.18' },
]

const FALLBACK_INVOICES: AttentionInvoice[] = [
  { id: 'INV-1042', clientName: 'Atlas Logistics', clientInitials: 'AL', clientColor: '#0f8a53', invoiceId: 'INV-1042', dueLabel: 'due May 3', amount: '$12,450.00', badgeClass: 'badge-overdue', badgeText: '14d overdue' },
  { id: 'INV-1038', clientName: 'Harbor Foods', clientInitials: 'HF', clientColor: '#3074ef', invoiceId: 'INV-1038', dueLabel: 'due Apr 27', amount: '$1,540.00', badgeClass: 'badge-overdue', badgeText: '30d overdue' },
  { id: 'INV-1037', clientName: 'Vertex Partners', clientInitials: 'VP', clientColor: '#4b5666', invoiceId: 'INV-1037', dueLabel: 'due May 14', amount: '$7,300.00', badgeClass: 'badge-overdue', badgeText: '3d overdue' },
  { id: 'INV-1041', clientName: 'Brightline Studio', clientInitials: 'BS', clientColor: '#b97c12', invoiceId: 'INV-1041', dueLabel: 'due May 24', amount: '$980.00', badgeClass: 'badge-pending', badgeText: 'Due in 5d' },
]

function fmt(v: number) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default async function DashboardPage() {
  const caller = createServerCaller()

  try {
    const [stats, dbTxns, cashflowData, incomeExpenseData, dbInvoices] = await Promise.all([
      caller.dashboard.stats(),
      caller.dashboard.recentTransactions(),
      caller.dashboard.cashflowChart(),
      caller.dashboard.incomeExpenseChart(),
      caller.dashboard.invoicesNeedingAttention(),
    ])

    const txnRows: TxnRow[] = dbTxns.length > 0
      ? dbTxns.map((t) => {
          const amt = Number(t.amount)
          const date = new Date(t.date)
          const acct = (t as unknown as { account: { name: string; mask: string } | null }).account
          return {
            id: t.id,
            date: t.date instanceof Date ? t.date.toISOString().slice(0, 10) : String(t.date),
            dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            description: t.description,
            category: (t as unknown as { category: { name: string } | null }).category?.name ?? 'Uncategorized',
            categoryColor: amt >= 0 ? 'var(--success)' : 'var(--accent)',
            account: acct ? `${acct.name.split(' ')[0]} ••${acct.mask}` : '—',
            amount: amt,
            amountDisplay: amt >= 0 ? `+${fmt(amt)}` : `−${fmt(Math.abs(amt))}`,
          }
        })
      : FALLBACK_TXNS

    const attentionInvoices: AttentionInvoice[] = dbInvoices.length > 0
      ? dbInvoices.map((inv) => {
          const dueDate = new Date(inv.dueDate)
          const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86400000)
          const isOverdue = daysOverdue > 0
          const cust = (inv as unknown as { customer: { name: string } | null }).customer
          const name = cust?.name ?? 'Unknown'
          return {
            id: inv.id,
            clientName: name,
            clientInitials: name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
            clientColor: '#4b5666',
            invoiceId: inv.id,
            dueLabel: `due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            amount: `$${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            badgeClass: isOverdue ? ('badge-overdue' as const) : ('badge-pending' as const),
            badgeText: isOverdue ? `${daysOverdue}d overdue` : `Due in ${Math.abs(daysOverdue)}d`,
          }
        })
      : FALLBACK_INVOICES

    return (
      <AppShell>
        <DashboardContent
          stats={stats}
          cashflowData={cashflowData}
          incomeExpenseData={incomeExpenseData}
          txnRows={txnRows}
          attentionInvoices={attentionInvoices}
        />
      </AppShell>
    )
  } catch {
    // Fallback to prototype data when DB is not available
    return (
      <AppShell>
        <DashboardContent
          stats={FALLBACK_STATS}
          cashflowData={FALLBACK_CASHFLOW}
          incomeExpenseData={FALLBACK_IE}
          txnRows={FALLBACK_TXNS}
          attentionInvoices={FALLBACK_INVOICES}
        />
      </AppShell>
    )
  }
}
