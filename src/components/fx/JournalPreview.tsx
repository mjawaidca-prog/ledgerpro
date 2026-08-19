'use client';

import { N } from '@/lib/fx-format';

interface JournalRow {
  code: string;
  name: string;
  memo: string;
  debit: number;
  credit: number;
}

interface Props {
  rows: JournalRow[];
  homeCurrency: string;
}

/**
 * Always-visible journal preview (CAD/home) with a Balanced footer showing
 * both column totals — the user never posts an FX difference they haven't seen.
 */
export default function JournalPreview({ rows, homeCurrency }: Props) {
  const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Journal preview</span>
        <span className="font-mono text-[11px] text-[var(--text-faint)]">{homeCurrency} · home currency</span>
      </div>
      <div className="grid grid-cols-[70px_1fr_110px_110px] px-4 py-2 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
        <div>Code</div>
        <div>Account</div>
        <div className="text-right">Debit</div>
        <div className="text-right">Credit</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[70px_1fr_110px_110px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 text-[13px]">
          <div className="font-mono text-[var(--text-muted)]">{r.code}</div>
          <div>
            <div className="text-[var(--text)]">{r.name}</div>
            <div className="font-mono text-[11px] text-[var(--text-faint)]">{r.memo}</div>
          </div>
          <div className="text-right font-mono tabular-nums text-[var(--text)]">{r.debit > 0 ? N(r.debit) : '—'}</div>
          <div className="text-right font-mono tabular-nums text-[var(--text)]">{r.credit > 0 ? N(r.credit) : '—'}</div>
        </div>
      ))}
      <div className="grid grid-cols-[70px_1fr_110px_110px] px-4 py-2.5 bg-[var(--surface-2)] border-t border-[var(--border)] text-[13.5px] font-bold">
        <div />
        <div className="text-[var(--text-strong)]">Balanced</div>
        <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{N(totalDebit)}</div>
        <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{N(totalCredit)}</div>
      </div>
    </div>
  );
}
