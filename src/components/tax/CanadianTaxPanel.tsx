'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

export interface TaxEditorLine {
  key: string;
  description: string;
  amount: number;
  categoryId: string | null;
}

interface TaxCode {
  id: string;
  code: string;
  label: string;
  jurisdiction: string;
  priceMode: 'exclusive' | 'inclusive';
  components: Array<{ kind: string; rate: string; recoveryAllowed: boolean }>;
}

interface TaxContext {
  enabled: boolean;
  ready: boolean;
  issues: Array<{ message: string }>;
  codes: TaxCode[];
  reviewers: Array<{ id: string; name: string; role: string }>;
}

interface LineDecision {
  taxCodeVersionId: string;
  recoveryBasisPoints: number;
  recoveryReason: string;
  recoveryEvidence: string;
  reviewerId: string;
}

export interface TaxEditorValue {
  enabled: boolean;
  ready: boolean;
  pending: boolean;
  error: string | null;
  preview: null | {
    netMinor: number;
    taxMinor: number;
    grossMinor: number;
    netHomeMinor: number;
    taxHomeMinor: number;
    grossHomeMinor: number;
    journalLines: Array<{ glAccountCode: string; description: string; debitMinor: number; creditMinor: number }>;
    snapshots: Array<{ sourceLineId: string; components: Array<{ kind: string; taxMinor: number; recoverableMinor: number; nonRecoverableMinor: number }> }>;
  };
  taxDecision?: {
    requestKey: string;
    lines: Array<{
      lineIndex: number;
      taxCodeVersionId: string;
      jurisdictionEvidence: Record<string, unknown>;
      recovery?: Record<string, { basisPoints: number; reason: string; evidence: Record<string, unknown>; reviewedById: string }>;
    }>;
  };
}

interface Props {
  direction: 'sale' | 'purchase';
  documentDate: string;
  documentCurrency: string;
  homeCurrency: string;
  fxRate: number | null;
  lines: TaxEditorLine[];
  onChange: (value: TaxEditorValue) => void;
}

const blankValue: TaxEditorValue = { enabled: false, ready: false, pending: false, error: null, preview: null };

