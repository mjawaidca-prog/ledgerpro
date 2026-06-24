'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  inputSize?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, inputSize = 'md', disabled, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'font-sans text-base text-[var(--text-strong)]',
          'bg-[var(--surface)] border border-[var(--border-strong)] rounded-md',
          'h-[var(--control-h)] px-3 w-full',
          'transition-[border-color,box-shadow,background] duration-fast ease',
          'placeholder:text-[var(--text-faint)]',
          'hover:border-[var(--text-faint)]',
          'focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]',
          error && 'border-[var(--danger)] focus:shadow-[0_0_0_3px_var(--danger-soft)]',
          disabled && 'bg-[var(--surface-3)] text-[var(--text-faint)] cursor-not-allowed',
          className
        )}
        disabled={disabled}
        aria-invalid={error || undefined}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

// Input with leading icon or symbol
interface InputGroupProps extends InputProps {
  leadingIcon?: React.ReactNode;
  leadingSymbol?: string;
  isMoney?: boolean;
}

export const InputGroup = forwardRef<HTMLInputElement, InputGroupProps>(
  ({ className, leadingIcon, leadingSymbol, isMoney, ...props }, ref) => {
    return (
      <div className="relative flex items-center">
        {leadingIcon && (
          <span className="absolute left-3 grid place-items-center text-[var(--text-faint)] pointer-events-none">
            {leadingIcon}
          </span>
        )}
        {leadingSymbol && (
          <span className="absolute left-3 grid place-items-center font-mono text-base text-[var(--text-faint)] pointer-events-none">
            {leadingSymbol}
          </span>
        )}
        <Input
          ref={ref}
          className={cn(
            (leadingIcon || leadingSymbol) && 'pl-[34px]',
            isMoney && 'font-mono tabular-nums text-right pr-3',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

InputGroup.displayName = 'InputGroup';
