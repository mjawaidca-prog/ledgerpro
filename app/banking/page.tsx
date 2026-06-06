import { AppShell } from '@/components/layout/AppShell'
import { BankingContent } from '@/components/banking/BankingContent'
import { createServerCaller } from '@/lib/trpc/trpc'
import type { BankAccountView, BankTxView } from '@/lib/trpc/routers/banking'
import '@/app/banking/banking.css'

export default async function BankingPage() {
  const caller = createServerCaller()

  let accounts: BankAccountView[] = []
  let transactions: BankTxView[] = []

  try {
    const [dbAccounts, dbTxns] = await Promise.all([
      caller.banking.accounts(),
      caller.banking.transactions(),
    ])
    accounts = dbAccounts
    transactions = dbTxns
  } catch {
    // BankingContent falls back to its built-in sample data
  }

  return (
    <AppShell>
      <BankingContent accounts={accounts} initialTransactions={transactions} />
    </AppShell>
  )
}
