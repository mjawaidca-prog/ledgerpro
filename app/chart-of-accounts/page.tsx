import { AppShell } from '@/components/layout/AppShell'
import { CoaContent } from '@/components/coa/CoaContent'
import { createServerCaller } from '@/lib/trpc/trpc'

export default async function ChartOfAccountsPage() {
  const caller = createServerCaller()

  let stats: Record<string, { count: number; total: number }> = {}

  try {
    stats = await caller.coa.stats()
  } catch {
    // use empty fallback
  }

  return (
    <AppShell>
      <CoaContent initialStats={stats} />
    </AppShell>
  )
}
