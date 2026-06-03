import { AppShell } from '@/components/layout/AppShell'
import { InvoiceEditor } from '@/components/invoices/InvoiceEditor'
import { createServerCaller } from '@/lib/trpc/trpc'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function InvoiceEditorPage({ params }: PageProps) {
  const { id } = await params
  const isNew = id === 'new'

  const caller = createServerCaller()

  let initialData = null

  if (!isNew) {
    try {
      initialData = await caller.invoices.getById({ id })
    } catch {
      // use null
    }
  }

  return (
    <AppShell>
      <InvoiceEditor id={id} isNew={isNew} initialData={initialData} />
    </AppShell>
  )
}
