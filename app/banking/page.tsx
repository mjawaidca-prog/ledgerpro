import { AppShell } from '@/components/layout/AppShell'
import { BankingContent } from '@/components/banking/BankingContent'
import '@/app/banking/banking.css'

export default function BankingPage() {
  return (
    <AppShell>
      <BankingContent />
    </AppShell>
  )
}
