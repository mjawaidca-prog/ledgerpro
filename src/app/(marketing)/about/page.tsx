import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'About — LedgerPro',
  description: 'Why LedgerPro exists: accounting software built specifically for how Canadian small businesses actually keep their books.',
};

export default function AboutPage() {
  return (
    <>
      <section className="max-w-3xl mx-auto px-5 pt-16 pb-16">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[var(--text-strong)] mb-8">
          Why we built LedgerPro
        </h1>

        <div className="space-y-5 text-[var(--text)] leading-relaxed">
          <p>
            Most accounting software is built for a generic, one-size-fits-all business — and treats
            Canadian tax rules, fiscal years, and GIFI reporting as an afterthought bolted on later.
            LedgerPro starts from the opposite direction: a real double-entry ledger, with GST/HST/PST,
            fiscal-year-aware reporting, and CaseWare-compatible GIFI export built in from day one.
          </p>
          <p>
            Every transaction in LedgerPro posts a balanced journal entry. Reports are computed live from
            that ledger, not from a cache that can drift out of sync with reality. Nothing is ever hard
            deleted — corrections are voided and reversed, so there's always a clean audit trail behind
            every number.
          </p>
          <p>
            We're building this for the owners, bookkeepers, and accountants who actually have to trust
            these numbers at year end — not just look at a nice dashboard.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-20 text-center">
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
