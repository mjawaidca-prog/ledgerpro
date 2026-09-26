import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { StructuredData } from '@/components/seo/StructuredData';
import { LEDGERPRO_URL, NEXVAR_URL, SEO_FEATURES, SEO_FEATURE_SLUGS } from '@/lib/seo';

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return SEO_FEATURE_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const feature = SEO_FEATURES[params.slug];
  if (!feature) return {};

  const url = `${LEDGERPRO_URL}/features/${feature.slug}`;
  return {
    title: { absolute: feature.metaTitle },
    description: feature.description,
    alternates: { canonical: url },
    openGraph: {
      title: feature.metaTitle,
      description: feature.description,
      url,
      type: 'website',
      locale: 'en_CA',
    },
    twitter: {
      card: 'summary_large_image',
      title: feature.metaTitle,
      description: feature.description,
    },
  };
}

export default function FeatureDetailPage({ params }: Props) {
  const feature = SEO_FEATURES[params.slug];
  if (!feature) notFound();

  const url = `${LEDGERPRO_URL}/features/${feature.slug}`;
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: feature.metaTitle,
      description: feature.description,
      url,
      isPartOf: { '@type': 'WebSite', name: 'LedgerPro', url: LEDGERPRO_URL },
      about: { '@type': 'SoftwareApplication', name: 'LedgerPro', applicationCategory: 'BusinessApplication' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'LedgerPro', item: LEDGERPRO_URL },
        { '@type': 'ListItem', position: 2, name: 'Features', item: `${LEDGERPRO_URL}/features` },
        { '@type': 'ListItem', position: 3, name: feature.title, item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: feature.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ];

  return (
    <>
      <StructuredData data={schema} />
      <section className="mx-auto max-w-4xl px-5 pb-14 pt-16 text-center md:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--primary)]">{feature.eyebrow}</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-strong)] md:text-6xl">
          {feature.title}
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-[var(--text-muted)]">{feature.intro}</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-6 py-3.5 text-sm font-semibold text-white no-underline hover:bg-[var(--primary-hover)]">
            Start Free 30-Day Trial <ArrowRight size={16} />
          </Link>
          <Link href="/pricing" className="inline-flex items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3.5 text-sm font-semibold text-[var(--text-strong)] no-underline">
            View Pricing
          </Link>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--surface)] py-16">
        <div className="mx-auto grid max-w-6xl gap-5 px-5 sm:grid-cols-2">
          {feature.benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-xl border border-[var(--border)] bg-[var(--app-bg)] p-6">
              <CheckCircle2 size={22} className="mb-4 text-[var(--primary)]" />
              <h2 className="text-lg font-bold text-[var(--text-strong)]">{benefit.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1fr_.85fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--primary)]">How it works</p>
          <h2 className="mt-3 text-3xl font-extrabold text-[var(--text-strong)]">A clear path from activity to reviewed books</h2>
          <ol className="mt-7 grid gap-4">
            {feature.workflow.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-relaxed text-[var(--text)]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--primary)] font-bold text-white">{index + 1}</span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <aside className="rounded-2xl bg-[var(--dark)] p-7 text-white md:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-red-200">Why LedgerPro</p>
          <h2 className="mt-3 text-3xl font-extrabold">Canadian accounting, connected end to end</h2>
          <p className="mt-4 leading-relaxed text-slate-300">
            LedgerPro combines day-to-day bookkeeping with the controls and reports needed for month-end and year-end review.
          </p>
          <a href={NEXVAR_URL} className="mt-6 inline-flex text-sm font-semibold text-white underline underline-offset-4">
            Learn about Nexvar Lab Inc.
          </a>
        </aside>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-20">
        <h2 className="text-center text-3xl font-extrabold text-[var(--text-strong)]">Common questions</h2>
        <div className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {feature.faq.map((item) => (
            <details key={item.question} className="py-5">
              <summary className="cursor-pointer font-semibold text-[var(--text-strong)]">{item.question}</summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
