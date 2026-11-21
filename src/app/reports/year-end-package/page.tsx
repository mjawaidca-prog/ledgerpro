'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Loader2, Download, PackageCheck, AlertTriangle, CheckCircle2, Ban, HelpCircle } from 'lucide-react';

type CheckStatus = 'pass' | 'warn' | 'block' | 'not_checked';

interface PreflightCheckView {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  figures: { label: string; value: string }[];
  items: string[];
}

interface YearEndData {
  companyName: string;
  fiscalYear: { start: string; end: string; label: string };
  coverSheet: {
    checks: PreflightCheckView[];
    summary: { pass: number; warn: number; block: number; notChecked: number; overall: 'pass' | 'warn' | 'block' };
  };
  packageHash: string;
}

const STATUS_BADGE: Record<CheckStatus, { variant: 'paid' | 'pending' | 'overdue' | 'neutral'; label: string }> = {
  pass: { variant: 'paid', label: 'Pass' },
  warn: { variant: 'pending', label: 'Warn' },
  block: { variant: 'overdue', label: 'Block' },
  not_checked: { variant: 'neutral', label: 'Not checked' },
};

const PACKAGE_SECTIONS = [
  'Cover sheet — these pre-flight results and the mapping-health score',
  'Trial balance (tb-gifi/1) with the prior-year comparative',
  'General ledger detail summary for the year, journals by source',
  'CCA register continuity (cca-register/1) for Schedule 8',
  'Loan schedules with fiscal-year interest totals and balance proofs',
  'GST/HST worksheets (gst-worksheet/1) for every filing period in the year',
  'Payroll section — the Nexvar Pay journals posted into these books, or the list of what to attach from Nexvar Pay',
];

export default function YearEndPackagePage() {
  const [data, setData] = useState<YearEndData | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (date?: string) => {
    setLoading(true); setError(null);
    try {
      const qs = date ? `?asOf=${date}` : '';
      const res = await fetch(`/api/reports/year-end-package${qs}`).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setData(res.data);
      setAsOf(res.data.fiscalYear.end);
    } catch { setError('Failed to run the year-end pre-flight.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleDownload() {
    if (!data) return;
    const { block, warn } = data.coverSheet.summary;
    if (block > 0) {
      const names = data.coverSheet.checks.filter(c => c.status === 'block').map(c => c.label).join('; ');
      if (!confirm(`Warning: ${block} pre-flight check(s) BLOCK this package (${names}). The bundle is still generated — the cover sheet inside it prints these blocks — but the books should be corrected before the package supports a filed return. Download anyway?`)) return;
    } else if (warn > 0) {
      if (!confirm(`This package carries ${warn} warning(s) on its cover sheet. Download anyway?`)) return;
    }
    window.location.href = `/api/reports/year-end-package?asOf=${data.fiscalYear.end}&format=package`;
  }

  if (loading && !data) return <AppShell><div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>;

  const summary = data?.coverSheet.summary;

  return (
    <AppShell>
      <div className="max-w-4xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Year-End Package</h1>
            <p className="sub">The one-click T2 handoff: pre-flight checks first, then one dated, hashed bundle (year-end-package/1) with everything the return needs from these books.</p>
          </div>
          <div className="spacer" />
          {data && (
            <Button onClick={handleDownload}><Download size={14} /> Download package (JSON)</Button>
          )}
        </div>

        {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

        <Card className="mb-4">
          <CardBody>
            <div className="flex flex-wrap items-end gap-3">
              <div className="field"><label>Fiscal year containing</label><input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
              <Button onClick={() => load(asOf)} disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : null} Run pre-flight</Button>
              {data && <p className="text-xs text-[var(--text-muted)]">{data.companyName} · {data.fiscalYear.label} · {data.fiscalYear.start} to {data.fiscalYear.end}</p>}
            </div>
          </CardBody>
        </Card>

        {summary && summary.overall === 'block' && (
          <Alert variant="danger" className="mb-4">
            <span className="flex items-center gap-2"><Ban size={16} /> {summary.block} check(s) block this package. The bundle still generates — nothing is hidden — but correct the blocked items before the package supports a filed return.</span>
          </Alert>
        )}
        {summary && summary.overall === 'warn' && (
          <Alert variant="warning" className="mb-4">
            <span className="flex items-center gap-2"><AlertTriangle size={16} /> {summary.warn} check(s) need review. They print on the package cover sheet so the preparer sees them on import.</span>
          </Alert>
        )}
        {summary && summary.overall === 'pass' && (
          <Alert variant="success" className="mb-4">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Every check that can run from these books passes. Checks marked “Not checked” say why — usually because the record lives in another product.</span>
          </Alert>
        )}

        <Card className="mb-4">
          <CardHeader>
            <h3 className="t-h3 flex items-center gap-2"><PackageCheck size={16} /> Pre-flight cover sheet</h3>
            {summary && (
              <div className="flex gap-2">
                <Badge variant="paid">{summary.pass} pass</Badge>
                <Badge variant="pending">{summary.warn} warn</Badge>
                <Badge variant="overdue">{summary.block} block</Badge>
                <Badge variant="neutral">{summary.notChecked} not checked</Badge>
              </div>
            )}
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              {data?.coverSheet.checks.map((check) => {
                const badge = STATUS_BADGE[check.status];
                return (
                  <div key={check.id} className="border-b border-[var(--border)] pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      {check.status === 'not_checked'
                        ? <HelpCircle size={15} className="text-[var(--text-muted)]" />
                        : null}
                      <span className="font-medium text-[var(--text-strong)]">{check.label}</span>
                      <span className="spacer" />
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{check.detail}</p>
                    {check.figures.length > 0 && (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
                        {check.figures.map((f) => (
                          <span key={f.label} className="text-xs text-[var(--text-muted)]">
                            {f.label}: <span className="font-mono tabular-nums text-[var(--text)]">{f.value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {check.items.length > 0 && (
                      <ul className="list-disc pl-5 mt-2 space-y-0.5">
                        {check.items.map((item) => (
                          <li key={item} className="text-xs text-[var(--text-muted)]">{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="t-h3">Inside the package</h3></CardHeader>
          <CardBody>
            <ul className="list-disc pl-5 space-y-1">
              {PACKAGE_SECTIONS.map((s) => <li key={s} className="text-sm text-[var(--text-muted)]">{s}</li>)}
            </ul>
            {data && <p className="text-xs text-[var(--text-muted)] mt-3">Bundle hash (SHA-256 of the canonical payload): <span className="font-mono">{data.packageHash}</span></p>}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
