import Link from 'next/link';
import {
  FileText, Receipt, Landmark, Scale, Building2, ShieldCheck,
  ArrowRight, CreditCard, Repeat, BarChart3, Users, Lock,
} from 'lucide-react';

export const metadata = {
  title: 'Features — LedgerPro',
  description: 'A tour of everything LedgerPro handles: invoicing, bills, bank reconciliation, Canadian tax reports, multi-company support, and audit-ready controls.',
};

const CATEGORIES = [
  {
    icon: FileText,
    title: 'Invoicing & Accounts Receivable',
    items: [
      'Professional invoices with per-line-item revenue categorization',
      'Payment tracking and outstanding/overdue aging',
      'Automatic posting to the general ledger on send and on payment',
    ],
  },
  {
    icon: Receipt,
    title: 'Bills & Accounts Payable',
    items: [
      'Vendor bill entry with per-line-item expense categorization',
      'Payment tracking against bills, correctly reducing Accounts Payable',
      'No generic "uncategorized expense" bucket — every dollar lands on the right account',
    ],
  },
  {
    icon: Landmark,
    title: 'Bank & Credit Card Import',
    items: [
      'CSV, OFX, and PDF statement import for both bank and credit card accounts',
      'Correct sign handling for credit cards (charges vs. payments)',
      'Automatic transfer matching between accounts — no double-counted payments',
      'Duplicate detection on import',
    ],
  },
  {
    icon: Scale,
    title: 'Real Double-Entry Ledger',
    items: [
      'Every transaction posts a balanced journal entry — debits always equal credits',
      'Balance Sheet, P&L, and Trial Balance are computed live from the ledger, never a stale cache',
      'Void instead of delete — a full audit trail of every reversal',
    ],
  },
  {
    icon: CreditCard,
    title: 'Canadian Tax & Compliance',
    items: [
      'GST/HST/PST rates by province',
      'CaseWare-compatible GIFI trial balance export for your accountant',
      'Fiscal-year-aware reporting for non-calendar fiscal years',
    ],
  },
  {
    icon: Repeat,
    title: 'Opening Balance & Migration',
    items: [
      'Opening trial balance import from QuickBooks Online or another system',
      'Full company data backup export and restore-into-new-company',
    ],
  },
  {
    icon: BarChart3,
    title: 'Reporting',
    items: [
      'Balance Sheet, Profit & Loss, Trial Balance, General Ledger, Cash Flow',
      'Comparative prior-period columns',
      'A combined Management Report Package for board or lender packages',
    ],
  },
  {
    icon: Building2,
    title: 'Multi-Company',
    items: [
      'Run more than one business from a single login',
      'Each company gets its own Chart of Accounts, fiscal year, and trial',
    ],
  },
  {
    icon: Users,
    title: 'Team & Roles',
    items: [
      'Owner, admin, and bookkeeper roles',
      'Per-plan user limits that scale with your team',
    ],
  },
  {
    icon: Lock,
    title: 'Audit Trail & Period Close',
    items: [
      'Every mutation to a posted transaction, invoice, bill, or journal entry is logged',
      'Period close controls prevent accidental edits to closed periods',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Security',
    items: [
      'Company data is strictly isolated per tenant',
      'Role-based access control on every action',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="max-w-4xl mx-auto px-5 pt-16 pb-10 text-center">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[var(--text-strong)]">
          Everything you need to run your books
        </h1>
        <p className="text-lg text-[var(--text-muted)] mt-5 max-w-2xl mx-auto leading-relaxed">
          A real double-entry ledger under the hood, built specifically for Canadian small businesses.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div className="grid sm:grid-cols-2 gap-5">
          {CATEGORIES.map((c) => (
            <div key={c.title} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[var(--primary-soft)] text-[var(--primary)] grid place-items-center flex-none">
                  <c.icon size={18} />
                </div>
                <h2 className="font-semibold text-[var(--text-strong)]">{c.title}</h2>
              </div>
              <ul className="space-y-2 list-none p-0 m-0">
                {c.items.map((item) => (
                  <li key={item} className="text-sm text-[var(--text-muted)] leading-relaxed pl-4 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--text-faint)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
