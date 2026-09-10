import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { HelpCenter } from '@/components/help/HelpCenter';

export const metadata: Metadata = {
  title: 'Help Center | LedgerPro',
  description: 'Search LedgerPro guidance for bookkeeping, banking, Canadian tax, reporting, controls, and security.',
};

export default function HelpPage() {
  return (
    <AppShell>
      <HelpCenter />
    </AppShell>
  );
}
