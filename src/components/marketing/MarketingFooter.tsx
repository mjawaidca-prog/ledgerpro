import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)] mt-24">
      <div className="max-w-6xl mx-auto px-5 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg grid place-items-center font-bold text-white text-xs bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-700)]">L</span>
            <span className="font-bold text-[var(--text-strong)]">Ledger<span className="text-[var(--primary)]">Pro</span></span>
          </div>
          <p className="text-[var(--text-muted)] leading-relaxed">
            Double-entry accounting built for Canadian small businesses.
          </p>
        </div>

        <div>
          <div className="font-semibold text-[var(--text-strong)] mb-3">Product</div>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><Link href="/features" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Features</Link></li>
            <li><Link href="/pricing" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Pricing</Link></li>
            <li><Link href="/register" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Start Free Trial</Link></li>
          </ul>
        </div>

        <div>
          <div className="font-semibold text-[var(--text-strong)] mb-3">Company</div>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><Link href="/about" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">About</Link></li>
            <li><Link href="/faq" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">FAQ</Link></li>
            <li><a href="mailto:sales@nexvarlab.com" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Contact Sales</a></li>
          </ul>
        </div>

        <div>
          <div className="font-semibold text-[var(--text-strong)] mb-3">Legal</div>
          <ul className="space-y-2 list-none p-0 m-0">
            <li><Link href="/privacy" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Privacy Policy</Link></li>
            <li><Link href="/terms" className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline">Terms of Service</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-5 py-5 text-xs text-[var(--text-faint)] flex flex-col md:flex-row gap-2 justify-between">
          <span>© {new Date().getFullYear()} NexVar Labs. All rights reserved.</span>
          <span>Made for Canadian small businesses.</span>
        </div>
      </div>
    </footer>
  );
}
