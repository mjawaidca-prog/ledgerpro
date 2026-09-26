import type { Metadata } from 'next';
import { CanadianTax } from '@/components/landing/CanadianTax';
import { ApiSection } from '@/components/landing/ApiSection';
import { CrossSell } from '@/components/landing/CrossSell';
import { LandingFeatures } from '@/components/landing/Features';
import { FinalCta } from '@/components/landing/FinalCta';
import { LandingFooter } from '@/components/landing/Footer';
import { LandingHero } from '@/components/landing/Hero';
import { LandingNavbar } from '@/components/landing/Navbar';
import { StructuredData } from '@/components/seo/StructuredData';
import { PRODUCTS } from '@/lib/brand';
import { LEDGERPRO_URL, NEXVAR_URL } from '@/lib/seo';

export const metadata: Metadata = {
  title: { absolute: 'Canadian Accounting Software for Small Business | LedgerPro' },
  description:
    'Cloud accounting software for Canadian small businesses with invoicing, bank reconciliation, GST/HST/QST/PST tracking, and accountant-ready financial reports.',
  alternates: { canonical: LEDGERPRO_URL },
  openGraph: {
    url: LEDGERPRO_URL,
    title: 'LedgerPro — Canadian Accounting Software for Small Business',
    description:
      'Cloud accounting software with invoicing, bank reconciliation, Canadian sales tax, and financial reporting in one double-entry ledger.',
  },
};

export default function Home() {
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'LedgerPro',
      url: LEDGERPRO_URL,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'AccountingSoftware',
      operatingSystem: 'Web',
      description:
        'Canadian small business accounting software for invoicing, bills, bank reconciliation, sales tax, and financial reporting.',
      featureList: [
        'Double-entry bookkeeping',
        'Customer invoicing and vendor bills',
        'Bank feeds and statement reconciliation',
        'GST, HST, QST, PST, and RST tracking',
        'Financial statements and management reporting',
        'Multi-company accounting',
        'Audit trail and period close controls',
      ],
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'CAD',
        category: '30-day free trial',
        url: `${LEDGERPRO_URL}/pricing`,
      },
      publisher: { '@type': 'Organization', name: 'Nexvar Lab Inc.', url: NEXVAR_URL },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Nexvar Lab Inc.',
      url: NEXVAR_URL,
      email: 'hello@nexvarlab.online',
      brand: [
        { '@type': 'Brand', name: 'LedgerPro', url: LEDGERPRO_URL },
        { '@type': 'Brand', name: 'Nexvar Pay', url: 'https://pay.nexvarlab.com' },
      ],
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--app-bg)]">
      <StructuredData data={schema} />
      <LandingNavbar />
      <LandingHero />
      <LandingFeatures />
      <CanadianTax />
      <ApiSection />
      <CrossSell
        heading="Need payroll too? Meet Nexvar Pay."
        body="Run CPP, EI, and tax-accurate payroll in minutes. Pay stubs and T4s your employees and accountant can trust, with clean books to match."
        ctaLabel="Explore Nexvar Pay"
        href={PRODUCTS.pay.url}
      />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
