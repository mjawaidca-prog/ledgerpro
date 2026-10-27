'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/cn';
import { ShieldCheck } from 'lucide-react';

const tabs = [
  { href: '/control-center', label: 'Overview' },
  { href: '/control-center/subscribers', label: 'Subscribers & Companies' },
  { href: '/control-center/follow-ups', label: 'Trials & Follow-up' },
];

export function ControlCenterShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={20} className="text-[var(--primary)]" />
          <h1 className="text-xl font-bold text-[var(--text-strong)]">Control Center</h1>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-[var(--border-strong)] text-[var(--text-muted)]">Platform Administration — LedgerPro only</span>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-4">Subscriber, trial and platform status. No customer balances, transactions or documents are shown here.</p>
        <nav className="flex gap-2 mb-6 flex-wrap">
          {tabs.map((t) => {
            const active = t.href === '/control-center' ? pathname === t.href : pathname.startsWith(t.href);
            return <Link key={t.href} href={t.href} className={cn('px-3 py-1.5 rounded-md text-sm font-medium no-underline border', active ? 'bg-[var(--primary)] text-white border-transparent' : 'text-[var(--text)] border-[var(--border)] hover:border-[var(--border-strong)]')}>{t.label}</Link>;
          })}
        </nav>
        {children}
      </div>
    </AppShell>
  );
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString('en-CA');
}
