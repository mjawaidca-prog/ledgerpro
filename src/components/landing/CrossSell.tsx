import { ArrowRight } from 'lucide-react';

type CrossSellProps = {
  eyebrow?: string;
  heading: string;
  body: string;
  ctaLabel: string;
  href: string;
};

export function CrossSell({
  eyebrow = 'Also from NexvarLab',
  heading,
  body,
  ctaLabel,
  href,
}: CrossSellProps) {
  return (
    <section className="border-t border-[var(--border)] bg-gradient-to-b from-[var(--card)] to-[var(--app-bg)] py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex flex-col items-center justify-between gap-8 rounded-2xl bg-[var(--dark)] px-8 py-11 text-center text-white md:flex-row md:px-12 md:text-left">
          <div>
            <span className="text-xs font-bold uppercase text-[#fca5a1]">{eyebrow}</span>
            <h2 className="mb-2 mt-2.5 text-3xl font-extrabold text-white">{heading}</h2>
            <p className="max-w-[440px] text-base text-slate-300">{body}</p>
          </div>
          <a
            href={href}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-white px-7 py-3.5 text-base font-semibold text-[var(--dark)] no-underline transition-colors hover:bg-slate-100"
          >
            {ctaLabel} <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </section>
  );
}