export function CanadianTaxPanel({ direction, documentDate, documentCurrency, homeCurrency, fxRate, lines, onChange }: Props) {
  const [context, setContext] = useState<TaxContext | null>(null);
  const [evidence, setEvidence] = useState('');
  const [decisions, setDecisions] = useState<Record<string, LineDecision>>({});
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<TaxEditorValue['preview']>(null);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef(`tax-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let active = true;
    setContext(null);
    fetch(`/api/tax/context?date=${encodeURIComponent(documentDate)}`)
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Could not load tax options.');
        if (active) setContext(json.data);
      })
      .catch(reason => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : 'Could not load tax options.';
        setError(message);
        onChange({ enabled: false, ready: false, pending: false, error: message, preview: null });
      });
    return () => { active = false; };
  }, [documentDate, onChange]);

  useEffect(() => {
    if (!context?.enabled || !context.codes.length) return;
    setDecisions(previous => {
      const next: Record<string, LineDecision> = {};
      for (const line of lines) {
        const current = previous[line.key];
        const valid = current && context.codes.some(code => code.id === current.taxCodeVersionId);
        next[line.key] = valid ? current : {
          taxCodeVersionId: '',
          recoveryBasisPoints: 0,
          recoveryReason: '',
          recoveryEvidence: '',
          reviewerId: '',
        };
      }
      return next;
    });
  }, [context, lines]);

  const payload = useMemo(() => {
    if (!context?.enabled || !context.ready || !evidence.trim() || lines.some(line => !line.categoryId || !decisions[line.key])) return null;
    const taxLines = lines.map((line, lineIndex) => {
      const decision = decisions[line.key];
      const code = context.codes.find(item => item.id === decision.taxCodeVersionId)!;
      if (!code) return null;
      const recovery: Record<string, { basisPoints: number; reason: string; evidence: Record<string, unknown>; reviewedById: string }> = {};
      for (const component of code.components.filter(item => direction === 'purchase' && item.recoveryAllowed)) {
        if (!decision.reviewerId || !decision.recoveryReason.trim() || !decision.recoveryEvidence.trim()) return null;
        recovery[component.kind] = {
          basisPoints: decision.recoveryBasisPoints,
          reason: decision.recoveryReason.trim(),
          evidence: { reference: decision.recoveryEvidence.trim() },
          reviewedById: decision.reviewerId,
        };
      }
      return {
        lineIndex,
        clientLineId: line.key,
        categoryId: line.categoryId,
        amount: line.amount,
        taxCodeVersionId: decision.taxCodeVersionId,
        jurisdictionEvidence: { reference: evidence.trim(), jurisdiction: code.jurisdiction },
        ...(Object.keys(recovery).length ? { recovery } : {}),
      };
    });
    if (taxLines.some(line => line === null)) return null;
    return taxLines as Array<Exclude<(typeof taxLines)[number], null>>;
  }, [context, decisions, direction, evidence, lines]);

  useEffect(() => {
    if (!context) return;
    if (!context.enabled) {
      onChange(blankValue);
      return;
    }
    if (!context.ready || !payload) {
      setPreview(null);
      setPending(false);
      setError(null);
      const value = { enabled: true, ready: context.ready, pending: false, error: null, preview: null };
      onChange(value);
      return;
    }
    if (documentCurrency !== homeCurrency && !fxRate) {
      const value = { enabled: true, ready: true, pending: false, error: 'An exchange rate is required before tax can be previewed.', preview: null };
      setError(value.error);
      onChange(value);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const response = await fetch('/api/tax/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ direction, documentDate, documentCurrency, fxRate: fxRate?.toString() ?? null, lines: payload }),
        });
        const json = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(json.error || 'Tax preview failed.');
        setPreview(json.data);
        onChange({
          enabled: true, ready: true, pending: false, error: null, preview: json.data,
          taxDecision: { requestKey: requestKey.current, lines: payload.map(({ clientLineId: _clientLineId, categoryId: _categoryId, amount: _amount, ...line }) => line) },
        });
      } catch (reason) {
        if (controller.signal.aborted) return;
        const message = reason instanceof Error ? reason.message : 'Tax preview failed.';
        setPreview(null);
        setError(message);
        onChange({ enabled: true, ready: true, pending: false, error: message, preview: null });
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, 300);
    setPending(true);
    onChange({ enabled: true, ready: true, pending: true, error: null, preview: null });
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [context, direction, documentCurrency, documentDate, fxRate, homeCurrency, onChange, payload]);

  if (!context || !context.enabled) return null;
  if (!context.ready) {
    return <div className="rounded-2xl border border-[var(--warning-soft-border)] bg-[var(--warning-soft)] p-4">
      <div className="flex gap-2 text-sm font-semibold text-[var(--warning)]"><AlertTriangle size={16} /> Tax setup needs attention</div>
      <ul className="mt-2 list-disc pl-5 text-xs text-[var(--text-muted)]">{context.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
    </div>;
  }

  return <div className="rounded-2xl border border-[var(--primary-soft-border)] bg-[var(--surface)] p-5 space-y-4">
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
        {pending ? <Loader2 size={16} className="animate-spin" /> : preview ? <CheckCircle2 size={16} className="text-[var(--success)]" /> : <AlertTriangle size={16} className="text-[var(--warning)]" />}
        Reviewed Canadian tax
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Tax is calculated again on the server. Browser totals are never used for posting.</p>
    </div>
    <div className="field">
      <label>Place-of-supply evidence</label>
      <input className="input" value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Delivery address, customer/vendor record, or rule reference" />
    </div>
    <div className="space-y-3">
      {lines.map((line, index) => {
        const decision = decisions[line.key];
        const code = context.codes.find(item => item.id === decision?.taxCodeVersionId);
        const recoverable = direction === 'purchase' && code?.components.some(item => item.recoveryAllowed);
        return <div key={line.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-2">
          <div className="text-xs font-semibold text-[var(--text-strong)]">Line {index + 1}: {line.description || 'Untitled line'}</div>
          <select className="select" value={decision?.taxCodeVersionId ?? ''} onChange={event => setDecisions(previous => ({ ...previous, [line.key]: { ...previous[line.key], taxCodeVersionId: event.target.value } }))}>
            <option value="">Choose a tax treatment…</option>
            {context.codes.map(item => <option key={item.id} value={item.id}>{item.label} ({item.priceMode})</option>)}
          </select>
          {code && <div className="text-xs text-[var(--text-muted)]">{code.components.map(item => `${item.kind} ${item.rate}%`).join(' + ') || code.label}</div>}
          {recoverable && decision && <div className="grid gap-2 md:grid-cols-2">
            <div className="field"><label>Recovery %</label><input className="input" type="number" min="0" max="100" step="0.01" value={decision.recoveryBasisPoints / 100} onChange={event => setDecisions(previous => ({ ...previous, [line.key]: { ...decision, recoveryBasisPoints: Math.round((Number(event.target.value) || 0) * 100) } }))} /></div>
            <div className="field"><label>Approved by</label><select className="select" value={decision.reviewerId} onChange={event => setDecisions(previous => ({ ...previous, [line.key]: { ...decision, reviewerId: event.target.value } }))}><option value="">Select owner/admin…</option>{context.reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.name} ({reviewer.role})</option>)}</select></div>
            <div className="field"><label>Recovery reason</label><input className="input" value={decision.recoveryReason} onChange={event => setDecisions(previous => ({ ...previous, [line.key]: { ...decision, recoveryReason: event.target.value } }))} /></div>
            <div className="field"><label>Supporting evidence</label><input className="input" value={decision.recoveryEvidence} onChange={event => setDecisions(previous => ({ ...previous, [line.key]: { ...decision, recoveryEvidence: event.target.value } }))} placeholder="Vendor invoice/reference" /></div>
          </div>}
        </div>;
      })}
    </div>
    {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
    {direction === 'purchase' && context.reviewers.length === 0 && <p className="text-xs text-[var(--warning)]">An owner or admin must sign in to approve purchase tax recovery and post this bill.</p>}
    {preview && !pending && <div className="space-y-3 text-xs">
      <div className="font-semibold">Tax breakdown ({documentCurrency})</div>
      {preview.snapshots.map((snapshot, index) => <div key={snapshot.sourceLineId}>
        <span className="font-medium">Line {index + 1}: </span>
        {snapshot.components.map(component => `${component.kind} ${(component.taxMinor / 100).toFixed(2)}${direction === 'purchase' ? ` — recoverable ${(component.recoverableMinor / 100).toFixed(2)}, expense/asset ${(component.nonRecoverableMinor / 100).toFixed(2)}` : ''}`).join('; ')}
      </div>)}
      <div className="font-semibold">Posting preview ({homeCurrency})</div>
      <table className="w-full text-left"><thead><tr><th>GL account</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
        <tbody>{preview.journalLines.map((line, index) => <tr key={index}><td>{line.glAccountCode}</td><td>{line.description}</td><td className="text-right">{(line.debitMinor / 100).toFixed(2)}</td><td className="text-right">{(line.creditMinor / 100).toFixed(2)}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
