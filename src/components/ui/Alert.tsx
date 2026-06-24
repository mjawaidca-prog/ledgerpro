import { cn } from '@/lib/cn';
import { CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

type AlertVariant = 'success' | 'danger' | 'warning' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

const icons: Record<AlertVariant, typeof CheckCircle> = {
  success: CheckCircle,
  danger:  XCircle,
  warning: AlertTriangle,
  info:    Info,
};

export function Alert({ variant = 'info', title, className, children }: AlertProps) {
  const Icon = icons[variant];

  return (
    <div
      className={cn(
        'flex gap-[11px] p-[13px_15px] rounded-lg border',
        'bg-[var(--surface)] border-[var(--border)] items-start',
        variant === 'success' && 'bg-[var(--success-soft)] border-[var(--success-soft-border)] [&_.a-ico]:text-[var(--success)]',
        variant === 'danger'  && 'bg-[var(--danger-soft)] border-[var(--danger-soft-border)] [&_.a-ico]:text-[var(--danger)]',
        variant === 'warning' && 'bg-[var(--warning-soft)] border-[var(--warning-soft-border)] [&_.a-ico]:text-[var(--warning)]',
        variant === 'info'    && 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)] [&_.a-ico]:text-[var(--accent)]',
        className
      )}
    >
      <div className="a-ico w-[18px] h-[18px] flex-none mt-px">
        <Icon size={18} />
      </div>
      <div className="flex-1">
        {title && <div className="font-[650] text-[var(--text-strong)] text-sm">{title}</div>}
        <div className="text-sm text-[var(--text-muted)] mt-0.5">{children}</div>
      </div>
    </div>
  );
}
