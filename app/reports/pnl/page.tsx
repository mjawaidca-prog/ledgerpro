import { AppShell } from '@/components/layout/AppShell'
import { PnlContent } from '@/components/reports/PnlContent'
import { createServerCaller } from '@/lib/trpc/trpc'

export default async function PnlPage() {
  let pnlData = null
  try {
    const api = createServerCaller()
    pnlData = await api.reports.pnl()
  } catch {
    // Fall back to hardcoded data in PnlContent
  }

  return (
    <AppShell>
      <PnlContent data={pnlData} />
    </AppShell>
  )
}
