'use client';

import { cn } from '@/lib/cn';
import { N, SIGNED } from '@/lib/fx-format';

export interface SettlementPreviewData {
  currency: string;
  homeCurrency: string;
  amountForeign: number;
  invoiceRate: number;
  settlementRate: number;
  rateSource: 'feed' | 'manual' | 'none';
  cashHome: number;
  receivableRelievedHome: number;
  fxDifference: number;
  outcome: 'gain' | 'loss' | 'none';
  glAccountCode: string | null;
  journal: { code: string; name: string; memo: string; debit: number; credit: number }[];
  remainingForeign: number;
  remainingHome: number;
}

interface Props {
  data: SettlementPreviewData;
  totalForeign: number;
}

/**
 * The FX breakdown card — border/fill/figure colour switch on the outcome:
 * gain (success-soft), loss (danger-soft), none (neutral). Always shows the
 * three-line arithmetic before anything is posted.
 */
export default function FxBreakdownCard({ data, totalForeign }: Props) {
  const { outcome, fxDifference } = data;
  const isGain = outcome === 'gain';
  const isLoss = outcome === 'loss';
  const isNone = outcome === 'none';
  const isPartial = data.amountForeign < totalForeign - 0.005;

  const palette = isGain
    ? { border: 'border-[var(--success-soft-border)]', bg: 'bg-[var(--success-soft)]', fg: 'text-[var(--success)]', headline: 'Realized FX gain' }
    : isLoss
      ? { border: 'border-[var(--danger-soft-border)]', bg: 'bg-[var(--danger-soft)]', fg: 'text-[var(--danger)]', headline: 'Realized FX loss' }
      : { border: 'border-[var(--border)]', bg: 'bg-[var(--surface-2)]', fg: 'text-[var(--text-muted)]', headline: 'No exchange difference' };

  const sentence = isGain
    ? `You received ${N(data.cashHome, { suffix: data.homeCurrency })} worth of ${data.currency === 'USD' ? 'US dollars' : data.currency} against a receivable carried at ${N(data.receivableRelievedHome, { suffix: data.homeCurrency })}. The difference is income in the month the payment lands.`
    : isLoss
      ? `You received ${N(data.cashHome, { suffix: data.homeCurrency })} worth of ${data.currency === 'USD' ? 'US dollars' : data.currency} against a receivable carried at ${N(data.receivableRelievedHome, { suffix: data.homeCurrency })}. The shortfall is an expense in the month the payment lands.`
      : `The rate on the payment date matches the rate the invoice was raised at, so the receivable clears exactly and nothing is posted to FX.`;

  return (
    <div className={cn('rounded-[var(--r-xl)] border p-5 space-y-4', palette.border, palette.bg)}>
      <div className="flex items-center justify-between">
        <span className={cn('font-mono text-[10.5px] uppercase tracking-[0.10em]', palette.fg)}>{palette.headline}</span>
        <span className={cn('font-mono text-[30px] font-bold tabular-nums', palette.fg)}>
          {isNone ? N(0, { suffix: data.homeCurrency }) : SIGNED(fxDifference, { suffix: data.homeCurrency })}
        </span>
      </div>

      <p className={cn('text-[13px] leading-relaxed', isNone ? 'text-[var(--text-muted)]' : 'text-[var(--text)]')}>{sentence}</p>

      <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--text-muted)]">Cash received</span>
          <span className="text-right">
            <span className="font-mono tabular-nums text-[var(--text)]">
              {N(data.amountForeign, { zeroDecimals: data.currency === 'JPY' || data.currency === 'INR' })} {data.currency} @ {data.settlementRate.toFixed(4)}
            </span>
            <span className="font-mono tabular-nums text-[var(--text-strong)] ml-2">{N(data.cashHome)}</span>
          </span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--text-muted)]">Receivable relieved</span>
          <span className="text-right">
            <span className="font-mono tabular-nums text-[var(--text-muted)]">
              {N(data.amountForeign, { zeroDecimals: data.currency === 'JPY' || data.currency === 'INR' })} {data.currency} @ {data.invoiceRate.toFixed(4)} (invoice rate)
            </span>
            <span className={cn('font-mono tabular-nums ml-2', isNone ? 'text-[var(--text-muted)]' : 'text-[var(--text)]')}>({N(data.receivableRelievedHome)})</span>
          </span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--text-muted)]">{isNone ? 'Exchange difference' : isGain ? 'Exchange gain' : 'Exchange loss'}</span>
          <span className="text-right">
            <span className="font-mono text-[11px] text-[var(--text-faint)]">to profit and loss</span>
            <span className={cn('font-mono font-bold tabular-nums ml-2', isNone ? 'text-[var(--text-muted)]' : palette.fg)}>
              {isNone ? N(0) : SIGNED(fxDifference)}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3 text-[13px]">
        <span className="text-[var(--text-muted)]">Posts to</span>
        <span className={cn('font-mono', isNone ? 'text-[var(--text-muted)]' : 'text-[var(--text-strong)]')}>
          {isNone ? '— not required' : `${data.glAccountCode} · Realized FX gain/loss`}
        </span>
      </div>
      {!isNone && (
        <p className="text-xs text-[var(--text-muted)]">
          Set once in Settings › Currencies and reused for every settlement. Change it here only for an exception you can justify.
        </p>
      )}
      {isNone && (
        <p className="text-xs text-[var(--text-muted)]">Nothing posts to an FX account on this payment.</p>
      )}

      {isPartial && (
        <div className="rounded-[var(--r-lg)] bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
          <div className="text-[13px] font-semibold text-[var(--text-strong)]">After this payment</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Still outstanding <span className="font-mono text-[var(--text-strong)]">{N(data.remainingForeign, { zeroDecimals: data.currency === 'JPY' || data.currency === 'INR' })} {data.currency}</span>.
            The remainder stays on the books at the original {data.invoiceRate.toFixed(4)}. It will be revalued at month end and produce its own gain or loss when it settles.
          </div>
        </div>
      )}
    </div>
  );
}
