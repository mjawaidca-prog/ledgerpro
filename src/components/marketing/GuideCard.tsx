import Link from 'next/link';
import { ArrowRight, BookOpenCheck, Images } from 'lucide-react';
import { countGuideImages, type PublicGuide } from '@/lib/guides';

export function GuideCard({ guide }: { guide: PublicGuide }) {
  const imageCount = countGuideImages(guide);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--primary)]">
          <BookOpenCheck size={15} /> {guide.article.category}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--text-faint)]">
          <Images size={14} /> {imageCount}
        </span>
      </div>
      <h3 className="mt-4 text-xl font-bold leading-snug text-[var(--text-strong)]">
        <Link href={`/guides/${guide.slug}`} className="no-underline hover:text-[var(--primary)]">
          {guide.title}
        </Link>
      </h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--text-muted)]">{guide.article.summary}</p>
      <Link
        href={`/guides/${guide.slug}`}
        className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] no-underline"
      >
        Read the guide <ArrowRight size={15} />
      </Link>
    </article>
  );
}
