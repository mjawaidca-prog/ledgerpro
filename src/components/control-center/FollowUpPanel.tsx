'use client';
import { useEffect, useState } from 'react';

const STATUSES = ['new', 'reviewing', 'contacted', 'follow_up_due', 'converted', 'closed'];
const dtLocal = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

export function FollowUpPanel({ companyId, companyName, initial }: { companyId: string; companyName: string; initial?: any }) {
  const [f, setF] = useState<any>(initial ?? null);
  const [draft, setDraft] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState(initial?.status ?? 'new');
  const [note, setNote] = useState(initial?.note ?? '');
  const [next, setNext] = useState(dtLocal(initial?.nextFollowUpAt));
  const [last, setLast] = useState(dtLocal(initial?.lastContactedAt));
  const [optOut, setOptOut] = useState(!!initial?.contactOptOut);

  useEffect(() => {
    fetch(`/api/platform/follow-ups/${companyId}`).then(async (r) => { const j = await r.json(); if (r.ok) { setDraft(j.data.emailDraft); if (j.data.followUp) { setF(j.data.followUp); setStatus(j.data.followUp.status); setNote(j.data.followUp.note ?? ''); setNext(dtLocal(j.data.followUp.nextFollowUpAt)); setLast(dtLocal(j.data.followUp.lastContactedAt)); setOptOut(!!j.data.followUp.contactOptOut); } } }).catch(() => {});
  }, [companyId]);

  async function save() {
    setMsg('');
    const r = await fetch(`/api/platform/follow-ups/${companyId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note, nextFollowUpAt: next || null, lastContactedAt: last || null, contactOptOut: optOut }) });
    const j = await r.json();
    if (!r.ok) { setMsg(j.error || 'Save failed'); return; }
    setF(j.data); setMsg('Saved — and recorded in the platform audit log.');
  }

  return (
    <div className="mt-5 pt-4 border-t border-[var(--border)]">
      <h3 className="text-sm font-semibold mb-2">Follow-up — {companyName} {optOut && <span className="text-xs font-bold text-red-600">⚠ CONTACT OPT-OUT — do not email</span>}</h3>
      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <label className="block">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)]">{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
        </label>
        <label className="block">Assigned admin
          <input value={f?.assignedAdminId ?? 'You (on first save)'} readOnly className="mt-1 w-full px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-muted)]" />
        </label>
        <label className="block">Next follow-up date
          <input type="date" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1 w-full px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)]" />
        </label>
        <label className="block">Last contacted
          <input type="date" value={last} onChange={(e) => setLast(e.target.value)} className="mt-1 w-full px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)]" />
        </label>
      </div>
      <label className="block text-sm mt-3">Internal note (platform only — never sent to the customer)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)]" />
      </label>
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} /> Contact opt-out — this company has asked not to be contacted</label>
      <div className="flex gap-2 mt-3 flex-wrap items-center">
        <button onClick={save} className="px-4 py-2 rounded-md bg-[var(--primary)] text-white text-sm font-semibold">Save follow-up</button>
        {draft && !optOut && <a href={draft.mailto} className="px-4 py-2 rounded-md border border-[var(--border)] text-sm font-medium no-underline text-[var(--text)]">Open email draft</a>}
        {draft && <button onClick={() => { navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`); setMsg('Draft copied. Paste it into your own email — LedgerPro does not send it.'); }} className="px-4 py-2 rounded-md border border-[var(--border)] text-sm font-medium">Copy draft</button>}
      </div>
      {msg && <p className="text-sm text-[var(--text-muted)] mt-2">{msg}</p>}
      {Array.isArray(f?.history) && f.history.length > 0 && (
        <details className="mt-3"><summary className="text-sm cursor-pointer">History ({f.history.length})</summary>
          <ul className="text-xs text-[var(--text-muted)] mt-2 space-y-1">{[...f.history].reverse().map((h: any, i: number) => <li key={i}>{new Date(h.at).toLocaleString('en-CA')} — {h.action} · status {h.status}{h.note ? ` · “${String(h.note).slice(0, 120)}”` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
