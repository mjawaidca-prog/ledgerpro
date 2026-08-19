'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { N, SIGNED, isZeroDecimal } from '@/lib/fx-format';

interface TxRow {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  currency?: string;
  fxRate?: string | number | null;
  amountHome?: string | number | null;
  status: string;
}

interface Props {
  accountId: string;
  accountCurrency: string;
  accountName: string;
  accountCode: string | null;
  homeCurrency: string;
}

interface RateMap {
  [date: string]: { rate: number | null; stale: boolean; staleDays: number; source: string };
}

/**
 * Foreign-currency bank account view: three summary tiles (account balance,
 * carrying value, unrealized at today's rate) and a per-row table with the
 * rate each movement used.
 */
export default function FxAccountView({ accountId, accountCurrency, accountName, accountCode, homeCurrency }: Props) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [rates, setRates] = useState<RateMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/transactions?accountId=${accountId}&limit=500&status=all`)
      .then((r) => r.json())
      .then(async (json) => {
        const list: TxRow[] = json.data ?? [];
        setRows(list);

        // Bulk-resolve the rate for each unposted row's own date.
        const dates = [...new Set(list.filter((t) => !t.fxRate).map((t) => t.date))];
        if (dates.length && accountCurrency !== homeCurrency) {
          try {
            const res = await fetch(`/api/fx/rate?from=${accountCurrency}&to=${homeCurrency}&dates=${dates.join(',')}`);
            const rjson = await res.json();
            setRates(rjson.data ?? {});
          } catch {
            /* rates stay empty — rows render without a rate */
          }
        }
      })
      .finally(() => setLoading(false));
  }, [accountId, accountCurrency, homeCurrency]);

  const balanceForeign = rows.reduce((s, t) => s + Number(t.amount), 0);
  const carryingHome = rows.reduce((s, t) => s + Number(t.amountHome ?? 0), 0);
  const todayRate = Object.values(rates)[0]?.rate ?? null;
  const revaluedToday = todayRate ? Math.round(balanceForeign * todayRate * 100) / 100 : null;
  const unrealized = revaluedToday !== null ? Math.round((revaluedToday - carryingHome) * 100) / 100 : null;

  const rateFor = (t: TxRow): number | null => {
    if (t.fxRate) return Number(t.fxRate);
    const r = rates[t.date];
    return r?.rate ?? null;
  };

  return (
    <div className="space-y-4">
      {/* Three summary tiles */}
      <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Account balance</div>
          <div className="font-mono text-[26px] font-bold tabular-nums text-[var(--text-strong)] mt-2">
            {N(balanceForeign, { zeroDecimals: isZeroDecimal(accountCurrency) })} {accountCurrency}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">The account&apos;s own currency — what the bank shows</div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Carrying value</div>
          <div className="font-mono text-[26px] font-bold tabular-nums text-[var(--text-strong)] mt-2">
            {N(carryingHome, { suffix: homeCurrency })}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Sum of each deposit and withdrawal at its own rate</div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Unrealized at today&apos;s rate</div>
          <div className={cn('font-mono text-[26px] font-bold tabular-nums mt-2', unrealized !== null && unrealized < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>
            {unrealized !== null ? SIGNED(unrealized, { suffix: homeCurrency }) : '—'}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {todayRate ? `At ${todayRate.toFixed(4)} the balance is worth ${N(revaluedToday!, { suffix: homeCurrency })}` : 'Nothing to revalue'}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--text-strong)]">{accountName} · {accountCode ?? '—'}</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--primary-soft)] border border-[var(--primary-soft-border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--primary)]">
            Foreign currency
          </span>
        </div>
        <div className="grid grid-cols-[110px_1fr_90px_120px_120px_130px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          <div>Date</div>
          <div>Description</div>
          <div className="text-right">Rate</div>
          <div className="text-right">Amount {accountCurrency}</div>
          <div className="text-right">Amount {homeCurrency}</div>
          <div>Status</div>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-[var(--text-muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-sm font-semibold text-[var(--text-strong)]">No transactions in this {accountCurrency} account yet</div>
            <div className="text-xs text-[var(--text-muted)] mt-1 max-w-[460px] mx-auto">
              Import a statement or add a transaction. Amounts stay in {accountCurrency}; LedgerPro records the home-currency value at each transaction&apos;s own rate.
            </div>
          </div>
        ) : (
          <>
            {rows.map((t) => {
              const rate = rateFor(t);
              const home = t.amountHome !== null && t.amountHome !== undefined ? Number(t.amountHome) : rate ? Math.round(Math.abs(Number(t.amount)) * rate * 100) / 100 : null;
              return (
                <div key={t.id} className="grid grid-cols-[110px_1fr_90px_120px_120px_130px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
                  <div className="font-mono text-[var(--text)]">{format(new Date(t.date), 'MMM d, yyyy')}</div>
                  <div className="min-w-0">
                    <div className="text-[var(--text-strong)] truncate">{t.merchant || t.description}</div>
                    <div className="font-mono text-[10.5px] text-[var(--text-faint)] mt-0.5">{t.description}</div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{rate ? rate.toFixed(4) : '—'}</div>
                  <div className={cn('text-right font-mono tabular-nums', Number(t.amount) > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                    {SIGNED(Number(t.amount), { suffix: accountCurrency })}
                  </div>
                  <div className="text-right font-mono text-[12.5px] tabular-nums text-[var(--text-faint)]">{home !== null ? N(home, { suffix: homeCurrency }) : '—'}</div>
                  <div>
                    {t.status === 'categorized' ? <Badge variant="paid">Categorized</Badge>
                      : t.status === 'reconciled' ? <Badge variant="info">Matched</Badge>
                      : t.status === 'excluded' ? <Badge variant="draft">Excluded</Badge>
                      : <Badge variant="pending">To Review</Badge>}
                  </div>
                </div>
              );
            })}
            <div className="grid grid-cols-[110px_1fr_90px_120px_120px_130px] px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)] font-bold text-[13px]">
              <div />
              <div className="text-[var(--text-strong)]">Closing balance</div>
              <div />
              <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{N(balanceForeign, { zeroDecimals: isZeroDecimal(accountCurrency) })}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text-strong)]">{N(carryingHome, { suffix: homeCurrency })}</div>
              <div />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
