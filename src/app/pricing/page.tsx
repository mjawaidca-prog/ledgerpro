import Link from 'next/link';

const plans = [
  { name: 'Free Trial', price: '$0', period: '30 days', features: ['1 user', '1 company', '100 transactions', 'CSV export', 'Basic reports'], cta: 'Start Free Trial', href: '/register', featured: false },
  { name: 'Basic', price: '$29', period: '/mo', features: ['2 users', '1 company', '1,000 transactions', 'CSV + PDF export', 'Full reports', 'Email support'], cta: 'Start Free Trial', href: '/register', featured: false },
  { name: 'Pro', price: '$79', period: '/mo', features: ['10 users', '5 companies', '10,000 transactions', 'Bank feeds', 'Custom reports', 'Priority support', 'Budget vs Actual'], cta: 'Start Free Trial', href: '/register', featured: true },
  { name: 'Enterprise', price: '$199', period: '/mo', features: ['50 users', '25 companies', 'Unlimited transactions', 'White label', 'API access', 'Dedicated support', 'All features'], cta: 'Contact Sales', href: 'mailto:sales@nexvarlab.com', featured: false },
];

export default function PricingPage() {
  return (
    <html lang="en">
      <head><title>Pricing — Ledger Pro</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style={{ fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif', margin: 0, background: '#f6f8fb', color: '#131a24' }}>
        <header style={{ background: '#fff', borderBottom: '1px solid #e3e8ef', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #1f6feb, #7c3aed)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>L</div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Ledger <span style={{ color: '#1f6feb' }}>Pro</span></span>
          </div>
          <nav style={{ display: 'flex', gap: 20, fontSize: 14 }}>
            <a href="/" style={{ color: '#697587', textDecoration: 'none' }}>Home</a>
            <a href="/pricing" style={{ color: '#1f6feb', textDecoration: 'none', fontWeight: 600 }}>Pricing</a>
            <a href="/login" style={{ color: '#697587', textDecoration: 'none' }}>Sign In</a>
          </nav>
        </header>

        <div style={{ maxWidth: 960, margin: '60px auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 50 }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, margin: '0 0 8px' }}>Simple, transparent pricing</h1>
            <p style={{ fontSize: 16, color: '#697587', margin: 0 }}>All plans include a 30-day free trial. No credit card required.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {plans.map((plan) => (
              <div key={plan.name} style={{
                background: '#fff', borderRadius: 14, padding: 28, border: plan.featured ? '2px solid #1f6feb' : '1px solid #e3e8ef',
                boxShadow: plan.featured ? '0 4px 24px rgba(31,111,235,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                position: 'relative',
              }}>
                {plan.featured && <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#1f6feb', color: '#fff', padding: '2px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>MOST POPULAR</div>}
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{plan.name}</h3>
                <div style={{ margin: '12px 0 16px' }}>
                  <span style={{ fontSize: 32, fontWeight: 800 }}>{plan.price}</span>
                  <span style={{ color: '#697587', fontSize: 14 }}>{plan.period}</span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', fontSize: 13, color: '#364150', lineHeight: 2 }}>
                  {plan.features.map(f => <li key={f}>✓ {f}</li>)}
                </ul>
                <a href={plan.href} style={{
                  display: 'block', textAlign: 'center', padding: '10px 0', borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none',
                  background: plan.featured ? '#1f6feb' : '#f6f8fb', color: plan.featured ? '#fff' : '#131a24',
                }}>{plan.cta}</a>
              </div>
            ))}
          </div>
        </div>

        <footer style={{ textAlign: 'center', padding: '32px 24px', borderTop: '1px solid #e3e8ef', fontSize: 13, color: '#9aa6b8' }}>
          <p>© 2026 NexVar Labs. All rights reserved. <a href="/privacy" style={{ color: '#1f6feb' }}>Privacy</a> · <a href="/terms" style={{ color: '#1f6feb' }}>Terms</a></p>
        </footer>
      </body>
    </html>
  );
}
