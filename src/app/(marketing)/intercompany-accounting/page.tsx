import Link from 'next/link';
import { ArrowRight, ArrowLeftRight, FileCheck2, Landmark } from 'lucide-react';
import { LeadForm } from './LeadForm';

export const metadata = {
  title: 'Intercompany Accounting Software Canada — See the Journals in Both Companies | LedgerPro',
  description:
    'Multi company bookkeeping software for Canadian accounting and bookkeeping firms. Post one intercompany event in LedgerPro and see the journals in both companies. Request a 15-minute workflow review.',
  alternates: { canonical: 'https://ledgerpro.nexvarlab.com/intercompany-accounting' },
};

function CtaButton({ children }: { children: React.ReactNode }) {
  return (
    <a
      href="#review-form"
      className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-7 py-3.5 no-underline transition-colors"
    >
      {children} <ArrowRight size={16} />
    </a>
  );
}

export default function IntercompanyAccountingPage() {
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="max-w-3xl mx-auto px-5 pt-16 pb-12 text-center">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[var(--text-strong)] mb-6">
          Post one intercompany event and see the journals in both companies.
        </h1>
        <p className="text-lg text-[var(--text)] leading-relaxed mb-8">
          LedgerPro is accounting software built for Canadian accounting and bookkeeping firms whose
          clients run related companies — and who reconcile due-to / due-from balances between those
          companies again and again. I&apos;ll show you the workflow in 15 minutes.
        </p>
        <CtaButton>Request a 15-minute workflow review</CtaButton>
      </section>

      {/* ─── The problem ─── */}
      <section className="max-w-3xl mx-auto px-5 pb-14">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-strong)] mb-5">
          One company pays an expense for another. Where do both entries go?
        </h2>
        <div className="space-y-5 text-[var(--text)] leading-relaxed">
          <p>
            In most workflows, that one event becomes two separate manual entries in two sets of
            books — and a due-from / due-to pair that has to be chased down and agreed at
            reconciliation time.
          </p>
          <p>
            In LedgerPro, you post the event once. LedgerPro creates the journal in the company that
            paid and the matching journal in the company it paid for, so both sets of books carry
            their side of the same event — including the due-from and due-to entries that must agree
            when you reconcile.
          </p>
        </div>
      </section>

      {/* ─── The proof ─── */}
      <section className="max-w-5xl mx-auto px-5 pb-14">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-strong)] mb-5 text-center">
          The proof — one event, both journals
        </h2>

        {/*
          Proof visual slot: the synthetic two-journal screenshot (one intercompany
          event posted in a synthetic company pair, both journals captured) drops in
          here. Until it is captured, this designed panel marks the slot — it shows
          no fabricated entries or figures.
        */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          {['Paying company — journal', 'Other company — journal'].map((label) => (
            <div
              key={label}
              className="border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface)] px-6 py-10 text-center"
            >
              <ArrowLeftRight size={28} className="mx-auto text-[var(--text-faint)] mb-3" />
              <div className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">
                {label}
              </div>
              <p className="text-sm text-[var(--text-faint)]">
                Two-journal screenshot (synthetic company data) — captured from a live LedgerPro
                posting for this page.
              </p>
            </div>
          ))}
        </div>
        <p className="text-center text-[var(--text-muted)] leading-relaxed max-w-3xl mx-auto mb-8">
          The same event, both sets of books: the paying company&apos;s journal and the other
          company&apos;s journal, created from a single posting — due-from on one side, due-to on
          the other.
        </p>
        <div className="text-center">
          <CtaButton>Request a 15-minute workflow review</CtaButton>
        </div>
      </section>

      {/* ─── The offer + form ─── */}
      <section id="review-form" className="max-w-3xl mx-auto px-5 pb-14 scroll-mt-24">
        <div className="border border-[var(--border)] rounded-2xl bg-[var(--surface)] px-6 py-8 md:px-10">
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-strong)] mb-4 text-center">
            See it on a workflow like yours
          </h2>
          <p className="text-[var(--text)] leading-relaxed mb-6 text-center">
            <strong>Request a 15-minute workflow review.</strong> In 15 minutes, you&apos;ll see the
            two-company posting workflow live, using sample data, and you can bring the intercompany
            situation your firm handles most. If it fits, you can start a{' '}
            <strong>30-day free trial — no credit card required</strong> — and test a two-company
            entry with sample data yourself.
          </p>
          <LeadForm />
          <p className="text-sm text-[var(--text-muted)] text-center mt-6">
            LedgerPro plans are Basic CAD $29, Pro CAD $79 and Enterprise CAD $199 per month. The
            trial is 30 days, free, with no credit card required.
          </p>
        </div>
      </section>

      {/* ─── More proof ─── */}
      <section className="max-w-3xl mx-auto px-5 pb-14">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] px-6 py-6">
            <FileCheck2 size={24} className="text-[var(--primary)] mb-3" />
            <h3 className="font-bold text-[var(--text-strong)] mb-2">
              Preparing a T2 in CaseWare?
            </h3>
            <p className="text-sm text-[var(--text)] leading-relaxed">
              LedgerPro exports a <strong>CaseWare-compatible GIFI trial balance</strong>, so the
              year-end handoff starts from your client&apos;s actual books. Ask to see the export
              during your workflow review.
            </p>
          </div>
          <div className="border border-[var(--border)] rounded-xl bg-[var(--surface)] px-6 py-6">
            <Landmark size={24} className="text-[var(--primary)] mb-3" />
            <h3 className="font-bold text-[var(--text-strong)] mb-2">Loans, without the spreadsheet</h3>
            <p className="text-sm text-[var(--text)] leading-relaxed">
              Also built into LedgerPro: <strong>loan amortization</strong>, for clients whose loans
              need a proper schedule instead of a spreadsheet.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Payroll ─── */}
      <section className="max-w-3xl mx-auto px-5 pb-14">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-strong)] mb-4">
          What about payroll?
        </h2>
        <p className="text-[var(--text)] leading-relaxed">
          Payroll does <strong>not</strong> run inside LedgerPro. Payroll runs in{' '}
          <strong>Nexvar Pay</strong>, our separate payroll companion product: finalize a pay run in
          Nexvar Pay and the balanced journal posts automatically into LedgerPro.
        </p>
      </section>

      {/* ─── Who built this ─── */}
      <section className="max-w-3xl mx-auto px-5 pb-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-[var(--text-strong)] mb-4">
          Who built this
        </h2>
        <p className="text-[var(--text)] leading-relaxed mb-8">
          I&apos;m <strong>Muhammad Jawaid</strong>, a Calgary accountant and the founder of
          LedgerPro. This page exists because intercompany bookkeeping is the problem I built
          LedgerPro to solve first. Questions about whether it fits your firm? Email me at{' '}
          <a href="mailto:hello@nexvarlab.com" className="text-[var(--accent)] hover:text-[var(--primary)]">
            hello@nexvarlab.com
          </a>
          .
        </p>
        <CtaButton>Request a 15-minute workflow review</CtaButton>
        <p className="text-sm text-[var(--text-faint)] mt-6">
          Prefer to look around first? See the full{' '}
          <Link href="/features" className="underline">
            feature tour
          </Link>{' '}
          or{' '}
          <Link href="/pricing" className="underline">
            pricing
          </Link>
          .
        </p>
      </section>
    </>
  );
}
