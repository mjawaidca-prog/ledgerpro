import Link from 'next/link';
import { PRODUCTS } from '@/lib/brand';

export function LandingNavbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--app-bg)]/90 backdrop-blur">
      <nav className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5 font-extrabold text-xl no-underline">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-lg bg-[var(--dark)] text-lg font-black text-white">
            L
          </span>
          <span className="text-[var(--text-strong)]">
            Ledger<span className="text-[var(--primary)]">Pro</span>
          </span>
        </Link>

        <div className="hidden rounded-full border border-[var(--border)] bg-[var(--card)] p-[3px] text-[13px] font-semibold md:flex">
          <span className="rounded-full bg-[var(--dark)] px-3.5 py-1.5 text-white">Ledger</span>
          <a
            href={PRODUCTS.pay.url}
            className="rounded-full px-3.5 py-1.5 text-[var(--text-muted)] no-underline hover:text-[var(--text-strong)]"
          >
            Payroll
          </a>
        </div>

        <div className="hidden items-center gap-7 text-[15px] font-medium text-[var(--text)] lg:flex">
          <a href="/#features" className="no-underline hover:text-[var(--text-strong)]">Features</a>
          <a href="/#canadian" className="no-underline hover:text-[var(--text-strong)]">Canadian Tax</a>
          <Link href="/pricing" className="no-underline hover:text-[var(--text-strong)]">Pricing</Link>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/login" className="text-[15px] font-semibold text-[var(--text-strong)] no-underline">
            Sign In
          </Link>
          <Link
            href="/register"
            className="hidden rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--primary-hover)] sm:inline-flex"
          >
            Start Free Trial
          </Link>
        </div>
      </nav>
    </header>
  );
}
