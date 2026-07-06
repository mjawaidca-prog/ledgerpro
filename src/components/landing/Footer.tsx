import Link from 'next/link';

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--card)] pb-8 pt-14">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 text-xl font-extrabold">
              <span className="grid h-[38px] w-[38px] place-items-center rounded-lg bg-[var(--dark)] font-black text-white">
                L
              </span>
              <span className="text-[var(--text-strong)]">
                Ledger<span className="text-[var(--primary)]">Pro</span>
              </span>
            </div>
            <p className="mt-3.5 max-w-[230px] text-sm text-[var(--text-muted)]">
              Double-entry accounting built for Canadian small businesses. A NexvarLab product.
            </p>
          </div>
          <FooterCol title="Product" links={[['Features', '/#features'], ['Pricing', '/pricing'], ['Start Free Trial', '/register']]} />
          <FooterCol title="NexvarLab" links={[['Nexvar Pay Payroll', 'https://pay.nexvarlab.com'], ['Contact Sales', 'mailto:sales@nexvarlab.com'], ['Sign In', '/login']]} />
          <FooterCol title="Platform" links={[['Dashboard', '/dashboard'], ['Canadian Tax', '/#canadian'], ['Bank Reconciliation', '/#features']]} />
        </div>
        <div className="mt-10 flex flex-col justify-between border-t border-[var(--border)] pt-5 text-[13.5px] text-[var(--text-muted)] sm:flex-row">
          <span>Copyright 2026 NexvarLab. All rights reserved.</span>
          <span>Made for Canadian small businesses.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-3.5 text-[13px] font-semibold uppercase text-[var(--text-strong)]">{title}</h4>
      {links.map(([label, href]) => {
        const isInternal = href.startsWith('/');
        const className = 'block py-1.5 text-[14.5px] text-[var(--text-muted)] no-underline hover:text-[var(--primary)]';
        return isInternal ? (
          <Link key={label} href={href} className={className}>
            {label}
          </Link>
        ) : (
          <a key={label} href={href} className={className}>
            {label}
          </a>
        );
      })}
    </div>
  );
}
