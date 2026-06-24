import { cn } from '@/lib/cn';
import { money } from '@/lib/money';

type StatColor = 'blue' | 'green' | 'red' | 'gray';

interface StatCardProps {
  title: string;
  value: number;
  delta?: string;
  deltaDirection?: 'up' | 'down';
  deltaMuted?: string;
  icon?: React.ReactNode;
  color?: StatColor;
  className?: string;
}

const colorMap: Record<StatColor, { ico: string }> = {
  blue:  { ico: 'bg-[var(--primary-soft)] text-[var(--accent)]' },
  green: { ico: 'bg-[var(--success-soft)] text-[var(--success)]' },
  red:   { ico: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
  gray:  { ico: 'bg-[var(--neutral-soft)] text-[var(--text-muted)]' },
};

export function StatCard({
  title,
  value,
  delta,
  deltaDirection,
  deltaMuted,
  icon,
  color = 'blue',
  className,
}: StatCardProps) {
  return (
    <div className={cn(
      'bg-[var(--surface)] border border-[var(--border)] rounded-2xl',
      'p-[18px_18px_16px] shadow-[var(--shadow-sm)]',
      className
    )}>
      {/* Top row: icon + label */}
      <div className="flex items-center gap-[9px] mb-3">
        <div className={cn(
          'w-[30px] h-[30px] rounded-md grid place-items-center flex-none',
          colorMap[color].ico
        )}>
          {icon}
        </div>
        <span className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {title}
        </span>
      </div>

      {/* Value */}
      <div className="font-mono tabular-nums text-3xl font-semibold text-[var(--text-strong)] tracking-tighter leading-[1.05]">
        {money(value)}
      </div>

      {/* Delta */}
      {delta && (
        <div className={cn(
          'inline-flex items-center gap-1 font-mono text-xs font-semibold mt-2',
          deltaDirection === 'up' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
        )}>
          {delta}
          {deltaMuted && (
            <span className="text-[var(--text-faint)] font-normal">{deltaMuted}</span>
          )}
        </div>
      )}
    </div>
  );
}
