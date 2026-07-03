import Link from 'next/link';
import { Check } from 'lucide-react';

export const metadata = {
  title: 'Pricing — LedgerPro',
  description: 'Simple, transparent pricing for LedgerPro. All plans include a 30-day free trial, no credit card required.',
};

const PLANS = [
  { name: 'Free Trial', price: '$0', period: '30 days', features: ['1 user', '1 company', '100 transactions', 'CSV export', 'Basic reports'], cta: 'Start Free Trial', href: '/register', featured: false },
  { name: 'Basic', price: '$29', period: '/mo', features: ['2 users', '1 company', '1,000 transactions', 'CSV + PDF export', 'Full reports', 'Email support'], cta: 'Start Free Trial', href: '/register', featured: false },
  { name: 'Pro', price: '$79', period: '/mo', features: ['10 users', '5 companies', '10,000 transactions', 'Bank feeds', 'Custom reports', 'Priority support', 'Budget vs Actual'], cta: 'Start Free Trial', href: '/register', featured: true },
  { name: 'Enterprise', price: '$199', period: '/mo', features: ['50 users', '25 companies', 'Unlimited transactions', 'White label', 'API access', 'Dedicated support', 'All features'], cta: 'Contact Sales', href: 'mailto:sales@nexvarlab.com', featured: false },
];

export default function PricingPage() {
  return (
    <section className="max-w-6xl mx-auto px-5 pt-16 pb-20">
      <div className="text-center mb-14">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[var(--text-strong)]">Simple, transparent pricing</h1>
        <p className="text-[var(--text-muted)] mt-4">All plans include a 30-day free trial. No credit card required.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={
              plan.featured
                ? 'relative bg-[var(--surface)] rounded-2xl p-7 border-2 border-[var(--primary)] shadow-[var(--shadow-lg)]'
                : 'relative bg-[var(--surface)] rounded-2xl p-7 border border-[var(--border)] shadow-[var(--shadow-xs)]'
            }
          >
            {plan.featured && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--primary)] text-white text-[11px] font-bold px-3.5 py-0.5 rounded-full">
                MOST POPULAR
              </div>
            )}
            <h3 className="font-semibold text-[var(--text-strong)] text-base mb-1">{plan.name}</h3>
            <div className="my-3">
              <span className="text-3xl font-extrabold text-[var(--text-strong)]">{plan.price}</span>
              <span className="text-sm text-[var(--text-muted)]">{plan.period}</span>
            </div>
            <ul className="list-none p-0 my-0 mb-6 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-[var(--text)]">
                  <Check size={15} className="text-[var(--success)] mt-0.5 flex-none" /> {f}
                </li>
              ))}
            </ul>
            <Link
              href={plan.href}
              className={
                plan.featured
                  ? 'block text-center py-2.5 rounded-md font-semibold text-sm no-underline text-white bg-[var(--primary)] hover:bg-[var(--primary-hover)] transition-colors'
                  : 'block text-center py-2.5 rounded-md font-semibold text-sm no-underline text-[var(--text-strong)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors'
              }
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
