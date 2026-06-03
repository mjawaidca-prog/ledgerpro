import { AppShell } from '@/components/layout/AppShell'
import { BillEditor } from '@/components/expenses/BillEditor'
import { createServerCaller } from '@/lib/trpc/trpc'

export type BillLine = {
  category: string
  description: string
  amount: number
}

export type BillData = {
  id: string
  kind: 'bill' | 'expense'
  vendorName: string
  vendorEmail?: string
  billNumber: string
  paymentTerms: string
  billDate: string
  dueDate: string
  memo: string
  taxRate: number
  lines: BillLine[]
  status: 'Draft' | 'Open' | 'Paid' | 'Overdue'
}

const FALLBACK_BILL: BillData = {
  id: 'new',
  kind: 'bill',
  vendorName: 'AWS',
  vendorEmail: 'accounts@amazon-aws.com',
  billNumber: 'BILL-2044',
  paymentTerms: 'net30',
  billDate: '2026-05-20',
  dueDate: '2026-06-19',
  memo: 'Monthly cloud infrastructure — auto-renews. Coded to Software.',
  taxRate: 8.5,
  status: 'Draft',
  lines: [
    { category: 'Software & subscriptions', description: 'Annual SaaS license renewal', amount: 1284.30 },
    { category: 'Professional fees', description: 'Implementation & onboarding', amount: 600.00 },
  ],
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function BillEditorPage({ params }: Props) {
  const { id } = await params
  const isNew = id === 'new'

  let bill: BillData = FALLBACK_BILL

  if (!isNew) {
    try {
      const caller = createServerCaller()
      const dbBill = await caller.expenses.getById({ id })
      if (dbBill) {
        bill = {
          id: dbBill.id,
          kind: dbBill.kind,
          vendorName: dbBill.vendorName,
          billNumber: dbBill.billNumber ?? '',
          paymentTerms: dbBill.paymentTerms ?? 'net30',
          billDate: dbBill.date,
          dueDate: dbBill.dueDate ?? '',
          memo: dbBill.memo ?? '',
          taxRate: dbBill.taxRate ?? 8.5,
          status: dbBill.status,
          lines: (dbBill.lines ?? []).map((l) => ({ ...l, description: l.description ?? '' })),
        }
      }
    } catch {
      // use fallback
    }
  }

  return (
    <AppShell>
      <BillEditor bill={bill} isNew={isNew} />
    </AppShell>
  )
}
