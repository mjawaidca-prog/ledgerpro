'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { rateChipStrings, rateDateNote } from '@/lib/fx-format';

export interface RateChipData {
  rate: number | null;
  source: 'feed' | 'manual' | 'none';
  rateDate: string | null;
  stale: boolean;
  staleDays: number;
  feedRate: number | null;
}

interface Props {
  from: string;
  to: string;
  resolved: RateChipData;
  onEditRate?: (rate: number) => void;
  onResetToFeed?: () => void;
  onRefreshFeed?: () => void;
  busy?: boolean;
}

function SourceBadge({ resolved }: { resolved: RateChipData }) {
  if (resolved.source === 'feed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--success-soft)] border border-[var(--success-soft-border)]">
        <span className="w-[6px] h-[6px] rounded-full bg-[var(--success)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--success)]">Bank of Canada</span>
      </span>
    );
  }
  if (resolved.source === 'manual') {
    return (
      <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--primary-soft)] border border-[var(--primary-soft-border)]">
        <span className="w-[6px] h-[6px] rounded-full bg-[var(--primary)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--primary)]">Manual override</span>
      </span>
    );
  }
  if (resolved.stale) {
    const d = resolved.rateDate ? new Date(resolved.rateDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : '';
    return (
      <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--warning-soft)] border border-[var(--warning-soft-border)]">
        <span className="w-[6px] h-[6px] rounded-full bg-[var(--warning)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--warning)]">Stale · {d}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--danger-soft)] border border-[var(--danger-soft-border)]">
      <span className="w-[6px] h-[6px] rounded-full bg-[var(--danger)]" />
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--danger)]">Missing</span>
    </span>
  );
}

/**
 * The rate chip — a first-class object wherever a rate is applied:
 * primary rate + inverse, source badge, and one text action.
 */
export default function RateChip({ from, to, resolved, onEditRate, onResetToFeed, onRefreshFeed, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const strings = rateChipStrings(resolved.rate, from, to);

  const save = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n > 0) {
      onEditRate?.(n);
      setEditing(false);
      setDraft('');
    }
  };

  const action =
    resolved.source === 'manual' && onResetToFeed ? (
      <button onClick={onResetToFeed} className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
        Reset to feed rate
      </button>
    ) : onEditRate ? (
      <button onClick={() => { setEditing(!editing); setDraft(resolved.rate ? String(resolved.rate) : ''); }} className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
        {editing ? 'Cancel' : 'Edit rate'}
      </button>
    ) : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          {editing ? (
            <input
              type="number"
              step="0.0001"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              className="w-[120px] border border-[var(--border-focus)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1 font-mono text-[22px] text-[var(--primary)] outline-none"
            />
          ) : (
            <span className={cn('font-mono text-[22px] font-semibold tabular-nums', resolved.source === 'manual' ? 'text-[var(--primary)]' : 'text-[var(--text-strong)]')}>
              {resolved.rate ? resolved.rate.toFixed(4) : '—.————'}
            </span>
          )}
          <span className="font-mono text-[13px] text-[var(--text-muted)]">{editing ? to : `${strings.primary.replace(`1 ${from} = `, '')}`}</span>
        </div>
        <SourceBadge resolved={resolved} />
      </div>
      <div className="font-mono text-[11.5px] text-[var(--text-faint)]">{strings.inverse}</div>
      <div className="flex items-center gap-3">
        {action}
        {onRefreshFeed && resolved.stale && (
          <button onClick={onRefreshFeed} disabled={busy} className="text-xs font-medium text-[var(--warning)] hover:underline transition-colors disabled:opacity-50">
            {busy ? 'Refreshing…' : 'Refresh feed'}
          </button>
        )}
        {editing && (
          <button onClick={save} className="text-xs font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
            Save rate
          </button>
        )}
      </div>
      <div className="text-xs text-[var(--text-muted)]">{rateDateNote(resolved.rate, resolved.rateDate)}</div>
    </div>
  );
}
