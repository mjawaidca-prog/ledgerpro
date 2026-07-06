import Link from 'next/link';
import { Check, Mail } from 'lucide-react';
import { LandingFooter } from '@/components/landing/Footer';
import { LandingNavbar } from '@/components/landing/Navbar';

const plans = [
  {
    name: 'Free Trial',
    price: '$0',
    period: '30 days',
    features: ['1 user', '1 company', '100 transactions', 'CSV export', 'Basic reports'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: false,
  },
  {
    name: 'Basic',
    price: '$29',
    period: '/mo',
    features: ['2 users', '1 company', '1,000 transactions', 'CSV and PDF export', 'Full reports', 'Email support'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$79',
    period: '/mo',
    features: ['10 users', '5 companies', '10,000 transactions', 'Bank imports', 'Custom reports', 'Budget vs actual'],
    cta: 'Start Free Trial',
    href: '/register',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: '$199',
    period: '/mo',
    features: ['50 users', '25 companies', 'Unlimited transactions', 'White label', 'API access', 'Dedicated support'],
    cta: 'Contact Sales',
    href: 'mailto:sales@nexvarlab.com',
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
            All self-serve plans include a free trial. Upgrade when your books, team, or client list grows.
          </p>
        </div>

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
      </section>
      <LandingFooter />
    </main>
  );
}
