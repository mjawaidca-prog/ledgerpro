export const metadata = {
  title: 'Privacy Policy — LedgerPro',
};

export default function PrivacyPage() {
  return (
    <section className="max-w-2xl mx-auto px-5 pt-16 pb-20">
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-strong)] mb-6">Privacy Policy</h1>
      <div className="bg-[var(--warning-soft)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text)] mb-8">
        Placeholder page — replace this with a privacy policy reviewed by legal counsel before launch.
        It should describe what data LedgerPro collects, how it's stored and secured, whether it's shared
        with third parties (e.g. payment processing, email delivery), and how users can request deletion
        of their data.
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Questions in the meantime? Contact <a href="mailto:sales@nexvarlab.com" className="text-[var(--primary)]">sales@nexvarlab.com</a>.
      </p>
    </section>
  );
}
