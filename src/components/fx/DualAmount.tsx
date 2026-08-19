'use client';

import { cn } from '@/lib/cn';
import { N, isZeroDecimal } from '@/lib/fx-format';

interface Props {
  /** Primary figure — transaction currency. */
  amount: number | null | undefined;
  currency: string;
  /** Home equivalent (derived, not yet posted). */
  home?: number | null;
  homeCurrency?: string;
  rate?: number | null;
  rateDate?: string | null;
  primarySize?: string;
  subSize?: string;
  align?: 'left' | 'right';
}

/**
 * QBO-style dual amount: the transaction currency is the primary figure,
 * the home equivalent is quiet subtext underneath with its rate and date.
 */
export default function DualAmount({
  amount,
  currency,
  home,
  homeCurrency,
  rate,
  rateDate,
  primarySize = 'text-[15px]',
  subSize = 'text-[11px]',
  align = 'right',
}: Props) {
  const foreign = N(amount, { zeroDecimals: isZeroDecimal(currency) });
  const homeStr = home !== null && home !== undefined && homeCurrency ? N(home, { suffix: homeCurrency }) : null;

  return (
    <div className={cn('flex flex-col', align === 'right' ? 'items-end' : 'items-start')}>
      <span className={cn('font-mono font-semibold tabular-nums text-[var(--text-strong)]', primarySize)}>{foreign}</span>
      {homeStr && (
        <span className={cn('font-mono tabular-nums text-[var(--text-muted)]', subSize)}>
          {homeStr}
          {rate && rateDate && <span className="text-[var(--text-faint)]"> at {rate.toFixed(4)} on {rateDate}</span>}
        </span>
      )}
    </div>
  );
}
