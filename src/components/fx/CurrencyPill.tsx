'use client';

import { cn } from '@/lib/cn';

interface Props {
  currency: string;
  label?: string;
  active?: boolean;
}

/** Small --primary-soft currency pill (contact currency, list chips). */
export default function CurrencyPill({ currency, label, active = true }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px]',
        active
          ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)]'
          : 'bg-[var(--surface)] border-[var(--border)]'
      )}
    >
      <span className={cn('font-mono font-semibold', active ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]')}>{currency}</span>
      {label && <span className={cn(active ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]')}>{label}</span>}
    </span>
  );
}
