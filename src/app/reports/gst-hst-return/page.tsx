'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Loader2, Download, ChevronDown, ChevronRight, Landmark, AlertTriangle, CheckCircle2 } from 'lucide-react';

const LINE_ORDER = ['101', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '114', '115'] as const;
const LABELS: Record<string, string> = {
  '101': 'Sales and other revenue',
  '103': 'GST/HST collected or collectible',
  '104': 'Adjustments (add to net tax)',
  '105': 'Total GST/HST and adjustments',
  '106': 'Input tax credits (ITCs)',
  '107': 'Adjustments (deduct from net tax)',
  '108': 'Total ITCs and adjustments',
  '109': 'Net tax',
  '110': 'Instalments and other payments',
  '111': 'Rebates',
  '112': 'Total other credits',
  '114': 'Refund claimed',
  '115': 'Payment enclosed / amount owing',
};
const SUBTOTAL_LINES = new Set(['105', '108', '109', '112']);

export default function GstHstReturnPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [regFrequency, setRegFrequency] = useState('annual');
  const [filing, setFiling] = useState(false);
  const [filedMsg, setFiledMsg] = useState<string | null>(null);

  const load = useCallback(async (f?: string, t?: string) => {
    setLoading(true); setError(null); setFiledMsg(null);
    try {
      const qs = f && t ? `?from=${f}&to=${t}` : '';
      const res = await fetch(`/api/reports/gst-hst-return${qs}`).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setData(res.data);
      setFrom(res.data.periodStart);
      setTo(res.data.periodEnd);
    } catch { setError('Failed to load the GST/HST return.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleMarkFiled() {
    if (!data) return;
    if (data.overlappingFiled?.length > 0 &&
      !confirm(`Warning: this period overlaps a period already recorded as filed (${data.overlappingFiled.map((o: any) => `${o.periodStart} – ${o.periodEnd}`).join(', ')}). Editing or re-filing a filed period can duplicate a return. Continue anyway?`)) return;
    setFiling(true);
    try {
      const body: any = { periodStart: data.periodStart, periodEnd: data.periodEnd, confirmation };
      if (!data.registration) body.createRegistration = { registrationNumber: regNumber, filingFrequency: regFrequency };
      const res = await fetch('/api/reports/gst-hst-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setFiledMsg('Filing recorded. LedgerPro records the filing — it does not submit to CRA.');
      load(data.periodStart, data.periodEnd);
    } finally { setFiling(false); }
  }

  if (loading && !data) return <AppShell><div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>;

  const lines = data?.result?.lines ?? {};
  const drill = data?.result?.drillDown ?? {};

  return (
    <AppShell>
      <div className="max-w-4xl">
        <div className="content-head">
          <div>
            <h1 className="greet">GST/HST Return</h1>
            <p className="sub">Working copy of the CRA GST34 return, computed from your general ledger. ITCs are netted here in the return — never in the GL postings.</p>
          </div>
          <div className="spacer" />
          {data && (
            <a href={`/api/reports/gst-hst-return?from=${data.periodStart}&to=${data.periodEnd}&format=csv`}>
              <Button variant="secondary"><Download size={14} /> CSV working copy</Button>
            </a>
          )}
        </div>

        {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
        {filedMsg && <Alert variant="success" className="mb-4">{filedMsg}</Alert>}

        <Card className="mb-4">
          <CardBody>
            <div className="flex flex-wrap items-end gap-3">
              <div className="field"><label>Period start</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className="field"><label>Period end</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
              <Button onClick={() => load(from, to)} disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : null} Compute</Button>
              {data?.registration
                ? <p className="text-xs text-[var(--text-muted)]">Registration {data.registration.registrationNumber} · {data.registration.filingFrequency} filer</p>
                : <p className="text-xs text-[var(--text-muted)]">No GST/HST registration on file — period defaults to the fiscal year.</p>}
            </div>
          </CardBody>
        </Card>

        {data?.filed && (
          <Alert variant="success" className="mb-4">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Filed — recorded {data.filed.filedAt?.slice(0, 10)} · CRA confirmation: {data.filed.filingConfirmation || '—'}. Changes to this period should be made with care.</span>
          </Alert>
        )}
        {data?.overlappingFiled?.length > 0 && (
          <Alert variant="warning" className="mb-4">
            <span className="flex items-center gap-2"><AlertTriangle size={16} /> This period overlaps a filed period ({data.overlappingFiled.map((o: any) => `${o.periodStart} – ${o.periodEnd}`).join(', ')}). Avoid editing postings in a filed period.</span>
          </Alert>
        )}
        {data?.notes?.map((n: string) => <Alert key={n} variant="info" className="mb-2">{n}</Alert>)}

        <Card className="mb-4">
          <CardHeader><h3 className="t-h3 flex items-center gap-2"><Landmark size={16} /> Return lines (GST34)</h3></CardHeader>
          <CardBody>
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[var(--text-faint)]">
                  <th className="py-2 w-16">Line</th><th>Description</th><th className="text-right w-40">Amount</th><th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {LINE_ORDER.map((line) => {
                  const items = drill[line] ?? [];
                  const open = openLine === line;
                  return [
                    <tr key={line} className={`border-t border-[var(--border)] ${SUBTOTAL_LINES.has(line) ? 'font-semibold' : ''}`}>
                      <td className="py-2 text-sm font-mono">{line}</td>
                      <td className="py-2 text-sm">{LABELS[line]}</td>
                      <td className="py-2 text-sm font-mono tabular-nums text-right">{money(lines[line] ?? 0)}</td>
                      <td className="py-2 text-right">
                        {items.length > 0 && (
                          <button className="text-[var(--text-muted)]" onClick={() => setOpenLine(open ? null : line)} aria-label={`Drill down line ${line}`}>
                            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        )}
                      </td>
                    </tr>,
                    open && items.length > 0 && (
                      <tr key={`${line}-detail`} className="bg-[var(--surface-2)]">
                        <td colSpan={4} className="p-3">
                          <table className="w-full text-xs">
                            <thead><tr className="text-left text-[var(--text-faint)]"><th>Date</th><th>Account</th><th>Description</th><th className="text-right">Contribution</th></tr></thead>
                            <tbody>
                              {items.map((d: any) => (
                                <tr key={d.lineId} className="border-t border-[var(--border)]">
                                  <td className="py-1">{d.date}</td>
                                  <td className="py-1 font-mono">{d.accountCode}</td>
                                  <td className="py-1">{d.description}</td>
                                  <td className="py-1 text-right font-mono tabular-nums">{money(d.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-[var(--text-faint)] mt-3">Line 101 is rounded to the nearest whole dollar, as CRA requires. PST/RST and QST amounts are tracked in their own accounts and never enter these lines. Line definitions per CRA GST34 / Info Sheet GI-066.</p>
          </CardBody>
        </Card>

        {!data?.filed && data && (
          <Card>
            <CardHeader><h3 className="t-h3">Record as filed</h3></CardHeader>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)] mb-3">After you file with CRA (e.g. via GST/HST NETFILE), record it here with the confirmation reference CRA gives you. This stores a filed Tax Return Workpaper for {data.periodStart} – {data.periodEnd}.</p>
              {!data.registration && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="field"><label>GST/HST registration (RT) number</label><input className="input" value={regNumber} onChange={e => setRegNumber(e.target.value)} placeholder="123456789RT0001" /></div>
                  <div className="field"><label>Filing frequency</label><select className="input" value={regFrequency} onChange={e => setRegFrequency(e.target.value)}>
                    <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
                  </select></div>
                </div>
              )}
              <div className="flex items-end gap-3">
                <div className="field flex-1"><label>CRA filing confirmation reference</label><input className="input" value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="e.g. NETFILE confirmation number" /></div>
                <Button onClick={handleMarkFiled} disabled={filing || !confirmation.trim() || (!data.registration && !regNumber.trim())}>
                  {filing ? <Loader2 size={14} className="animate-spin" /> : null} Mark as filed
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
