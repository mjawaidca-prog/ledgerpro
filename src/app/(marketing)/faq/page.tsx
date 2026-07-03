import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = {
  title: 'FAQ — LedgerPro',
  description: 'Answers to common questions about LedgerPro: pricing, trials, data security, Canadian tax support, and migrating from another system.',
};

const FAQS = [
  {
    q: 'What is LedgerPro?',
    a: 'LedgerPro is double-entry accounting software built for Canadian small businesses — invoicing, bills, bank reconciliation, and tax-ready reports, all backed by a real general ledger rather than a spreadsheet.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — every plan starts with a 30-day free trial, no credit card required.',
  },
  {
    q: 'What happens when my trial ends?',
    a: "You'll be prompted to choose a paid plan to keep using LedgerPro. Your data is preserved either way — nothing is deleted when a trial ends.",
  },
  {
    q: 'Can I run more than one company?',
    a: 'Yes. You can add additional companies under a single login, each with its own Chart of Accounts, fiscal year, and books, subject to your plan\'s company limit.',
  },
  {
    q: 'Does LedgerPro handle GST/HST/PST?',
    a: "Yes, sales tax rates are tracked by province and applied automatically on invoices and bills.",
  },
  {
    q: 'Can my accountant get a GIFI trial balance for tax filing?',
    a: 'Yes — LedgerPro exports a CaseWare-compatible GIFI trial balance directly from Chart of Accounts and reporting.',
  },
  {
    q: 'Can I import my existing books from another system?',
    a: 'Yes — LedgerPro supports importing an opening trial balance (for example from QuickBooks Online) so you don\'t have to re-enter historical balances.',
  },
  {
    q: 'What if my fiscal year doesn\'t start January 1?',
    a: 'LedgerPro reports are fiscal-year-aware — Balance Sheet, P&L, and the Management Report Package all follow the fiscal year you set for your company, not the calendar year.',
  },
  {
    q: 'How does bank statement import work?',
    a: 'Upload a CSV, OFX, or PDF statement for a bank or credit card account. LedgerPro parses transactions, applies correct sign handling for credit cards, flags likely duplicates, and suggests transfer matches between your own accounts.',
  },
  {
    q: 'Can I export my data if I want to leave?',
    a: 'Yes — a full company data backup can be downloaded at any time from Settings, independent of your hosting provider\'s own backups.',
  },
  {
    q: 'Is my data secure and isolated from other companies?',
    a: 'Yes — every request is scoped to the company you\'re a verified member of; there is no cross-company data access.',
  },
];

export default function FAQPage() {
  return (
    <>
      <section className="max-w-3xl mx-auto px-5 pt-16 pb-10 text-center">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[var(--text-strong)]">
          Frequently asked questions
        </h1>
      </section>

      <section className="max-w-3xl mx-auto px-5 pb-16">
        <div className="divide-y divide-[var(--border)] border-t border-b border-[var(--border)]">
          {FAQS.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex items-center justify-between cursor-pointer list-none font-semibold text-[var(--text-strong)]">
                {item.q}
                <span className="text-[var(--text-faint)] group-open:rotate-45 transition-transform text-xl leading-none">+</span>
              </summary>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed mt-3">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-5 pb-20 text-center">
        <p className="text-[var(--text-muted)] mb-6">Still have questions?</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="mailto:sales@nexvarlab.com"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)] rounded-md px-6 py-3 no-underline transition-colors"
          >
            Contact Sales
          </a>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-6 py-3 no-underline transition-colors"
          >
            Start Free Trial <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </>
  );
}
