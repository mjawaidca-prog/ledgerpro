import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, ClipboardCheck, Landmark } from 'lucide-react';
import { GuideCard } from '@/components/marketing/GuideCard';
import { StructuredData } from '@/components/seo/StructuredData';
import { PUBLIC_GUIDES, getGuideUrl } from '@/lib/guides';
import { LEDGERPRO_URL } from '@/lib/seo';

const url = `${LEDGERPRO_URL}/guides`;
const title = 'LedgerPro Guides for Canadian Small Businesses';
const description =
  'Step-by-step LedgerPro guides built from a complete sample company: GST/HST returns, bank imports, receipts, invoices, bills, payroll sync, intercompany accounting, and reports.';

export const metadata: Metadata = {
  title: { absolute: `${title} | LedgerPro` },
  description,
  alternates: { canonical: url },
  openGraph: {
    title: `${title} | LedgerPro`,
    description,
    url,
    type: 'website',
    locale: 'en_CA',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} | LedgerPro`,
    description,
  },
};

export default function GuidesPage() {
  const featuredGuide = PUBLIC_GUIDES.find((guide) => guide.slug === 'gst-hst-return-lines-101-115') ?? PUBLIC_GUIDES[0];
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url,
      isPartOf: { '@type': 'WebSite', name: 'LedgerPro', url: LEDGERPRO_URL },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: PUBLIC_GUIDES.map((guide, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: guide.title,
        url: getGuideUrl(guide),
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'LedgerPro', item: LEDGERPRO_URL },
        { '@type': 'ListItem', position: 2, name: 'Guides', item: url },
      ],
    },
  ];

  return (
    <>
      <StructuredData data={schema} />

      <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 text-center md:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--primary)]">LedgerPro guides</p>
        <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-strong)] md:text-6xl">
          Canadian bookkeeping, shown on a real set of books
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-[var(--text-muted)]">
          These are not feature summaries. Each guide follows Prairie Peak — a fictional Canadian renovation company and its
          sister holding company — through a complete quarter, with the actual LedgerPro screens and figures.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href={`/guides/${featuredGuide.slug}`}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-6 py-3.5 text-sm font-semibold text-white no-underline hover:bg-[var(--primary-hover)]"
          >
            Start with GST/HST lines 101–115 <ArrowRight size={16} />
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3.5 text-sm font-semibold text-[var(--text-strong)] no-underline"
          >
            Start Free 30-Day Trial
          </Link>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)] py-10">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 md:grid-cols-3">
          <div className="flex gap-4">
            <Building2 className="mt-1 shrink-0 text-[var(--primary)]" size={24} />
            <div>
              <h2 className="font-bold text-[var(--text-strong)]">One connected example</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
                The same invoices, bills, bank rows, and journals carry through every guide.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Landmark className="mt-1 shrink-0 text-[var(--primary)]" size={24} />
            <div>
              <h2 className="font-bold text-[var(--text-strong)]">Canadian tax in context</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
                GST/HST is split when work is posted, then traced into the return and its workpapers.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <ClipboardCheck className="mt-1 shrink-0 text-[var(--primary)]" size={24} />
            <div>
              <h2 className="font-bold text-[var(--text-strong)]">Figures that reconcile</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
                Reports, supplier balances, customer balances, and intercompany mirrors are checked against each other.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--primary)]">Start anywhere</p>
            <h2 className="mt-2 text-3xl font-extrabold text-[var(--text-strong)]">Ten step-by-step guides</h2>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
            Prairie Peak is fictional training data. The workflows, screens, calculations, and accounting relationships are the
            ones a LedgerPro user works with.
          </p>
        </div>
        <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {PUBLIC_GUIDES.map((guide) => (
            <GuideCard key={guide.slug} guide={guide} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-8 text-center">
        <h2 className="text-3xl font-extrabold text-[var(--text-strong)]">Prefer to explore the product first?</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-[var(--text-muted)]">
          See the feature tour, compare plans, then use the guides when you are ready to work through a complete example.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/features" className="rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-[var(--text-strong)] no-underline">
            Explore Features
          </Link>
          <Link href="/pricing" className="rounded-md bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white no-underline hover:bg-[var(--primary-hover)]">
            View Pricing
          </Link>
        </div>
      </section>
    </>
  );
}
