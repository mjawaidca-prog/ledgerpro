'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Mail,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/help-content';

export function HelpCenter() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof HELP_CATEGORIES)[number]>('All topics');

  const filteredArticles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return HELP_ARTICLES.filter((article) => {
      const matchesCategory = category === 'All topics' || article.category === category;
      const haystack = [
        article.title,
        article.summary,
        article.category,
        ...article.keywords,
        ...article.sections.flatMap((section) => [
          section.heading,
          section.text || '',
          ...(section.steps || []),
          ...(section.notes || []),
        ]),
      ].join(' ').toLowerCase();
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });
  }, [category, query]);

  return (
    <div className="max-w-[1180px] mx-auto">
      <section className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:px-9 md:py-9 shadow-[var(--shadow-sm)]">
        <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-[var(--primary-soft)] to-transparent pointer-events-none" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.1em] text-[var(--primary)] mb-3">
            <CircleHelp size={16} /> LedgerPro Help Center
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--text-strong)]">
            How can we help?
          </h1>
          <p className="mt-2 text-sm md:text-base text-[var(--text-muted)]">
            Search practical guidance for setup, bookkeeping, banking, Canadian tax, reporting, controls, and security.
          </p>

          <label className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-xs)] focus-within:ring-2 focus-within:ring-[var(--primary)]/25">
            <Search size={19} className="text-[var(--text-muted)] flex-none" />
            <span className="sr-only">Search help articles</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search invoices, GST, bank imports, reports…"
              className="w-full bg-transparent text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-faint)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear help search"
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-strong)]"
              >
                <X size={16} />
              </button>
            )}
          </label>
        </div>
      </section>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-2" aria-label="Help categories">
        {HELP_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
            className={cn(
              'whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
              category === item
                ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]'
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">
            {category === 'All topics' ? 'All help topics' : category}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5" aria-live="polite">
            {filteredArticles.length} article{filteredArticles.length === 1 ? '' : 's'} found
          </p>
        </div>
        <a
          href="mailto:hello@nexvarlab.online?subject=LedgerPro%20support"
          className="hidden sm:flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] no-underline hover:border-[var(--border-strong)]"
        >
          <Mail size={15} /> Contact support
        </a>
      </div>

      {filteredArticles.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {filteredArticles.map((article) => (
            <details
              key={article.slug}
              id={article.slug}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] open:shadow-[var(--shadow-sm)]"
            >
              <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 md:px-6 md:py-5 [&::-webkit-details-marker]:hidden">
                <div className="mt-0.5 grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                  <BookOpen size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--primary)]">
                    {article.category}
                  </div>
                  <h3 className="mt-1 text-sm md:text-base font-semibold text-[var(--text-strong)]">
                    {article.title}
                  </h3>
                  <p className="mt-1 text-xs md:text-sm text-[var(--text-muted)]">
                    {article.summary}
                  </p>
                </div>
                <ChevronDown size={19} className="mt-2 flex-none text-[var(--text-faint)] transition-transform group-open:rotate-180" />
              </summary>

              <div className="border-t border-[var(--border)] px-5 pb-6 pt-5 md:px-6">
                <div className="ml-0 md:ml-14 max-w-3xl space-y-5">
                  {article.sections.map((section) => (
                    <section key={section.heading}>
                      <h4 className="text-sm font-semibold text-[var(--text-strong)]">{section.heading}</h4>
                      {section.text && (
                        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{section.text}</p>
                      )}
                      {section.steps && (
                        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-[var(--text-muted)]">
                          {section.steps.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                      )}
                      {section.notes && (
                        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-[var(--text-muted)]">
                          {section.notes.map((note) => <li key={note}>{note}</li>)}
                        </ul>
                      )}
                    </section>
                  ))}

                  {article.action && (
                    <Link
                      href={article.action.href}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white no-underline hover:brightness-95"
                    >
                      {article.action.label} <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-12 text-center">
          <CircleHelp size={30} className="mx-auto text-[var(--text-faint)]" />
          <h3 className="mt-3 font-semibold text-[var(--text-strong)]">No matching help article</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Try a shorter term or select All topics.</p>
          <button
            type="button"
            onClick={() => { setQuery(''); setCategory('All topics'); }}
            className="mt-4 text-sm font-semibold text-[var(--primary)] hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--success-soft)] text-[var(--success)]">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Accounting or tax decision?</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Use professional review for company-specific treatment, elections, and filings.</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
              <Mail size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Still need help?</h2>
              <a className="mt-0.5 block text-xs font-medium text-[var(--primary)]" href="mailto:hello@nexvarlab.online?subject=LedgerPro%20support">
                hello@nexvarlab.online
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
