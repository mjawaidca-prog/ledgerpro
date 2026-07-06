import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function FinalCta() {
  return (
    <section className="border-y border-[var(--border)] bg-[var(--card)] py-20 text-center">
      <div className="mx-auto max-w-6xl px-5">
        <span className="text-xs font-bold uppercase text-[var(--primary)]">Ready when you are</span>
        <h2 className="mb-3.5 mt-3.5 text-4xl font-extrabold leading-tight text-[var(--text-strong)] md:text-5xl">
          Ready to see it for yourself?
        </h2>
        <p className="mb-7 text-lg text-[var(--text)] md:text-xl">Start your free 30-day trial. No credit card required.</p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-7 py-3.5 text-base font-semibold text-white no-underline transition-colors hover:bg-[var(--primary-hover)]"
        >
          Start Free Trial <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}
