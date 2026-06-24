'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-xs)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]',
  secondary:
    'bg-[var(--surface)] text-[var(--text-strong)] border-[var(--border-strong)] shadow-[var(--shadow-xs)] hover:bg-[var(--surface-2)] hover:border-[var(--text-faint)]',
  ghost:
    'bg-transparent text-[var(--text)] hover:bg-[var(--surface-3)] hover:text-[var(--text-strong)]',
  destructive:
    'bg-[var(--danger)] text-white shadow-[var(--shadow-xs)] hover:brightness-[0.94] focus-visible:shadow-[0_0_0_3px_var(--danger-soft)]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[11px] text-xs rounded-sm',
  md: 'h-[var(--control-h)] px-[15px] text-sm rounded-md',
  lg: 'h-[46px] px-[20px] text-md rounded-md',
  icon: 'w-[var(--control-h)] p-0 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-[7px] font-sans text-sm font-semibold',
          'border border-transparent leading-none whitespace-nowrap select-none',
          'transition-[background,border-color,color,box-shadow,transform] duration-fast ease',
          'active:translate-y-px focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)]',
          'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
