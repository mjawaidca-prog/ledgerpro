export const metadata = {
  title: 'Terms of Service — LedgerPro',
};

export default function TermsPage() {
  return (
    <section className="max-w-2xl mx-auto px-5 pt-16 pb-20">
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-strong)] mb-6">Terms of Service</h1>
      <div className="bg-[var(--warning-soft)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] mb-8">
        Placeholder page — replace this with terms of service reviewed by legal counsel before launch.
        It should cover the subscription/trial terms, acceptable use, data ownership, liability limits,
        and cancellation policy.
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Questions in the meantime? Contact <a href="mailto:sales@nexvarlab.com" className="text-[var(--primary)]">sales@nexvarlab.com</a>.
      </p>
    </section>
  );
}
