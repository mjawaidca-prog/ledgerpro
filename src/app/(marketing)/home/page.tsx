import Link from 'next/link';
import {
  FileText, Receipt, Landmark, Scale, Building2, ShieldCheck,
  ArrowRight, Check, MapPin,
} from 'lucide-react';

export const metadata = {
  title: 'LedgerPro — Accounting Software for Canadian Small Businesses',
  description: 'Double-entry accounting, invoicing, bank reconciliation, and tax-ready reports built for Canadian small businesses. Start your free 30-day trial.',
};

const FEATURES = [
  { icon: FileText, title: 'Invoicing & Bills', desc: 'Send professional invoices, track payments, and manage vendor bills — all posted correctly to your books automatically.' },
  { icon: Landmark, title: 'Bank Import & Reconciliation', desc: 'Import CSV, OFX, or PDF statements for both bank and credit card accounts, with smart transfer matching and categorization.' },
  { icon: Scale, title: 'Real Double-Entry Ledger', desc: 'Every transaction posts a balanced journal entry. Balance Sheet, P&L, and Trial Balance are always in sync — never a stale cache.' },
  { icon: Receipt, title: 'Canadian Tax Reports', desc: 'GST/HST/PST tracked by province, CaseWare-compatible GIFI trial balance export, and fiscal-year-aware reporting.' },
  { icon: Building2, title: 'Multi-Company', desc: 'Run more than one business from a single login, each with its own books, Chart of Accounts, and fiscal year.' },
  { icon: ShieldCheck, title: 'Audit Trail & Period Close', desc: 'Void instead of delete, full audit logging, and period close controls — built for accountability, not just bookkeeping.' },
];

const TESTIMONIALS = [
  { quote: 'Placeholder testimonial — replace with real customer feedback before launch.', name: 'Customer Name', role: 'Business Owner' },
  { quote: 'Placeholder testimonial — replace with real customer feedback before launch.', name: 'Customer Name', role: 'Bookkeeper' },
  { quote: 'Placeholder testimonial — replace with real customer feedback before launch.', name: 'Customer Name', role: 'Accountant' },
];

export default function MarketingHomePage() {
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="max-w-6xl mx-auto px-5 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--primary)] bg-[var(--primary-soft)] rounded-full px-3 py-1.5 mb-6">
          <MapPin size={13} /> Built for Canadian small businesses
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-[var(--text-strong)] max-w-3xl mx-auto">
          Accounting software that keeps your books actually correct
        </h1>
        <p className="text-lg text-[var(--text-muted)] max-w-2xl mx-auto mt-6 leading-relaxed">
          Invoicing, expenses, bank reconciliation, and tax-ready reports — powered by a real double-entry
          ledger, not a spreadsheet pretending to be one. GST/HST/PST and GIFI export included.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-9">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-6 py-3 no-underline transition-colors"
          >
            Start Free 30-Day Trial <ArrowRight size={16} />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)] rounded-md px-6 py-3 no-underline transition-colors"
          >
            See Pricing
          </Link>
        </div>
        <p className="text-xs text-[var(--text-faint)] mt-4">No credit card required.</p>
      </section>

      {/* ─── Feature grid ─── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-strong)]">Everything your books need, in one place</h2>
          <p className="text-[var(--text-muted)] mt-3">No add-ons to bolt on later — it's all here from day one.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] grid place-items-center mb-4">
                <f.icon size={20} />
              </div>
              <h3 className="font-semibold text-[var(--text-strong)] mb-2">{f.title}</h3>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Canadian tax section ─── */}
      <section className="bg-[var(--surface)] border-y border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-5 py-16 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-strong)] mb-4">Made for how Canadian books actually work</h2>
            <p className="text-[var(--text-muted)] leading-relaxed mb-5">
              Most accounting software treats Canadian tax as an afterthought. LedgerPro builds it in from the ground up.
            </p>
            <ul className="space-y-3">
              {[
                'GST/HST/PST rates by province, applied automatically',
                'CaseWare-compatible GIFI trial balance export for your accountant',
                'Fiscal-year-aware reports — not just calendar year',
                'Opening trial balance import when you switch from another system',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-[var(--text)]">
                  <Check size={16} className="text-[var(--success)] mt-0.5 flex-none" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-8 text-center">
            <Scale size={40} className="mx-auto text-[var(--primary)] mb-4" />
            <p className="text-sm text-[var(--text-muted)]">
              Every province's GST/HST/PST rate, current and ready to apply — no manual tax table maintenance.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Testimonials (placeholder) ─── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-strong)]">What customers say</h2>
          <p className="text-xs text-[var(--text-faint)] mt-2">(Placeholder — swap in real customer quotes before launch.)</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t, i) => (
            <div key={i} className="bg-[var(--surface)] border border-dashed border-[var(--border-strong)] rounded-xl p-6">
              <p className="text-sm text-[var(--text-muted)] italic leading-relaxed mb-4">&ldquo;{t.quote}&rdquo;</p>
              <div className="text-sm font-semibold text-[var(--text-strong)]">{t.name}</div>
              <div className="text-xs text-[var(--text-faint)]">{t.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="max-w-4xl mx-auto px-5 py-20 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-strong)] mb-4">Ready to see it for yourself?</h2>
        <p className="text-[var(--text-muted)] mb-8">Start your free 30-day trial — no credit card required.</p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-7 py-3.5 no-underline transition-colors"
        >
          Start Free Trial <ArrowRight size={16} />
        </Link>
      </section>
    </>
  );
}
