import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

const rows = [
  { label: 'Sales revenue', amount: '+ $12,480.00', positive: true },
  { label: 'GST/HST payable', amount: '- $1,622.40', positive: false },
  { label: 'Office supplies', amount: '- $318.75', positive: false },
  { label: 'Bank - RBC chequing', amount: '+ $10,538.85', positive: true },
];

export function LandingHero() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-12 pt-16 md:pt-[72px]">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
        <div>
          <span className="inline-flex max-w-full items-center rounded-full border border-[#f2d6d4] bg-[var(--primary-soft)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--primary-hover)]">
            Built for Canadian small businesses and accountants
          </span>
          <h1 className="mt-6 max-w-[760px] text-4xl font-black leading-[1.05] text-[var(--text-strong)] md:text-6xl">
            Accounting that keeps your books <span className="text-[var(--primary)]">actually correct</span>.
          </h1>
          <p className="mt-5 max-w-[600px] text-lg leading-relaxed text-[var(--text)] md:text-xl">
            Invoicing, expenses, bank reconciliation and tax-ready reports powered by a real double-entry ledger.
            GST/HST/PST and GIFI export are included.
          </p>
          <div className="mb-3.5 mt-8 flex flex-wrap gap-3.5">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-7 py-3.5 text-base font-semibold text-white no-underline transition-colors hover:bg-[var(--primary-hover)]"
            >
              Start Free 30-Day Trial <ArrowRight size={18} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-7 py-3.5 text-base font-semibold text-[var(--text-strong)] no-underline hover:border-slate-300"
            >
              See Pricing
            </Link>
          </div>
          <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <ShieldCheck size={16} className="text-[var(--primary)]" />
            No credit card required. Cancel anytime.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_30px_60px_-30px_rgba(15,23,42,.28)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[#fbfbfa] px-3.5 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="ml-3 truncate text-xs font-medium text-[var(--text-muted)]">
              ledgerpro.app / Journal / FY 2026
            </span>
          </div>
          <div className="p-4">
            <div className="flex justify-between px-3 pb-2.5 text-xs font-bold uppercase text-[var(--text-muted)]">
              <span>Account</span>
              <span>Amount</span>
            </div>
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={`flex items-center justify-between px-3 py-3 text-sm ${index ? 'border-t border-[#f4f4f2]' : ''}`}
              >
                <span className="font-medium text-[var(--text)]">{row.label}</span>
                <span className={`font-bold ${row.positive ? 'text-green-700' : 'text-[var(--primary)]'}`}>
                  {row.amount}
                </span>
              </div>
            ))}
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--dark)] p-3.5 text-white">
              <span className="text-sm opacity-75">Trial balance</span>
              <span className="text-xl font-extrabold">In balance</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
