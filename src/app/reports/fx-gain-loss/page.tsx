'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, Printer, Download, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { N, SIGNED } from '@/lib/fx-format';
import { CURRENCIES } from '@/lib/currencies';
import { downloadCSV } from '@/lib/export';

interface ReportData {
  homeCurrency: string;
  realizedTotal: number;
  unrealizedTotal: number;
  netTotal: number;
  perCurrency: { currency: string; settled: number; realized: number; unrealized: number; net: number }[];
  largestMovements: { date: string; ref: string | null; description: string; rates: string | null; amount: number }[];
  hasActivity: boolean;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">{label}</div>
      <div className={cn('font-mono text-[26px] font-bold tabular-nums mt-2', tone === 'good' ? 'text-[var(--success)]' : tone === 'bad' ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]')}>
        {value}
      </div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{note}</div>
    </div>
  );
}

export default function FxGainLossPage() {
  const router = useRouter();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<'currency' | 'month' | 'contact'>('currency');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 4) + '-01-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/fx-gain-loss?from=${from}&to=${to}&groupBy=${groupBy}`)
      .then((r) => r.json())
      .then((json) => setData(json.data ?? null))
      .finally(() => setLoading(false));
  }, [from, to, groupBy]);

  const exportCSV = () => {
    if (!data) return;
    downloadCSV(
      `fx-gain-loss-${from}-${to}.csv`,
      ['Currency', 'Settled', 'Realized', 'Unrealized', 'Net effect'],
      data.perCurrency.map((r) => [r.currency, String(r.settled), String(r.realized), String(r.unrealized), String(r.net)])
    );
  };

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px] print:hidden">
        <button
          onClick={() => router.push('/reports')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">FX Gain/Loss</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">FX gain &amp; loss</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px] mb-6">
        Realized movements from settlements, unrealized movements from revaluations, split by currency.
      </p>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap print:hidden">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--text)] outline-none" />
        <span className="text-[var(--text-faint)]">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[12.5px] text-[var(--text)] outline-none" />
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {(['currency', 'month', 'contact'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                groupBy === g ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
              )}
            >
              By {g}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-[var(--border)] rounded-[var(--r-lg)] px-3 py-2 text-[13px] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors">
          <Printer size={14} /> PDF
        </button>
        <button onClick={exportCSV} className="flex items-center gap-1.5 border border-[var(--border)] rounded-[var(--r-lg)] px-3 py-2 text-[13px] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors">
          <Download size={14} /> Excel
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : !data || !data.hasActivity ? (
        <div className="py-16 text-center">
          <div className="text-base font-semibold text-[var(--text-strong)]">No foreign exchange activity this period</div>
          <div className="text-sm text-[var(--text-muted)] mt-1.5 max-w-[520px] mx-auto">
            Nothing has settled at a different rate than it was booked at, and no revaluation has been posted. This report fills in as soon as either happens.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Tiles */}
          <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            <Tile label="Realized · settled" value={SIGNED(data.realizedTotal, { suffix: data.homeCurrency })} note="From payments at a different rate" tone={data.realizedTotal >= 0 ? 'good' : 'bad'} />
            <Tile label="Unrealized · open" value={SIGNED(data.unrealizedTotal, { suffix: data.homeCurrency })} note="Posted by month-end revaluation, reversed next month" tone={data.unrealizedTotal >= 0 ? 'good' : 'bad'} />
            <Tile label="Net effect on profit" value={SIGNED(data.netTotal, { suffix: data.homeCurrency })} note={`${from} to ${to}`} tone={data.netTotal >= 0 ? 'good' : 'bad'} />
          </div>

          {/* Per-currency table */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
            <div className="grid grid-cols-[120px_1fr_110px_110px_110px_110px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
              <div>Currency</div><div /><div className="text-right">Settled</div><div className="text-right">Realized</div><div className="text-right">Unrealized</div><div className="text-right">Net effect</div>
            </div>
            {data.perCurrency.map((r) => (
              <div key={r.currency} className="grid grid-cols-[120px_1fr_110px_110px_110px_110px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
                <div className="font-mono font-semibold text-[var(--text-strong)]">{r.currency}</div>
                <div className="text-[var(--text-muted)]">{CURRENCIES[r.currency]?.name ?? ''}</div>
                <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{N(r.settled)}</div>
                <div className={cn('text-right font-mono tabular-nums', r.realized >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(r.realized)}</div>
                <div className={cn('text-right font-mono tabular-nums', r.unrealized >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(r.unrealized)}</div>
                <div className={cn('text-right font-mono font-semibold tabular-nums', r.net >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(r.net)}</div>
              </div>
            ))}
            <div className="grid grid-cols-[120px_1fr_110px_110px_110px_110px] px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)] font-bold text-[13.5px]">
              <div />
              <div className="text-[var(--text-strong)]">Net gain on foreign exchange</div>
              <div />
              <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{SIGNED(data.realizedTotal)}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{SIGNED(data.unrealizedTotal)}</div>
              <div className={cn('text-right font-mono tabular-nums text-[17px]', data.netTotal >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(data.netTotal)}</div>
            </div>
          </div>

          {/* Largest movements */}
          {data.largestMovements.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">
                Largest realized movements
              </div>
              <div className="grid grid-cols-[100px_100px_1fr_170px_110px] px-4 py-2 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                <div>Date</div><div>Ref</div><div>Description</div><div className="text-right">Rates</div><div className="text-right">Amount</div>
              </div>
              {data.largestMovements.map((m, i) => (
                <div key={i} className="grid grid-cols-[100px_100px_1fr_170px_110px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
                  <div className="font-mono text-[var(--text-muted)]">{m.date}</div>
                  <div className="font-mono text-[var(--text)]">{m.ref ?? '—'}</div>
                  <div className="text-[var(--text)] truncate">{m.description}</div>
                  <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{m.rates ?? '—'}</div>
                  <div className={cn('text-right font-mono tabular-nums font-medium', m.amount >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{SIGNED(m.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
