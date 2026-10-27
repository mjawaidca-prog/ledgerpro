'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { format } from 'date-fns';
import {
  Wallet, CheckCircle2, KeyRound, ExternalLink, Loader2,
  ShieldCheck, Landmark, ArrowRight, AlertTriangle,
} from 'lucide-react';

const NEXVAR_PAY_URL = 'https://nexvarpay.nexvarlab.com';

interface PayrollStatus {
  state: 'connected' | 'key_ready' | 'not_connected' | 'no_api_access';
  apiAccessEnabled: boolean;
  planApiAccess: boolean;
  writeKeyCount: number;
  latestWriteKey: {
    name: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    requestCount: number;
  } | null;
  payrollRunCount: number;
  lastPayrollRunAt: string | null;
  lastPayrollRunDescription: string | null;
}

function StatusCard({ status }: { status: PayrollStatus }) {
  if (status.state === 'connected') {
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="text-[var(--success)] mt-0.5" size={22} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-[var(--text-strong)]">Connected to Nexvar Pay</h2>
                <Badge variant="neutral">Sync on</Badge>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {status.payrollRunCount} pay run{status.payrollRunCount === 1 ? '' : 's'} posted to this company
                {status.lastPayrollRunAt && (
                  <> — most recent on {format(new Date(status.lastPayrollRunAt), 'MMM d, yyyy')}</>
                )}
                . Synced entries appear in your journal labelled <strong>Payroll — Nexvar Pay</strong>.
              </p>
              {(!status.apiAccessEnabled || !status.planApiAccess) && (
                <p className="text-sm text-[var(--warning)] mt-2 flex items-center gap-1.5">
                  <AlertTriangle size={15} /> API access is currently off for this company or plan, so new pay runs
                  cannot post until it is restored.
                </p>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                <Link href="/journal"><Button variant="secondary">View journal</Button></Link>
                <a href={NEXVAR_PAY_URL} target="_blank" rel="noreferrer">
                  <Button>Open Nexvar Pay <ExternalLink size={14} /></Button>
                </a>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status.state === 'no_api_access') {
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-[var(--warning)] mt-0.5" size={22} />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">Payroll sync needs API access</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {!status.planApiAccess
                  ? 'Your current plan does not include API access, which the payroll sync uses to post entries. Upgrade to a plan with API access, then come back here to connect.'
                  : 'API access is switched off for this company. An owner can switch it on under Settings → Developer / API, then come back here to connect.'}
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Link href="/settings/developer"><Button variant="secondary">Go to Developer / API settings</Button></Link>
                <a href={NEXVAR_PAY_URL} target="_blank" rel="noreferrer">
                  <Button>Explore Nexvar Pay <ExternalLink size={14} /></Button>
                </a>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status.state === 'key_ready') {
    return (
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <KeyRound className="text-[var(--accent)] mt-0.5" size={22} />
            <div>
              <h2 className="text-base font-semibold text-[var(--text-strong)]">Almost there — finish in Nexvar Pay</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                An API key is ready{status.latestWriteKey && (
                  <> (<strong>{status.latestWriteKey.name}</strong>, {status.latestWriteKey.keyPrefix}…)</>
                )}. In Nexvar Pay, open this company&apos;s Settings → Integrations, paste the key, and turn on
                “Sync pay runs to LedgerPro”. Your first finalized pay run will post here automatically.
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <a href={NEXVAR_PAY_URL} target="_blank" rel="noreferrer">
                  <Button>Open Nexvar Pay <ExternalLink size={14} /></Button>
                </a>
                <Link href="/settings/developer"><Button variant="secondary">Manage API keys</Button></Link>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <Wallet className="text-[var(--accent)] mt-0.5" size={22} />
          <div>
            <h2 className="text-base font-semibold text-[var(--text-strong)]">Connect Nexvar Pay in three steps</h2>
            <ol className="text-sm text-[var(--text-muted)] mt-2 space-y-1.5 list-none">
              <li className="flex gap-2"><span className="font-semibold text-[var(--text-strong)]">1.</span> Create an API key for this company under Settings → Developer / API (scopes: Read + Write posting).</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--text-strong)]">2.</span> In Nexvar Pay, open the matching company → Settings → Integrations and paste the key.</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--text-strong)]">3.</span> Turn on “Sync pay runs to LedgerPro”. Every finalized pay run then posts here on its own.</li>
            </ol>
            <div className="flex gap-2 mt-3 flex-wrap">
              <Link href="/settings/developer"><Button>Create an API key <ArrowRight size={14} /></Button></Link>
              <a href={NEXVAR_PAY_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary">Open Nexvar Pay <ExternalLink size={14} /></Button>
              </a>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export default function PayrollPage() {
  const [status, setStatus] = useState<PayrollStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/payroll/status');
        const json = await res.json();
        if (!res.ok || !json.data) throw new Error('bad status');
        setStatus(json.data);
      } catch { setFailed(true); }
    })();
  }, []);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-strong)] flex items-center gap-2">
            <Wallet size={22} /> Payroll — Nexvar Pay
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Run payroll in Nexvar Pay; when you finalize a pay run, the accounting entry posts itself here.
            No re-typing totals, no year-end scramble — and if a run is ever reversed, the reversing entry
            posts automatically too.
          </p>
        </div>

        {failed && (
          <Card><CardBody>
            <p className="text-sm text-[var(--text-muted)]">We couldn&apos;t load the connection status just now. Refresh the page to try again.</p>
          </CardBody></Card>
        )}
        {!status && !failed && (
          <Card><CardBody>
            <p className="text-sm text-[var(--text-muted)] flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Checking your payroll connection…</p>
          </CardBody></Card>
        )}
        {status && <StatusCard status={status} />}

        <Card>
          <CardHeader><h3 className="font-semibold text-[var(--text-strong)]">What posts to your books</h3></CardHeader>
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Each finalized pay run posts <strong>one balanced journal entry</strong>, split the way your
              accountant expects: wages to Salaries &amp; Wages (6920), the employer&apos;s CPP/EI share to
              Employer Payroll Taxes (6940), and amounts owed to CPP Payable (2410), EI Payable (2420),
              Income Tax Payable (2430), and Wages Payable (2440). Only totals are sent — no employee names,
              SINs, or bank details ever leave Nexvar Pay.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-4 text-sm">
              <div className="flex gap-2"><ShieldCheck className="text-[var(--success)] flex-none" size={18} /><span><strong>Off by default.</strong> Nothing posts until you turn the sync on in Nexvar Pay.</span></div>
              <div className="flex gap-2"><ShieldCheck className="text-[var(--success)] flex-none" size={18} /><span><strong>Reversible.</strong> Deleting or reversing a run in Nexvar Pay posts the reversing entry here.</span></div>
              <div className="flex gap-2"><Landmark className="text-[var(--success)] flex-none" size={18} /><span><strong>Period-safe.</strong> A run dated in a closed or filed period is held back, never forced in.</span></div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-[var(--text-strong)]">Nexvar Pay plans</h3></CardHeader>
          <CardBody>
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div className="border border-[var(--border)] rounded-lg p-3">
                <div className="font-semibold text-[var(--text-strong)]">Solo</div>
                <div className="text-[var(--text-muted)]">$7/mo + $2 per employee</div>
                <div className="mt-1">For a single small team.</div>
              </div>
              <div className="border border-[var(--border)] rounded-lg p-3">
                <div className="font-semibold text-[var(--text-strong)]">Growth</div>
                <div className="text-[var(--text-muted)]">$19/mo + $2 per employee</div>
                <div className="mt-1">Multiple pay groups, remittance reports, direct deposit files.</div>
              </div>
              <div className="border border-[var(--border)] rounded-lg p-3">
                <div className="font-semibold text-[var(--text-strong)]">Accountant</div>
                <div className="text-[var(--text-muted)]">$49/mo + $1.50 per employee</div>
                <div className="mt-1">Run payroll for many client companies.</div>
              </div>
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-3">
              Every plan starts with a 14-day free trial — no credit card required. Example: Growth with
              5 employees is $29/month, with the bookkeeping sync included.
            </p>
            <a href={NEXVAR_PAY_URL} target="_blank" rel="noreferrer">
              <Button className="mt-2">Start free trial in Nexvar Pay <ExternalLink size={14} /></Button>
            </a>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
