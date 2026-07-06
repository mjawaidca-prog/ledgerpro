import { Building2, FileText, Landmark, Leaf, Scale, ShieldCheck } from 'lucide-react';

const FEATURES = [
  {
    icon: FileText,
    title: 'Invoicing and Bills',
    body: 'Send professional invoices, track payments, and manage vendor bills with balanced postings created automatically.',
  },
  {
    icon: Landmark,
    title: 'Bank Import and Reconciliation',
    body: 'Import CSV, OFX, QFX, and PDF statements for bank and card accounts with transfer matching and categorization.',
  },
  {
    icon: Scale,
    title: 'Real Double-Entry Ledger',
    body: 'Every transaction posts a balanced journal entry, keeping the Balance Sheet, P&L, and Trial Balance in sync.',
  },
  {
    icon: Leaf,
    title: 'Canadian Tax Reports',
    body: 'Track GST/HST/PST by province, prepare fiscal-year reports, and export GIFI data for your accountant.',
  },
  {
    icon: Building2,
    title: 'Multi-Company',
    body: 'Run more than one business from a single login, each with its own books, Chart of Accounts, and fiscal year.',
  },
  {
    icon: ShieldCheck,
    title: 'Audit Trail and Period Close',
    body: 'Void instead of delete, review a full audit trail, and close periods with controls built for accountability.',
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="border-y border-[var(--border)] bg-[var(--card)] py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-xs font-bold uppercase text-[var(--primary)]">Everything in one place</span>
          <h2 className="mt-3.5 text-4xl font-extrabold leading-tight text-[var(--text-strong)]">
            Everything your books need, in one place
          </h2>
          <p className="mt-3 text-lg text-[var(--text)]">No add-ons to bolt on later. It is all here from day one.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-[var(--border)] bg-[var(--app-bg)] p-6 transition hover:-translate-y-1 hover:border-[#e2ddd8] hover:shadow-[0_18px_30px_-20px_rgba(15,23,42,.25)]"
            >
              <div className="mb-4 grid h-[46px] w-[46px] place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
                <Icon size={23} />
              </div>
              <h3 className="mb-2 text-lg font-bold text-[var(--text-strong)]">{title}</h3>
              <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
