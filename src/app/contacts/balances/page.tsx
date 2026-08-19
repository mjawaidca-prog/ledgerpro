'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { CURRENCIES } from '@/lib/currencies';
import { N, approx } from '@/lib/fx-format';

interface BalCard {
  currency: string;
  rate: number | null;
  foreign: number;
  home: number;
  rows: { name: string; daysOverdue: number; foreign: number; home: number | null }[];
}

export default function ContactBalancesPage() {
  const router = useRouter();
  const [type, setType] = useState('customer');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<{ cards: BalCard[]; homeCurrency: string; grandTotal: number; currencyCount: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contacts/balances?type=${type}&asOf=${asOf}`)
      .then((r) => r.json())
      .then((json) => setData(json.data ?? null))
      .finally(() => setLoading(false));
  }, [type, asOf]);

  const label = type === 'customer' ? 'Receivables' : 'Payables';

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/contacts')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Contacts <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Balances by Currency</strong>
        </span>
      </div>

      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Balances by currency</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px]">
            Amounts owed are never summed across currencies. Each currency totals on its own, with a translated figure underneath for context.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            options={[
              { value: 'customer', label: 'Receivables' },
              { value: 'supplier', label: 'Payables' },
            ]}
            value={type}
            onChange={setType}
          />
          <div className="font-mono text-[11px] text-[var(--text-faint)]">
            as at <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none" /> · closing rates
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : !data || data.cards.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-base font-semibold text-[var(--text-strong)]">Every balance is in CAD</div>
          <div className="text-sm text-[var(--text-muted)] mt-1.5">
            No customer or vendor is set to a foreign currency, so there is nothing to group. Set a currency on a contact and its balances will appear here separately.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {data.cards.map((card) => {
            const isHome = card.currency === data.homeCurrency;
            const name = CURRENCIES[card.currency]?.name ?? card.currency;
            return (
              <div key={card.currency} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
                <div className="flex items-baseline gap-3 px-5 py-3.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
                  <span className="font-mono text-[15px] font-bold text-[var(--text-strong)]">{card.currency}</span>
                  <span className="text-[13px] text-[var(--text-muted)]">{name}{isHome ? ' · home' : ''}</span>
                  <div className="flex-1" />
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">{isHome ? 'no translation' : `@ ${card.rate ? card.rate.toFixed(4) : '—'}`}</span>
                  <span className="font-mono text-[14px] font-semibold tabular-nums text-[var(--text-strong)]">
                    {N(card.foreign)} {card.currency}
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)] w-[150px] text-right">
                    {isHome ? 'home currency' : approx(card.home, data.homeCurrency)}
                  </span>
                </div>
                {card.rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 text-[13px]">
                    <span className="flex-1 text-[var(--text)]">{r.name}</span>
                    <span className="font-mono text-[11px] text-[var(--text-faint)] w-[80px] text-right">
                      {r.daysOverdue <= 0 ? 'current' : `${r.daysOverdue} days`}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)] w-[130px] text-right">{N(r.foreign)} {card.currency}</span>
                    <span className="font-mono text-[12px] tabular-nums text-[var(--text-faint)] w-[150px] text-right">
                      {isHome ? '' : r.home !== null ? N(r.home, { suffix: data.homeCurrency }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Grand total — explicitly informational */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 flex items-baseline gap-4">
            <div>
              <div className="text-[15px] font-bold text-[var(--text-strong)]">Total {label.toLowerCase()}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                {data.currencyCount} currencies, translated at today&apos;s closing rates
              </div>
            </div>
            <div className="flex-1" />
            <span className="font-mono text-[26px] font-bold tabular-nums text-[var(--text-strong)]">{N(data.grandTotal)}</span>
            <span className="font-mono text-[12px] text-[var(--text-muted)] w-[190px] text-right">
              CAD equivalent · not a bookable figure
            </span>
          </div>
        </div>
      )}
    </AppShell>
  );
}
