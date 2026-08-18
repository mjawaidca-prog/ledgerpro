'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { fmtNum, type ReportLine } from './state';

interface Props {
  line: ReportLine | null;
  companyIds: string[];
  asOf: string;
  currency: string;
  onClose: () => void;
}

interface DrillRow {
  companyId: string;
  companyName: string;
  amount: number;
  elimination: number;
  consolidated: number;
}

export default function DrillDownModal({ line, companyIds, asOf, currency, onClose }: Props) {
  const [rows, setRows] = useState<DrillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!line) return;
    setRows(null);
    setError(null);
    const params = new URLSearchParams({
      code: line.code,
      companyIds: companyIds.join(','),
      asOf,
      currency,
    });
    fetch(`/api/reports/consolidated/drilldown?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load drill-down');
        return res.json();
      })
      .then((json) => setRows(json.data?.lines ?? []))
      .catch((err) => setError(err.message));
  }, [line, companyIds.join(','), asOf, currency]);

  if (!line) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[560px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] shadow-[var(--shadow-lg)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="font-mono text-xs text-[var(--text-faint)]">{line.code}</div>
            <h3 className="text-base font-semibold text-[var(--text-strong)] mt-0.5">{line.name}</h3>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="py-8 text-center text-sm text-[var(--danger)]">{error}</div>
        ) : !rows ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="animate-spin text-[var(--primary)]" />
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
            <div className="grid grid-cols-[1fr_110px_110px_110px] px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
              <div>Entity</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Elim.</div>
              <div className="text-right">Net</div>
            </div>
            {rows.map((r) => (
              <div key={r.companyId} className="grid grid-cols-[1fr_110px_110px_110px] px-3 py-2 border-b border-[var(--surface-3)] last:border-b-0 text-[13px]">
                <div className="text-[var(--text)] truncate">{r.companyName}</div>
                <div className="text-right font-mono tabular-nums text-[var(--text)]">{fmtNum(r.amount)}</div>
                <div className="text-right font-mono tabular-nums text-[var(--primary)]">{fmtNum(r.elimination)}</div>
                <div className="text-right font-mono font-semibold tabular-nums text-[var(--text-strong)]">{fmtNum(r.consolidated)}</div>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_110px_110px_110px] px-3 py-2.5 bg-[var(--surface-2)] border-t border-[var(--border)] text-[13.5px] font-bold text-[var(--text-strong)]">
              <div>Consolidated</div>
              <div />
              <div />
              <div className="text-right font-mono tabular-nums">{fmtNum(line.consolidated)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
