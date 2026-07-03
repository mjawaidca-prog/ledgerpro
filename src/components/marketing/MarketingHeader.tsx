'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/home" className="flex items-center gap-2 no-underline">
          <span className="w-8 h-8 rounded-lg grid place-items-center font-bold text-white text-sm bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-700)]">
            L
          </span>
          <span className="font-bold text-[var(--text-strong)]">
            Ledger<span className="text-[var(--primary)]">Pro</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-[var(--text-muted)] hover:text-[var(--text-strong)] no-underline transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-[var(--text)] no-underline px-3 py-2">
            Sign In
          </Link>
          <Link
            href="/register"
            className="text-sm font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-md px-4 py-2 no-underline transition-colors"
          >
            Start Free Trial
          </Link>
        </div>

        <button
          className="md:hidden p-2 text-[var(--text)]"
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 flex flex-col gap-4">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-[var(--text)] no-underline" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="h-px bg-[var(--border)]" />
          <Link href="/login" className="text-sm text-[var(--text)] no-underline">Sign In</Link>
          <Link href="/register" className="text-sm font-semibold text-white bg-[var(--primary)] rounded-md px-4 py-2 no-underline text-center">
            Start Free Trial
          </Link>
        </div>
      )}
    </header>
  );
}
