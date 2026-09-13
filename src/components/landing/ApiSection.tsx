import Link from 'next/link';
import { ArrowRight, Check, Code2 } from 'lucide-react';

const CHECKS = [
  'Read access to companies, invoices, bills, journals, and core reports',
  'Controlled writes with reviewed-tax posting, idempotency, and closed-period enforcement',
  'Signed webhooks with retries, replay, and duplicate-safe delivery',
  'Sandbox testing on synthetic data with separate credentials',
];

export function ApiSection() {
  return (
    <section id="api" className="py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase text-[var(--primary)]">
            <Code2 size={14} /> Available on Pro &amp; Enterprise Plans
          </span>
          <h2 className="mb-4 mt-3.5 text-4xl font-extrabold leading-tight text-[var(--text-strong)]">
            Powerful REST API for Developers &amp; Accountants
          </h2>
          <p className="mb-7 text-lg leading-relaxed text-[var(--text)]">
            Automate financial workflows, sync transactions, and manage draft documents with enterprise-grade
            controls. Fully documented with REST endpoints, signed webhooks, and sandbox testing.
          </p>
          <ul className="mb-9 grid gap-3.5">
            {CHECKS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-[var(--text)]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--primary)] text-white">
                  <Check size={15} strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--primary-hover)]"
          >
            View API Docs <ArrowRight size={16} />
          </Link>
        </div>

        <div className="rounded-2xl bg-[var(--dark)] p-8 text-white md:p-9">
          <div className="mx-auto mb-4 grid h-[46px] w-[46px] place-items-center rounded-lg bg-white/10 text-white">
            <Code2 size={23} />
          </div>
          <h3 className="mb-2.5 text-center text-xl font-extrabold text-white">One line to your books</h3>
          <pre className="overflow-x-auto rounded-xl bg-black/40 p-5 text-[13px] leading-relaxed text-slate-200">
{`curl https://ledger.nexvarlab.com/api/v1/company \\
  -H "Authorization: Bearer lp_live_…"

{ "id": "…", "name": "Acme Ltd.",
  "currency": "CAD", "onboardingComplete": true }`}
          </pre>
          <p className="mt-5 text-center text-sm leading-relaxed text-slate-400">
            Decimal-string money, bounded pagination, and the full OpenAPI reference at
            <code className="text-slate-200"> /api/v1/openapi.json</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
