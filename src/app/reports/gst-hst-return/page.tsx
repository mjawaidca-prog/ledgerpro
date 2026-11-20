'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Loader2, Download, ChevronDown, ChevronRight, Landmark, AlertTriangle, CheckCircle2, Scale, FileCheck } from 'lucide-react';

const LINE_ORDER = ['101', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115'] as const;
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
  '113': 'Balance',
  '114': 'Refund claimed',
  '115': 'Payment enclosed / amount owing',
};
const SUBTOTAL_LINES = new Set(['105', '108', '109', '112', '113']);
/** Adjustment lines draw their composition from the live draft groups below. */
const ADJ_LINE_GROUP: Record<string, 'add' | 'deduct' | 'instalments' | 'rebates'> = {
  '104': 'add', '107': 'deduct', '110': 'instalments', '111': 'rebates',
};

type AdjItem = { amount: number; note: string };
type AdjDraft = { add: AdjItem[]; deduct: AdjItem[]; instalments: AdjItem[]; rebates: AdjItem[] };
const ADJ_GROUPS: { key: keyof AdjDraft; line: string; label: string; hint: string }[] = [
  { key: 'add', line: '104', label: 'Add to net tax', hint: 'e.g. bad-debt recovery, adjustments increasing net tax' },
  { key: 'deduct', line: '107', label: 'Deduct from net tax', hint: 'e.g. bad debt written off, credit notes not in the GL' },
  { key: 'instalments', line: '110', label: 'Instalments and other payments', hint: 'instalments already paid for this period' },
  { key: 'rebates', line: '111', label: 'Rebates', hint: 'e.g. rebates claimed as an offset on this return' },
];
const emptyAdj = (): AdjDraft => ({ add: [], deduct: [], instalments: [], rebates: [] });
const round2 = (n: number) => Math.round(n * 100) / 100;
const adjTotal = (items: AdjItem[]) => round2(items.reduce((s, i) => s + (Number(i.amount) || 0), 0));
function draftFromServer(adj: any): AdjDraft {
  if (!adj) return emptyAdj();
  const pick = (v: any): AdjItem[] => (Array.isArray(v) ? v.map((i: any) => ({ amount: Number(i.amount) || 0, note: String(i.note ?? '') })) : []);
  return { add: pick(adj.add), deduct: pick(adj.deduct), instalments: pick(adj.instalments), rebates: pick(adj.rebates) };
}
/** Recompute the derived return lines from the GL base lines (101/103/106) + draft adjustments. */
function previewLines(base: Record<string, number>, draft: AdjDraft): Record<string, number> {
  const t104 = adjTotal(draft.add), t107 = adjTotal(draft.deduct), t110 = adjTotal(draft.instalments), t111 = adjTotal(draft.rebates);
  const l105 = round2((base['103'] ?? 0) + t104);
  const l108 = round2((base['106'] ?? 0) + t107);
  const l109 = round2(l105 - l108);
  const l112 = round2(t110 + t111);
  const balance = round2(l109 - l112);
  return {
    ...base,
    '104': t104, '105': l105, '107': t107, '108': l108, '109': l109,
    '110': t110, '111': t111, '112': l112, '113': balance,
    '114': Math.max(0, -balance), '115': Math.max(0, balance),
  };
}

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
  const [adjDraft, setAdjDraft] = useState<AdjDraft>(emptyAdj());
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjMsg, setAdjMsg] = useState<string | null>(null);
  const [adjError, setAdjError] = useState<string | null>(null);

  const load = useCallback(async (f?: string, t?: string) => {
    setLoading(true); setError(null); setFiledMsg(null); setAdjMsg(null); setAdjError(null);
    try {
      const qs = f && t ? `?from=${f}&to=${t}` : '';
      const res = await fetch(`/api/reports/gst-hst-return${qs}`).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setData(res.data);
      setAdjDraft(draftFromServer(res.data.adjustments ?? res.data.result?.adjustments));
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

  async function handleSaveAdjustments() {
    if (!data) return;
    setAdjSaving(true); setAdjMsg(null); setAdjError(null);
    try {
      const body: any = { periodStart: data.periodStart, periodEnd: data.periodEnd, adjustments: adjDraft };
      if (!data.registration) body.createRegistration = { registrationNumber: regNumber, filingFrequency: regFrequency };
      const res = await fetch('/api/reports/gst-hst-return', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.error) { setAdjError(res.error); return; }
      setAdjMsg('Adjustments saved for this period. The same amounts flow into a GL simple-path Tax Workpaper for this period.');
      load(data.periodStart, data.periodEnd);
    } catch { setAdjError('Failed to save adjustments.'); }
    finally { setAdjSaving(false); }
  }

  const setAdjRow = (key: keyof AdjDraft, idx: number, patch: Partial<AdjItem>) =>
    setAdjDraft(d => ({ ...d, [key]: d[key].map((row, i) => (i === idx ? { ...row, ...patch } : row)) }));
  const addAdjRow = (key: keyof AdjDraft) => setAdjDraft(d => ({ ...d, [key]: [...d[key], { amount: 0, note: '' }] }));
  const removeAdjRow = (key: keyof AdjDraft, idx: number) => setAdjDraft(d => ({ ...d, [key]: d[key].filter((_, i) => i !== idx) }));

  if (loading && !data) return <AppShell><div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>;

  const lines = data ? previewLines(data.result?.lines ?? {}, adjDraft) : {};
  const drill = data?.result?.drillDown ?? {};
  const worksheet = data?.worksheet ?? null;
  const wsByLine: Record<string, any> = {};
  for (const wl of worksheet?.lines ?? []) wsByLine[wl.line] = wl;

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
          {data && (
            <a href={`/api/reports/gst-hst-return?from=${data.periodStart}&to=${data.periodEnd}&format=worksheet`}>
              <Button variant="secondary"><FileCheck size={14} /> Audit package (JSON)</Button>
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

        {(data?.locked || data?.filed) && (
          <Alert variant="success" className="mb-4">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Period locked — return filed {(data.lockedFiled?.filedAt ?? data.filed?.filedAt)?.slice(0, 10)} (confirmation {data.lockedFiled?.filingConfirmation ?? data.filed?.filingConfirmation ?? '—'}). Postings that would change these figures are blocked.</span>
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
                  const adjItems = ADJ_LINE_GROUP[line] ? adjDraft[ADJ_LINE_GROUP[line]] : [];
                  const formula = wsByLine[line]?.composition?.formula ?? null;
                  const accounts = wsByLine[line]?.composition?.accounts ?? [];
                  const expandable = items.length > 0 || adjItems.length > 0 || Boolean(formula);
                  const open = openLine === line;
                  return [
                    <tr key={line} className={`border-t border-[var(--border)] ${SUBTOTAL_LINES.has(line) ? 'font-semibold' : ''}`}>
                      <td className="py-2 text-sm font-mono">{line}</td>
                      <td className="py-2 text-sm">{LABELS[line]}</td>
                      <td className="py-2 text-sm font-mono tabular-nums text-right">{money(lines[line] ?? 0)}</td>
                      <td className="py-2 text-right">
                        {expandable && (
                          <button className="text-[var(--text-muted)]" onClick={() => setOpenLine(open ? null : line)} aria-label={`Composition of line ${line}`}>
                            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        )}
                      </td>
                    </tr>,
                    open && expandable && (
                      <tr key={`${line}-detail`} className="bg-[var(--surface-2)]">
                        <td colSpan={4} className="p-3">
                          {formula && (
                            <p className="text-xs text-[var(--text-muted)] mb-2">
                              <span className="font-mono">{line} = {formula.terms.map((t: any, i: number) => `${i === 0 ? (t.sign < 0 ? '− ' : '') : (t.sign < 0 ? ' − ' : ' + ')}${t.line}`).join('')}</span>
                              {' — '}{formula.note}. Based on the saved figures; unsaved adjustment edits are not reflected here.
                            </p>
                          )}
                          {accounts.length > 0 && (
                            <table className="w-full text-xs mb-2">
                              <thead><tr className="text-left text-[var(--text-faint)]"><th>GL account</th><th className="text-right">Transactions</th><th className="text-right">Contribution</th></tr></thead>
                              <tbody>
                                {accounts.map((a: any) => (
                                  <tr key={a.accountCode} className="border-t border-[var(--border)]">
                                    <td className="py-1 font-mono">{a.accountCode}{a.accountName ? ` — ${a.accountName}` : ''}</td>
                                    <td className="py-1 text-right">{a.transactionCount}</td>
                                    <td className="py-1 text-right font-mono tabular-nums">{money(a.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {items.length > 0 && (
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
                          )}
                          {adjItems.length > 0 && (
                            <table className="w-full text-xs">
                              <thead><tr className="text-left text-[var(--text-faint)]"><th>Adjustment</th><th className="text-right">Amount</th></tr></thead>
                              <tbody>
                                {adjItems.map((a: AdjItem, i: number) => (
                                  <tr key={i} className="border-t border-[var(--border)]">
                                    <td className="py-1">{a.note || '—'}</td>
                                    <td className="py-1 text-right font-mono tabular-nums">{money(Number(a.amount) || 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-[var(--text-faint)] mt-3">Line 101 is rounded to the nearest whole dollar, as CRA requires. Every line is shown — a line with nothing to report reads $0.00 rather than disappearing. Expand a line to see the GL accounts and transactions behind it, its adjustments, or its formula. PST/RST and QST amounts are tracked in their own accounts and never enter these lines. Line definitions per CRA GST34 / Info Sheet GI-066.</p>
          </CardBody>
        </Card>

        {data && (
          <Card className="mb-4">
            <CardHeader><h3 className="t-h3">Adjustments — lines 104 / 107 / 110 / 111</h3></CardHeader>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)] mb-3">
                Period-level adjustments for this return (not journal postings). They update the return lines above live, are stored on this period&apos;s workpaper, and flow into a GL simple-path Tax Workpaper for the same period. Amounts must be $0 or more, each with a short note.
              </p>
              {adjMsg && <Alert variant="success" className="mb-3">{adjMsg}</Alert>}
              {adjError && <Alert variant="danger" className="mb-3">{adjError}</Alert>}
              {data.filed ? (
                <Alert variant="info">This period is recorded as filed — adjustments are read-only.</Alert>
              ) : (
                <>
                  {ADJ_GROUPS.map(group => (
                    <div key={group.key} className="mb-4">
                      <div className="flex items-baseline gap-2 mb-1">
                        <h4 className="text-sm font-semibold">Line {group.line} — {group.label}</h4>
                        <span className="text-xs text-[var(--text-muted)]">{group.hint}</span>
                        <span className="spacer" />
                        <span className="text-sm font-mono tabular-nums">Total {money(adjTotal(adjDraft[group.key]))}</span>
                      </div>
                      {adjDraft[group.key].map((row, idx) => (
                        <div key={idx} className="flex items-end gap-2 mb-2">
                          <div className="field w-36"><label>Amount ($)</label>
                            <input type="number" min="0" step="0.01" className="input" value={row.amount}
                              onChange={e => setAdjRow(group.key, idx, { amount: Number(e.target.value) })} />
                          </div>
                          <div className="field flex-1"><label>Note (required)</label>
                            <input className="input" value={row.note} placeholder="e.g. Bad-debt recovery — invoice 1042"
                              onChange={e => setAdjRow(group.key, idx, { note: e.target.value })} />
                          </div>
                          <Button variant="secondary" onClick={() => removeAdjRow(group.key, idx)}>Remove</Button>
                        </div>
                      ))}
                      <Button variant="secondary" onClick={() => addAdjRow(group.key)}>+ Add row</Button>
                    </div>
                  ))}
                  {!data.registration && (
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="field"><label>GST/HST registration (RT) number — needed to save</label><input className="input" value={regNumber} onChange={e => setRegNumber(e.target.value)} placeholder="123456789RT0001" /></div>
                      <div className="field"><label>Filing frequency</label><select className="input" value={regFrequency} onChange={e => setRegFrequency(e.target.value)}>
                        <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
                      </select></div>
                    </div>
                  )}
                  <Button onClick={handleSaveAdjustments} disabled={adjSaving}>
                    {adjSaving ? <Loader2 size={14} className="animate-spin" /> : null} Save adjustments
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        )}

        {worksheet && (
          <Card className="mb-4">
            <CardHeader><h3 className="t-h3 flex items-center gap-2"><Scale size={16} /> Reconciliation</h3></CardHeader>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)] mb-3">
                The tie-outs an auditor asks for first, computed from the saved figures. Differences are shown, never absorbed — a “review” or “difference” badge means the books and the return disagree by the amount shown.
              </p>
              <div className="space-y-3 mb-4">
                {worksheet.reconciliations.map((check: any) => (
                  <div key={check.id} className="border border-[var(--border)] rounded-md p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{check.label}</span>
                      <span className="spacer" />
                      {check.status === 'pass' && <Badge variant="paid">Pass</Badge>}
                      {check.status === 'warn' && <Badge variant="pending">Review</Badge>}
                      {check.status === 'fail' && <Badge variant="overdue">Difference</Badge>}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mb-2">{check.detail}</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      {check.figures.map((f: any) => (
                        <span key={f.label}>{f.label}: <span className="font-mono tabular-nums">{money(f.amount)}</span></span>
                      ))}
                      {check.difference != null && (
                        <span>Difference: <span className="font-mono tabular-nums">{money(check.difference)}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <h4 className="text-sm font-semibold mb-1">Control account continuity</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-faint)]">
                    <th className="py-1">Account</th><th className="text-right">Opening</th><th className="text-right">Movement</th>
                    <th className="text-right">Expected closing</th><th className="text-right">Closing per GL</th><th className="text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {worksheet.continuity.map((c: any) => (
                    <tr key={c.role} className="border-t border-[var(--border)]">
                      <td className="py-1 font-mono">{c.accountCode}{c.accountName ? ` — ${c.accountName}` : ''}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{money(c.opening)}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{money(c.movement)} <span className="text-[var(--text-faint)]">(line {c.movementLine})</span></td>
                      <td className="py-1 text-right font-mono tabular-nums">{money(c.expectedClosing)}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{money(c.closingPerGl)}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{money(c.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        )}

        {worksheet && (
          <Card className="mb-4">
            <CardHeader><h3 className="t-h3 flex items-center gap-2"><FileCheck size={16} /> File with CRA — NETFILE hand-off</h3></CardHeader>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)] mb-3">
                GST/HST NETFILE asks for four things: your CRA access code and three numbers from this return. Key them exactly as shown, for
                registration <span className="font-mono">{worksheet.netfile.registrationNumber ?? '—'}</span>, period {worksheet.netfile.periodStart} – {worksheet.netfile.periodEnd}.
                LedgerPro never submits to CRA — filing stays your act on CRA&apos;s site; record the confirmation below afterwards.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div className="border border-[var(--border)] rounded-md p-3">
                  <p className="text-xs text-[var(--text-faint)] mb-1">Access code</p>
                  <p className="text-sm">From CRA (your 4-digit code — not stored in LedgerPro)</p>
                </div>
                {worksheet.netfile.keyedNumbers.map((k: any) => (
                  <div key={k.line} className="border border-[var(--border)] rounded-md p-3">
                    <p className="text-xs text-[var(--text-faint)] mb-1">Line {k.line} — {k.label}</p>
                    <p className="text-lg font-mono tabular-nums">{money(lines[k.line] ?? k.amount)}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm mb-3">
                {worksheet.netfile.outcome === 'refund' && <>Result: a <strong>refund</strong> on line 114.</>}
                {worksheet.netfile.outcome === 'payment' && <>Result: a <strong>payment owing</strong> on line 115.</>}
                {worksheet.netfile.outcome === 'nil' && <>Result: a <strong>nil return</strong> — nothing to refund or pay.</>}
                {' '}The full audit trail — every line&apos;s composition, continuity and reconciliation results — is in the audit package:
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <a href={`/api/reports/gst-hst-return?from=${data.periodStart}&to=${data.periodEnd}&format=worksheet`}>
                  <Button variant="secondary"><Download size={14} /> Download audit package (gst-worksheet/1)</Button>
                </a>
                {worksheet.netfile.filing.filed ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Filed — recorded {worksheet.netfile.filing.filedAt?.slice(0, 10)} with confirmation{' '}
                    <span className="font-mono">{worksheet.netfile.filing.confirmation ?? '—'}</span>.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">Not yet recorded as filed.</p>
                )}
              </div>
            </CardBody>
          </Card>
        )}

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
