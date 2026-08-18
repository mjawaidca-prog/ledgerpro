'use client';

import { cn } from '@/lib/cn';
import type { EliminationRow } from './state';
import { fmtNum } from './state';

interface Props {
  eliminations: EliminationRow[];
  currency: string;
  excludedIds: string[];
  onToggle: (id: string) => void;
  onAddManual: () => void;
}

function StatusPill({ status }: { status: EliminationRow['status'] }) {
  if (status === 'matched') {
    return (
      <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--success-soft)] border border-[var(--success-soft-border)]">
        <span className="w-[6px] h-[6px] rounded-full bg-[var(--success)]" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--success)]">Matched</span>
      </span>
    );
  }
  if (status === 'break') {
    return (
      <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--danger-soft)] border border-[var(--danger-soft-border)]">
        <span className="w-[6px] h-[6px] rounded-full bg-[var(--danger)]" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--danger)]">Break</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--neutral-soft)] border border-[var(--neutral-soft-border)]">
      <span className="w-[6px] h-[6px] rounded-full bg-[var(--text-faint)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">P&amp;L only</span>
    </span>
  );
}

export default function EliminationsTable({ eliminations, currency, excludedIds, onToggle, onAddManual }: Props) {
  const visible = eliminations.filter((e) => !excludedIds.includes(e.id));
  const appliedCount = visible.length;
  const appliedTotal = visible.reduce((s, e) => s + e.amount, 0);
  const all = eliminations.length;

  return (
    <div className="border-t border-[var(--border)] px-[22px] py-5">
      <div className="flex items-baseline gap-3 mb-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">5 · Eliminations</div>
        <div className="flex-1" />
        {all > 0 ? (
          <div className="font-mono text-[11px] text-[var(--text-faint)]">
            {appliedCount} of {all} automatic applied · {fmtNum(appliedTotal)} {currency}
          </div>
        ) : (
          <div className="font-mono text-[11px] text-[var(--text-faint)]">
            Eliminations appear here after the first run
          </div>
        )}
        <button
          onClick={onAddManual}
          className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
        >
          Add manual elimination
        </button>
      </div>

      {visible.length > 0 && (
        <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
          <div className="grid grid-cols-[34px_82px_1fr_96px_124px_112px] items-center px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div />
            <div>Ref</div>
            <div>Elimination</div>
            <div className="text-right">Source</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Status</div>
          </div>
          {visible.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[34px_82px_1fr_96px_124px_112px] items-center px-3 py-[10px] border-b border-[var(--surface-3)] last:border-b-0 hover:bg-[var(--surface-2)] transition-colors"
            >
              <div>
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded-[4px] accent-[var(--primary)]"
                  checked={!excludedIds.includes(e.id)}
                  onChange={() => onToggle(e.id)}
                  aria-label={`Include ${e.ref}`}
                />
              </div>
              <div className="font-mono text-xs tabular-nums text-[var(--text)]">{e.ref}</div>
              <div className="text-[13px] text-[var(--text)] truncate" title={e.description}>{e.description}</div>
              <div className="text-right font-mono text-[10px] uppercase text-[var(--text-faint)]">{e.source}</div>
              <div className="text-right font-mono text-xs tabular-nums text-[var(--text)]">{fmtNum(e.amount)}</div>
              <div className="text-right flex justify-end"><StatusPill status={e.status} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
