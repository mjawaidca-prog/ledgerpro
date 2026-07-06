import { Check, Leaf } from 'lucide-react';

const CHECKS = [
  'GST/HST/PST rates by province, applied automatically',
  'CaseWare-compatible GIFI trial-balance export for your accountant',
  'Fiscal-year-aware reports, not only calendar-year views',
  'Opening trial-balance import when you switch from another system',
];

const PROVINCES = [
  ['BC', '12%'],
  ['AB', '5%'],
  ['SK', '11%'],
  ['MB', '12%'],
  ['ON', '13%'],
  ['QC', '14.975%'],
  ['NS', '14%'],
  ['NB', '15%'],
];

export function CanadianTax() {
  return (
    <section id="canadian" className="py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
        <div>
          <span className="text-xs font-bold uppercase text-[var(--primary)]">Made in Canada</span>
          <h2 className="mb-4 mt-3.5 text-4xl font-extrabold leading-tight text-[var(--text-strong)]">
            Made for how Canadian books actually work
          </h2>
          <p className="mb-7 text-lg leading-relaxed text-[var(--text)]">
            Most accounting software treats Canadian tax as an afterthought. LedgerPro builds it in from the ground up.
          </p>
          <ul className="grid gap-3.5">
            {CHECKS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-[var(--text)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--primary)] text-white">
                  <Check size={15} strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl bg-[var(--dark)] p-8 text-white md:p-9">
          <div className="mx-auto mb-4 grid h-[46px] w-[46px] place-items-center rounded-lg bg-white/10 text-white">
            <Leaf size={23} />
          </div>
          <h3 className="mb-2.5 text-center text-xl font-extrabold text-white">Every province, ready</h3>
          <p className="text-center text-[15px] leading-relaxed text-slate-300">
            Province tax rates are ready to apply so your sales tax reports stay accountant-friendly.
          </p>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {PROVINCES.map(([code, rate]) => (
              <div
                key={code}
                className="rounded-lg border border-white/[.08] bg-white/[.07] py-2.5 text-center text-xs font-semibold text-slate-200"
              >
                {code} {rate}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
