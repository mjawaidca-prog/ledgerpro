'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, Lock, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CURRENCIES } from '@/lib/currencies';

interface CompanyData {
  id: string;
  name: string;
  currency: string;
  enabledCurrencies?: string[];
  rateSource?: string;
  realizedFxAccountCode?: string | null;
  unrealizedFxAccountCode?: string | null;
  fxRoundingAccountCode?: string | null;
}

interface CurrencyUsage {
  currency: string;
  entries: number;
}

const RATE_SOURCES = [
  { key: 'bank_of_canada', name: 'Bank of Canada daily rates', desc: 'Free, published every business day, and the rate the CRA accepts for tax reporting. Recommended for Canadian books.' },
  { key: 'exchangerate_host', name: 'exchangerate.host', desc: 'Broader currency coverage, updated hourly. Use it when you deal in currencies the Bank of Canada does not publish.' },
  { key: 'manual_only', name: 'Manual only', desc: 'No feed. Every rate is typed in, and foreign-currency entry is blocked on any date without one.' },
];

const FX_ACCOUNTS = [
  { key: 'realizedFxAccountCode', code: '4310', name: 'Realized gain and loss', desc: 'Posted when a foreign-currency balance is settled at a different rate' },
  { key: 'unrealizedFxAccountCode', code: '4320', name: 'Unrealized gain and loss', desc: 'Posted by the month-end revaluation run and reversed the next day' },
  { key: 'fxRoundingAccountCode', code: '4390', name: 'Rounding differences', desc: 'Absorbs sub-cent residue when a settlement does not clear exactly' },
];

export default function CurrenciesPage() {
  const router = useRouter();
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [usage, setUsage] = useState<CurrencyUsage[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then(async (json) => {
        const list = json.data ?? [];
        const activeId = document.cookie.match(/(?:^|; )lp-active-company-id=([^;]*)/)?.[1];
        const active = list.find((c: any) => c.id === activeId) || list[0];
        setCompany(active ?? null);
        // Usage counts per currency from journal lines.
        const usageRes = await fetch('/api/fx/usage');
        const usageJson = await usageRes.json().catch(() => ({ data: [] }));
        setUsage(usageJson.data ?? []);
        setEntryCount((usageJson.data ?? []).reduce((s: number, u: CurrencyUsage) => s + u.entries, 0));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setToast('Saved.');
      setTimeout(() => setToast(null), 2500);
      load();
    } catch (e: any) {
      setToast(e.message);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  if (!company) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const enabled = company.enabledCurrencies ?? ['CAD'];

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/settings')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Settings <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Currencies</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)] mb-1">Currency setup</h1>
      <p className="text-sm text-[var(--text-muted)] max-w-[640px] mb-6">
        The home currency is the spine of the ledger. Everything else is a presentation of it.
      </p>

      {toast && <div className="mb-4 text-[13px] text-[var(--success)]">{toast}</div>}

      <div className="max-w-[720px] space-y-6">
        {/* Home currency */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Home currency</div>
          <div className="flex items-baseline gap-3 mt-2">
            <span className="font-mono text-[26px] font-bold text-[var(--text-strong)]">{company.currency}</span>
            <span className="text-sm text-[var(--text-muted)]">{CURRENCIES[company.currency]?.name ?? ''}</span>
          </div>
          {entryCount > 0 ? (
            <div className="mt-4 rounded-[var(--r-lg)] bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] px-4 py-3 flex items-start gap-3">
              <Lock size={15} className="text-[var(--warning)] flex-none mt-0.5" />
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--warning)]">Locked</div>
                <div className="text-[13px] text-[var(--text-muted)] mt-1">
                  {entryCount.toLocaleString()} entries are posted in {company.currency}. Changing the home currency would restate every one of them, so it can only be done on an empty set of books.
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[var(--r-lg)] bg-[var(--success-soft)] border border-[var(--success-soft-border)] px-4 py-3">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--success)]">Still changeable</div>
              <div className="text-[13px] text-[var(--text-muted)] mt-1">
                No entries posted yet. Set this now — after the first entry it is fixed for the life of the company.
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-3">
            Every report, every total and every posted journal line is expressed in {company.currency}. Foreign-currency amounts are always recorded twice — once in the transaction currency and once here.
          </p>
        </div>

        {/* Currencies in use */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Currencies in use</div>
            <button
              onClick={() => {
                const next = [...enabled];
                const missing = Object.keys(CURRENCIES).find((c) => !next.includes(c));
                if (missing) save({ enabledCurrencies: [...next, missing] });
              }}
              className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
            >
              Add currency
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(CURRENCIES).map((ccy) => {
              const on = enabled.includes(ccy);
              const u = usage.find((x) => x.currency === ccy);
              return (
                <span
                  key={ccy}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px]',
                    on ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)]' : 'bg-[var(--surface)] border-[var(--border)]'
                  )}
                >
                  <span className={cn('font-mono font-semibold', on ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]')}>{ccy}</span>
                  <span className={on ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}>{CURRENCIES[ccy].name}</span>
                  <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                    {ccy === company.currency ? `home · ${entryCount.toLocaleString()} entries` : `${u?.entries ?? 0} entries`}
                  </span>
                  {on && ccy !== company.currency && (
                    <button
                      onClick={() => save({ enabledCurrencies: enabled.filter((c) => c !== ccy) })}
                      className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors"
                      aria-label={`Turn off ${ccy}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3">
            A currency can be turned off only when nothing is posted in it. Turning one off never affects history.
          </p>
        </div>

        {/* Rate source */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-4">Where rates come from</div>
          <div className="space-y-3">
            {RATE_SOURCES.map((src) => {
              const active = (company.rateSource ?? 'bank_of_canada') === src.key;
              return (
                <button
                  key={src.key}
                  onClick={() => save({ rateSource: src.key })}
                  className={cn(
                    'w-full text-left rounded-[var(--r-lg)] border px-4 py-3.5 transition-colors',
                    active
                      ? 'border-[var(--primary-soft-border)] bg-[var(--primary-soft)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn('w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center', active ? 'border-[var(--primary)]' : 'border-[var(--border-strong)]')}>
                      {active && <span className="w-[7px] h-[7px] rounded-full bg-[var(--primary)]" />}
                    </span>
                    <span className={cn('text-[13.5px] font-semibold', active ? 'text-[var(--primary)]' : 'text-[var(--text-strong)]')}>{src.name}</span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)] mt-1.5 pl-[26px]">{src.desc}</div>
                </button>
              );
            })}
          </div>
          {company.rateSource !== 'bank_of_canada' && (
            <p className="text-xs text-[var(--warning)] mt-3">
              Only the Bank of Canada feed is wired in this release — other sources store your preference but rates are entered manually.
            </p>
          )}
        </div>

        {/* Gain and loss accounts */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-6">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-4">Gain and loss accounts</div>
          <div className="space-y-4">
            {FX_ACCOUNTS.map((acc) => {
              const current = (company as any)[acc.key] ?? acc.code;
              return (
                <div key={acc.key} className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="text-[13.5px] font-medium text-[var(--text-strong)]">{acc.name}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{acc.desc}</div>
                  </div>
                  <div className="font-mono text-[13px] text-[var(--text-strong)]">{current} · {acc.name}</div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-4">
            All three accounts are created automatically the first time a foreign-currency entry is posted.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
