import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, Images } from 'lucide-react';
import { notFound } from 'next/navigation';
import { GuideCard } from '@/components/marketing/GuideCard';
import { StructuredData } from '@/components/seo/StructuredData';
import {
  PUBLIC_GUIDE_SLUGS,
  countGuideImages,
  getGuideImageUrls,
  getGuideUrl,
  getPublicGuide,
  getRelatedPublicGuides,
} from '@/lib/guides';
import { LEDGERPRO_URL } from '@/lib/seo';

type Props = { params: { slug: string } };

export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_GUIDE_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const guide = getPublicGuide(params.slug);
  if (!guide) return {};

  const url = getGuideUrl(guide);
  const images = getGuideImageUrls(guide);

  return {
    title: { absolute: guide.metaTitle },
    description: guide.description,
    keywords: guide.article.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: guide.metaTitle,
      description: guide.description,
      url,
      type: 'article',
      locale: 'en_CA',
      images: images.slice(0, 1).map((image) => ({ url: image, alt: guide.title })),
    },
    twitter: {
      card: 'summary_large_image',
      title: guide.metaTitle,
      description: guide.description,
      images: images.slice(0, 1),
    },
  };
}

export default function GuideDetailPage({ params }: Props) {
  const guide = getPublicGuide(params.slug);
  if (!guide) notFound();

  const url = getGuideUrl(guide);
  const images = getGuideImageUrls(guide);
  const relatedGuides = getRelatedPublicGuides(guide);
  const imageCount = countGuideImages(guide);
  const organization = {
    '@type': 'Organization',
    name: 'Nexvar Lab Inc.',
    url: 'https://www.nexvarlab.online',
  };
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.title,
      description: guide.description,
      image: images,
      author: organization,
      publisher: organization,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: guide.article.category,
      inLanguage: 'en-CA',
      about: { '@type': 'SoftwareApplication', name: 'LedgerPro', applicationCategory: 'BusinessApplication' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'LedgerPro', item: LEDGERPRO_URL },
        { '@type': 'ListItem', position: 2, name: 'Guides', item: `${LEDGERPRO_URL}/guides` },
        { '@type': 'ListItem', position: 3, name: guide.title, item: url },
      ],
    },
  ];

  return (
    <>
      <StructuredData data={schema} />

      <article>
        <header className="mx-auto max-w-5xl px-5 pb-12 pt-14 text-center md:pt-20">
          <nav aria-label="Breadcrumb" className="flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
            <Link href="/guides" className="inline-flex items-center gap-2 font-medium text-[var(--primary)] no-underline">
              <ArrowLeft size={15} /> All guides
            </Link>
            <span aria-hidden="true">/</span>
            <span>{guide.article.category}</span>
          </nav>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.12em] text-[var(--primary)]">
            LedgerPro guide · Prairie Peak example
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-[var(--text-strong)] md:text-6xl">
            {guide.title}
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-[var(--text-muted)]">{guide.intro}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3 text-sm text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
              <BookOpenCheck size={16} /> {guide.article.sections.length} sections
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
              <Images size={16} /> {imageCount} screenshots
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
              <CheckCircle2 size={16} /> Worked figures throughout
            </span>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav aria-label="Guide contents" className="sticky top-24 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">In this guide</h2>
              <ol className="mt-4 space-y-3 text-sm leading-relaxed">
                {guide.article.sections.map((section, index) => (
                  <li key={section.heading}>
                    <a href={`#section-${index + 1}`} className="text-[var(--text-muted)] no-underline hover:text-[var(--primary)]">
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ol>
              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">See LedgerPro working on your own books.</p>
                <Link href="/register" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] no-underline">
                  Start Free Trial <ArrowRight size={15} />
                </Link>
              </div>
            </nav>
          </aside>

          <div className="min-w-0">
            {guide.article.sections.map((section, sectionIndex) => (
              <section
                key={section.heading}
                id={`section-${sectionIndex + 1}`}
                className="scroll-mt-24 border-t border-[var(--border)] py-10 first:border-t-0 first:pt-0"
              >
                <h2 className="text-3xl font-extrabold leading-tight text-[var(--text-strong)]">{section.heading}</h2>
                {section.text && <p className="mt-4 leading-[1.85] text-[var(--text)]">{section.text}</p>}

                {section.steps && (
                  <ol className="mt-6 grid gap-3">
                    {section.steps.map((step, stepIndex) => (
                      <li
                        key={`${section.heading}-${stepIndex}`}
                        className="flex gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 leading-relaxed text-[var(--text)]"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                          {stepIndex + 1}
                        </span>
                        <span className="pt-1">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}

                {section.notes && (
                  <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">Good to know</h3>
                    <ul className="mt-3 space-y-2">
                      {section.notes.map((note) => (
                        <li key={note} className="flex gap-3 text-sm leading-relaxed text-[var(--text-muted)]">
                          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {section.images?.map((image, imageIndex) => (
                  <figure
                    key={image.src}
                    className="mt-7 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]"
                  >
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading={sectionIndex === 0 && imageIndex === 0 ? 'eager' : 'lazy'}
                      className="block h-auto w-full"
                    />
                    {image.caption && (
                      <figcaption className="border-t border-[var(--border)] px-5 py-4 text-sm leading-relaxed text-[var(--text-muted)]">
                        {image.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </section>
            ))}

            <section className="rounded-2xl bg-[var(--dark)] p-7 text-white md:p-9">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-red-200">Try the workflow</p>
              <h2 className="mt-3 text-3xl font-extrabold">Put your own books through the same steps</h2>
              <p className="mt-4 max-w-2xl leading-relaxed text-slate-300">
                Start a LedgerPro trial, or open this workflow in your existing company. The guide stays available as a public
                reference either way.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/register" className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white no-underline hover:bg-[var(--primary-hover)]">
                  Start Free 30-Day Trial <ArrowRight size={15} />
                </Link>
                {guide.article.action && (
                  <Link
                    href={guide.article.action.href}
                    className="inline-flex items-center rounded-md border border-white/30 px-6 py-3 text-sm font-semibold text-white no-underline"
                  >
                    {guide.article.action.label}
                  </Link>
                )}
              </div>
            </section>
          </div>
        </div>
      </article>

      {relatedGuides.length > 0 && (
        <section className="border-t border-[var(--border)] bg-[var(--surface)] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--primary)]">Keep going</p>
                <h2 className="mt-2 text-3xl font-extrabold text-[var(--text-strong)]">Related guides</h2>
              </div>
              <Link href="/guides" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] no-underline">
                Browse all guides <ArrowRight size={15} />
              </Link>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {relatedGuides.map((relatedGuide) => (
                <GuideCard key={relatedGuide.slug} guide={relatedGuide} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
