import { cn } from '@/lib/cn';

type BadgeVariant = 'paid' | 'overdue' | 'pending' | 'draft' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  paid:    'text-[var(--success)] bg-[var(--success-soft)] border-[var(--success-soft-border)]',
  overdue: 'text-[var(--danger)] bg-[var(--danger-soft)] border-[var(--danger-soft-border)]',
  pending: 'text-[var(--warning)] bg-[var(--warning-soft)] border-[var(--warning-soft-border)]',
  draft:   'text-[var(--text-muted)] bg-[var(--neutral-soft)] border-[var(--neutral-soft-border)]',
  info:    'text-[var(--accent)] bg-[var(--primary-soft)] border-[var(--primary-soft-border)]',
  neutral: 'text-[var(--text-muted)] bg-[var(--neutral-soft)] border-[var(--neutral-soft-border)]',
};

const dotColors: Record<BadgeVariant, string> = {
  paid:    'bg-[var(--success)]',
  overdue: 'bg-[var(--danger)]',
  pending: 'bg-[var(--warning)]',
  draft:   'bg-[var(--text-faint)]',
  info:    'bg-[var(--accent)]',
  neutral: 'bg-[var(--text-faint)]',
};

export function Badge({ variant = 'neutral', dot = true, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[6px] font-mono text-micro font-semibold',
        'tracking-[0.03em] uppercase py-[3px] px-[9px] rounded-full',
        'border whitespace-nowrap leading-[1.4]',
        variantStyles[variant],
        className
      )}
    >
      {dot && <span className={cn('w-[6px] h-[6px] rounded-full flex-none', dotColors[variant])} />}
      {children}
    </span>
  );
}
