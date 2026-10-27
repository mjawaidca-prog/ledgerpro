import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Mail } from 'lucide-react';
import { LandingFooter } from '@/components/landing/Footer';
import { LandingNavbar } from '@/components/landing/Navbar';

export const metadata: Metadata = {
  title: 'Pricing for Canadian Small Business Accounting',
  description: 'Compare LedgerPro accounting plans for Canadian small businesses, bookkeepers, and accountants. Start with a free 30-day trial.',
  alternates: { canonical: 'https://ledgerpro.nexvarlab.com/pricing' },
};

const plans = [
  {
    name: 'Free Trial',
    price: '$0',
    period: '30 days',
    annualPrice: '', oneTime: '',
    features: ['1 user', '1 company', '100 transactions', 'CSV export', 'Basic reports'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: false,
  },
  {
    name: 'Basic',
    price: '$29',
    period: '/mo',
    annualPrice: '$290/yr', oneTime: '$299 one-time',
    features: ['2 users', '1 company', '1,000 transactions', 'CSV and PDF export', 'Full reports', 'Email support'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$79',
    period: '/mo',
    annualPrice: '$790/yr', oneTime: '$799 one-time',
    features: ['10 users', '5 companies', '10,000 transactions', 'Bank imports', 'Custom reports', 'Budget vs actual', 'API access', 'Payroll sync with Nexvar Pay'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: '$199',
    period: '/mo',
    annualPrice: '$1,990/yr', oneTime: '$1,999 one-time',
    features: ['50 users', '25 companies', 'Unlimited transactions', 'White label', 'API access', 'Payroll sync with Nexvar Pay', 'Dedicated support'],
    cta: 'Contact Sales',
    href: 'mailto:hello@nexvarlab.online',
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[var(--app-bg)]">
      <LandingNavbar />
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <span className="text-xs font-bold uppercase text-[var(--primary)]">Pricing</span>
          <h1 className="mt-3.5 text-4xl font-black leading-tight text-[var(--text-strong)] md:text-5xl">
            Simple plans for Canadian small businesses
          </h1>
          <p className="mt-4 text-lg text-[var(--text)]">
            All self-serve plans include a free trial. Upgrade when your books, team, or client list grows. New: prefer to pay once? One-time Basic $299 or One-time Pro $799 covers the lifetime of that plan tier or 5 years from purchase, whichever comes first - limited to our first 250 founding customers.
          </p>
        </div>
        <div className="mx-auto mb-8 max-w-2xl rounded-lg border border-[var(--primary)] bg-[var(--card)] px-4 py-3 text-center text-sm font-semibold text-[var(--primary)]">Limited-time offer: one-time lifetime pricing below is available for a limited period and may be withdrawn at any time.</div>

        <div className="grid gap-5 lg:grid-cols-4">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-xl border bg-[var(--card)] p-7 shadow-[var(--shadow-sm)] ${
                plan.featured ? 'border-[var(--primary)] shadow-[0_18px_40px_-28px_rgba(179,38,30,.65)]' : 'border-[var(--border)]'
              }`}
            >
              {plan.featured && (
                <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)] px-4 py-1 text-[11px] font-bold uppercase text-white">
                  Most Popular
                </div>
              )}
              <h2 className="text-lg font-extrabold text-[var(--text-strong)]">{plan.name}</h2>
              <div className="mb-5 mt-4">
                <span className="text-4xl font-black text-[var(--text-strong)]">{plan.price}</span>
                <span className="ml-1 text-sm text-[var(--text-muted)]">{plan.period}</span>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{plan.annualPrice}</p>
              <p className="mt-1 text-xs font-semibold text-[var(--primary)]">{plan.oneTime}</p>
              </div>
              <ul className="mb-7 grid gap-3 text-sm text-[var(--text)]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.href.startsWith('mailto:') ? (
                <a
                  href={plan.href}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)] no-underline hover:border-[var(--primary)]"
                >
                  <Mail size={16} /> {plan.cta}
                </a>
              ) : (
                <Link
                  href={plan.href}
                  className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold no-underline ${
                    plan.featured
                      ? 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'
                      : 'border border-[var(--border)] bg-[var(--card)] text-[var(--text-strong)] hover:border-[var(--primary)]'
                  }`}
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-[var(--text-muted)]">One-time (lifetime) purchases include access to the current product tier for the lifetime of that tier or 5 years from purchase, whichever comes first, and are limited to our first 250 founding customers. This one-time offer is available for a limited period only and may be withdrawn at any time. Annual pricing reflects two months free versus paying monthly.</p>

        <div className="mx-auto mt-16 max-w-5xl rounded-xl border border-[var(--border)] bg-[var(--card)] p-7 shadow-[var(--shadow-sm)] md:p-9">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase text-[var(--primary)]">Add payroll</span>
            <h2 className="mt-2 text-2xl font-extrabold text-[var(--text-strong)]">Need payroll too? Add Nexvar Pay.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text)]">
              Payroll runs in <strong>Nexvar Pay</strong>, our Canadian payroll product — and the two connect:
              finalize a pay run there and the balanced journal posts itself here, labelled Payroll — Nexvar Pay.
              No forced bundle and no re-typing totals. The sync uses the API access included in Pro and Enterprise.
            </p>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                  <th className="py-2 pr-3 font-semibold">Employees</th>
                  <th className="py-2 pr-3 font-semibold">Nexvar Pay Solo</th>
                  <th className="py-2 pr-3 font-semibold">Nexvar Pay Growth</th>
                  <th className="py-2 font-semibold">LedgerPro Pro + Growth, combined</th>
                </tr>
              </thead>
              <tbody className="text-[var(--text)]">
                <tr className="border-b border-[var(--border)]"><td className="py-2 pr-3">1</td><td className="py-2 pr-3">$9/mo</td><td className="py-2 pr-3">$21/mo</td><td className="py-2">$100/mo</td></tr>
                <tr className="border-b border-[var(--border)]"><td className="py-2 pr-3">5</td><td className="py-2 pr-3">$17/mo</td><td className="py-2 pr-3">$29/mo</td><td className="py-2">$108/mo</td></tr>
                <tr className="border-b border-[var(--border)]"><td className="py-2 pr-3">10</td><td className="py-2 pr-3">$27/mo</td><td className="py-2 pr-3">$39/mo</td><td className="py-2">$118/mo</td></tr>
                <tr><td className="py-2 pr-3">25</td><td className="py-2 pr-3">$57/mo</td><td className="py-2 pr-3">$69/mo</td><td className="py-2">$148/mo</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Nexvar Pay: Solo $7/mo + $2 per employee; Growth $19/mo + $2 per employee; Accountant $49/mo + $1.50 per employee for firms running many companies.
            Combined column pairs LedgerPro Pro ($79/mo) with Nexvar Pay Growth. Prices in CAD, before tax.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="https://nexvarpay.nexvarlab.com" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center rounded-lg bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white no-underline hover:bg-[var(--primary-hover)]">
              Start Nexvar Pay free trial
            </a>
            <Link href="/payroll" className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text-strong)] no-underline hover:border-[var(--primary)]">
              See how the sync works
            </Link>
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">Nexvar Pay starts with a 14-day free trial, no credit card required. Already a LedgerPro customer? The Payroll page in your account shows your connection status.</p>
        </div>
      </section>
      <LandingFooter />
    </main>
  );
}
