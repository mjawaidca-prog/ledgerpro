import { AppShell } from '@/components/layout/AppShell'
import { CoaContent } from '@/components/coa/CoaContent'
import { createServerCaller } from '@/lib/trpc/trpc'
import type { CoaAccount } from '@/lib/trpc/routers/coa'

export default async function ChartOfAccountsPage() {
  const caller = createServerCaller()

  let stats: Record<string, { count: number; total: number }> = {}
  let accounts: CoaAccount[] = []

  try {
    const [dbStats, dbAccounts] = await Promise.all([
      caller.coa.stats(),
      caller.coa.list({}),
    ])
    stats = dbStats
    accounts = dbAccounts
  } catch {
    // use empty fallback
  }

  return (
    <AppShell>
      <CoaContent initialStats={stats} accounts={accounts} />
    </AppShell>
  )
}
