'use client';

import { cn } from '@/lib/cn';

interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Segmented({ options, value, onChange, className }: SegmentedProps) {
  return (
    <div className={cn(
      'inline-flex bg-[var(--surface-3)] border border-[var(--border)] rounded-md p-[3px] gap-[2px]',
      className
    )}>
      {options.map((opt) => (
        <button
          key={opt.value}
          role="button"
          aria-pressed={opt.value === value}
          className={cn(
            'appearance-none border-0 bg-transparent cursor-pointer',
            'font-mono text-xs font-medium',
            'py-[5px] px-3 rounded-sm',
            'transition-all duration-fast ease',
            opt.value === value
              ? 'bg-[var(--surface)] text-[var(--text-strong)] shadow-[var(--shadow-xs)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]'
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
