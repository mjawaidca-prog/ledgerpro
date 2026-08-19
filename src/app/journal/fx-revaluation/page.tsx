'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, CheckCircle2, Download } from 'lucide-react';
import { cn } from '@/lib/cn';
import { N, SIGNED } from '@/lib/fx-format';
import { downloadCSV } from '@/lib/export';

interface RevalRow {
  code: string;
  account: string;
  ccy: string;
  balanceForeign: number;
  rate: number;
  carryingHome: number;
  revaluedHome: number;
  unrealized: number;
  liability: boolean;
}

interface PostedState {
  id: string;
  asOf: string;
  netAmount: number;
  journalEntryId: string;
  reversalEntryId: string | null;
  voidedAt: string | null;
}

export default function FxRevaluationPage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RevalRow[] | null>(null);
  const [net, setNet] = useState(0);
  const [missingRates, setMissingRates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<PostedState | null>(null);

  const loadPreview = async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fx/revaluation/preview?asOf=${date}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setRows(json.data.rows ?? []);
      setNet(json.data.net ?? 0);
      setMissingRates(json.data.missingRates ?? []);
      setPosted(null);
    } catch (e: any) {
      setRows(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview(asOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const res = await fetch('/api/fx/revaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOf }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409 && json.data) {
          setPosted(json.data);
          return;
        }
        throw new Error(json.error ?? 'Failed');
      }
      setPosted(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const exportWorkingPaper = () => {
    if (!rows) return;
    downloadCSV(
      `fx-revaluation-${asOf}.csv`,
      ['Code', 'Account', 'Ccy', 'Balance', 'Rate', 'Carrying CAD', 'Revalued CAD', 'Unrealized'],
      rows.map((r) => [r.code, r.account, r.ccy, String(r.balanceForeign), r.rate.toFixed(4), String(r.carryingHome), String(r.revaluedHome), String(r.unrealized)])
    );
  };

  const reversalDate = (() => {
    const d = new Date(asOf);
    d.setDate(d.getDate() + 1);
    while (d.getMonth() === new Date(asOf).getMonth()) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/journal')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Journal <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">FX Revaluation</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Month-end revaluation</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px] mb-6">
        Restates open foreign-currency balances at closing rates. Posts one entry dated month end and a reversal on the first of the next month.
      </p>

      {/* Setup strip */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 mb-6 max-w-[860px]">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Revalue as at</label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => { setAsOf(e.target.value); loadPreview(e.target.value); }}
              className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text-strong)] outline-none"
            />
          </div>
          <div className="text-[13px] text-[var(--text-muted)]">
            Rates: <span className="font-mono text-[var(--text-strong)]">Month-end closing</span>
          </div>
          <div className="text-[13px] text-[var(--text-muted)]">
            Posts to: <span className="font-mono text-[var(--text-strong)]">4320 Unrealized FX</span>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-[var(--r-lg)] bg-[var(--danger-soft)] border border-[var(--danger-soft-border)] px-4 py-3 text-[13px] text-[var(--danger)]">{error}</div>}
      {missingRates.length > 0 && (
        <div className="mb-4 rounded-[var(--r-lg)] bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] px-4 py-3 text-[13px] text-[var(--warning)]">
          Missing closing rates for: {missingRates.join(', ')}. Add them in Settings › FX Rates.
        </div>
      )}

      {loading ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-10 text-center">
          <Loader2 size={18} className="animate-spin text-[var(--primary)] mx-auto" />
          <div className="text-sm text-[var(--text-muted)] mt-3">Reading open FX balances, pulling closing rates…</div>
        </div>
      ) : posted ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-10 text-center max-w-[620px]">
          <CheckCircle2 size={32} className="mx-auto text-[var(--success)]" />
          <div className="text-base font-semibold text-[var(--text-strong)] mt-3">Posted on {String(posted.asOf).slice(0, 10)}</div>
          <div className="text-sm text-[var(--text-muted)] mt-1">
            Reversing entry scheduled for {reversalDate}. Void the entry to undo the revaluation.
          </div>
          <button
            onClick={() => router.push(`/journal/${posted.journalEntryId}`)}
            className="mt-4 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]"
          >
            View journal entry
          </button>
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-10 text-center max-w-[620px]">
          <div className="text-base font-semibold text-[var(--text-strong)]">Nothing to revalue at {asOf}</div>
          <div className="text-sm text-[var(--text-muted)] mt-1.5">
            Every foreign-currency balance is either nil or already carried at the closing rate. No entry is needed — running this would post zeros.
          </div>
        </div>
      ) : rows ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden max-w-[980px]">
          <div className="grid grid-cols-[64px_1fr_60px_110px_90px_120px_120px_110px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div>Code</div><div>Account</div><div className="text-right">Ccy</div><div className="text-right">Balance</div><div className="text-right">Rate</div><div className="text-right">Carrying CAD</div><div className="text-right">Revalued CAD</div><div className="text-right">Unrealized</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[64px_1fr_60px_110px_90px_120px_120px_110px] px-4 py-2.5 border-b border-[var(--surface-3)] items-center text-[13px]">
              <div className="font-mono text-[var(--text-muted)]">{r.code}</div>
              <div className="text-[var(--text)]">{r.account}</div>
              <div className="text-right font-mono text-[var(--text-muted)]">{r.ccy}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text)]">{N(r.balanceForeign)}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{r.rate.toFixed(4)}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{N(r.carryingHome)}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{N(r.revaluedHome)}</div>
              <div className={cn('text-right font-mono tabular-nums font-medium', r.unrealized >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(r.unrealized)}</div>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)]">
            <span className="font-mono text-[11px] text-[var(--text-faint)]">
              Posting writes one journal entry dated {asOf} and a reversing entry dated {reversalDate}, so the revaluation touches the month-end statements only. Settled amounts are never affected — those already carry a realized gain or loss.
            </span>
            <span className={cn('font-mono text-[17px] font-bold tabular-nums whitespace-nowrap', net >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
              Net unrealized {net >= 0 ? 'gain' : 'loss'} to post {SIGNED(net)}
            </span>
          </div>
        </div>
      ) : null}

      {rows && rows.length > 0 && (
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={exportWorkingPaper}
            className="flex items-center gap-2 rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-medium text-[var(--text)] hover:border-[var(--border-strong)] transition-colors"
          >
            <Download size={14} /> Export working paper
          </button>
          <button
            onClick={post}
            disabled={posting || missingRates.length > 0}
            className="flex items-center gap-2 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]"
          >
            {posting && <Loader2 size={15} className="animate-spin" />}
            Post revaluation
          </button>
        </div>
      )}
    </AppShell>
  );
}
