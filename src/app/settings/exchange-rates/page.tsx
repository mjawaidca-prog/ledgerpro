'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { CURRENCIES } from '@/lib/currencies';

interface RateRow {
  id: string;
  date: string;
  from: string;
  to: string;
  rate: number;
  type: 'closing' | 'average' | 'daily';
  source?: 'feed' | 'manual';
}

interface FeedStatus {
  rateSource: string;
  pairs: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  nextScheduledAt: string | null;
  stalePairs: { from: string; to: string; lastDate: string | null }[];
}

const CURRENCY_CODES = Object.keys(CURRENCIES);

export default function ExchangeRatesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<RateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('CAD');
  const [rate, setRate] = useState('');
  const [type, setType] = useState<'closing' | 'average' | 'daily'>('daily');
  const [feed, setFeed] = useState<FeedStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/fx/feed-status')
      .then((r) => r.json())
      .then((json) => setFeed(json.data ?? null))
      .catch(() => {});
    fetch('/api/settings/exchange-rates')
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then((json) => setRows(json.data ?? []))
      .catch(() => setError('Could not load exchange rates.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const save = async () => {
    const rateNum = parseFloat(rate);
    if (!rateNum || rateNum <= 0) {
      flash('Enter a positive rate.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, from, to, rate: rateNum, type }),
      });
      const json = await res.json();
      if (!res.ok) {
        flash(json.error || 'Could not save the rate.');
        return;
      }
      setRate('');
      load();
      flash('Rate saved.');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch('/api/fx/sync', { method: 'POST' });
      flash('Feed synced.');
      load();
    } catch {
      flash('Sync failed — the feed may be unreachable.');
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/settings/exchange-rates?id=${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => router.push('/settings')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back to settings"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm text-[var(--text-muted)]">
          Settings <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)]">FX Rates</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)] mb-1">FX Rates</h1>
      <p className="text-sm text-[var(--text-muted)] max-w-[640px] mb-6">
        Dated exchange rates used by consolidated reports to translate foreign-currency entities.
        Balance-sheet items use the closing rate, profit &amp; loss uses the average rate, and equity
        uses the earliest available closing rate. When no dated rate exists, the built-in indicative
        rate is used and the report carries a warning.
      </p>

      {/* Add form */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 mb-6 max-w-[760px]">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">From</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
            >
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>{c} — {CURRENCIES[c].name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">To</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
            >
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>{c} — {CURRENCIES[c].name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Rate (1 unit of from)</label>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="1.3600"
              className="w-[140px] border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-focus)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'closing' | 'average' | 'daily')}
              className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
            >
              <option value="daily">Daily</option>
              <option value="closing">Closing</option>
              <option value="average">Average</option>
            </select>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-[var(--r-lg)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-medium px-4 py-2 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add rate
          </button>
        </div>
        {toast && <div className="mt-3 text-xs text-[var(--success)]">{toast}</div>}
      </div>

      {/* Feed status */}
      {feed && (
        <div className={`bg-[var(--surface)] border rounded-[var(--r-xl)] p-5 mb-6 max-w-[760px] ${feed.consecutiveFailures > 0 ? 'border-[var(--danger-soft-border)]' : 'border-[var(--border)]'}`}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[14px] font-semibold text-[var(--text-strong)]">Bank of Canada daily rates</span>
            {feed.consecutiveFailures > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--danger-soft)] border border-[var(--danger-soft-border)]">
                <span className="w-[6px] h-[6px] rounded-full bg-[var(--danger)]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--danger)]">Failing</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-[9px] py-[3px] rounded-full bg-[var(--success-soft)] border border-[var(--success-soft-border)]">
                <span className="w-[6px] h-[6px] rounded-full bg-[var(--success)]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--success)]">Connected</span>
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={syncNow}
              disabled={syncing}
              className="rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-xs font-semibold px-3.5 py-1.5 transition-colors"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {feed.consecutiveFailures > 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              The last {feed.consecutiveFailures} attempt{feed.consecutiveFailures === 1 ? '' : 's'} returned an error. Rates may be out of date, so foreign-currency entry is warning on every screen until this clears.
            </p>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">
              {feed.pairs} pair{feed.pairs === 1 ? '' : 's'} against CAD, pulled once a day after the Bank of Canada publishes.
            </p>
          )}
          <div className="font-mono text-[11px] text-[var(--text-faint)] mt-1.5">
            {feed.lastSuccessAt ? `Last sync ${format(new Date(feed.lastSuccessAt), 'MMM d, yyyy HH:mm')} MT` : 'Never synced'}
            {feed.nextScheduledAt ? ` · next sync ${format(new Date(feed.nextScheduledAt), 'MMM d, yyyy HH:mm')} MT` : ''}
            {feed.consecutiveFailures > 0 && feed.lastError ? ` · ${feed.lastError}` : ''} · {feed.pairs} pairs
          </div>
          {feed.stalePairs.length > 0 && (
            <div className="mt-2.5 rounded-[var(--r-lg)] bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] px-3.5 py-2.5 text-xs text-[var(--warning)]">
              Stale: {feed.stalePairs.map((p) => `${p.from} → ${p.to}`).join(', ')} — rates are more than 3 days old.
            </div>
          )}
        </div>
      )}

      {/* Precedence rule */}
      <div className="mb-6 max-w-[760px] text-[12.5px] text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-2.5">
        A manual rate always wins over the feed for that date and currency pair. Entries already posted keep the rate they were posted at.
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-[var(--danger)]">{error}</div>
      ) : rows && rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          No dated rates yet — consolidated reports will use the built-in indicative rates.
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden max-w-[900px]">
          <div className="grid grid-cols-[110px_90px_90px_110px_110px_90px_100px_40px] px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div>Date</div>
            <div>From</div>
            <div>To</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Inverse</div>
            <div>Type</div>
            <div>Source</div>
            <div />
          </div>
          {rows!.map((r) => (
            <div key={r.id} className="grid grid-cols-[110px_90px_90px_110px_110px_90px_100px_40px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
              <div className="font-mono text-[var(--text)]">{format(new Date(r.date), 'MMM d, yyyy')}</div>
              <div className="font-mono text-[var(--text)]">{r.from}</div>
              <div className="font-mono text-[var(--text)]">{r.to}</div>
              <div className="font-mono tabular-nums text-right text-[var(--text-strong)]">{Number(r.rate).toFixed(4)}</div>
              <div className="font-mono tabular-nums text-right text-[var(--text-muted)]">{(1 / Number(r.rate)).toFixed(4)}</div>
              <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">{r.type}</div>
              <div>
                {r.source === 'feed' ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-[var(--success-soft)] border border-[var(--success-soft-border)]">
                    <span className="w-[5px] h-[5px] rounded-full bg-[var(--success)]" />
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--success)]">Feed</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-[var(--neutral-soft)] border border-[var(--neutral-soft-border)]">
                    <span className="w-[5px] h-[5px] rounded-full bg-[var(--text-faint)]" />
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Manual</span>
                  </span>
                )}
              </div>
              <button
                onClick={() => remove(r.id)}
                className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors"
                aria-label={`Delete rate for ${r.from}→${r.to}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
