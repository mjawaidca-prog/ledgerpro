import { CanadianTax } from '@/components/landing/CanadianTax';
import { CrossSell } from '@/components/landing/CrossSell';
import { LandingFeatures } from '@/components/landing/Features';
import { FinalCta } from '@/components/landing/FinalCta';
import { LandingFooter } from '@/components/landing/Footer';
import { LandingHero } from '@/components/landing/Hero';
import { LandingNavbar } from '@/components/landing/Navbar';
import { PRODUCTS } from '@/lib/brand';

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--app-bg)]">
      <LandingNavbar />
      <LandingHero />
      <LandingFeatures />
      <CanadianTax />
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
