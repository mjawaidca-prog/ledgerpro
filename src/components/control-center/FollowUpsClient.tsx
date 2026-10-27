'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { fmtDate } from './ControlCenterShell';

export function FollowUpsClient() {
  const [rows, setRows] = useState<any[]>([]);
  const [dueOnly, setDueOnly] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/platform/follow-ups${dueOnly ? '?due=1' : ''}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); setRows(j.data || []); }).catch((e) => setErr(e.message));
  }, [dueOnly]);
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Due only</label>
        <span className="text-sm text-[var(--text-muted)]">{rows.length} follow-up record(s){dueOnly ? ' due' : ''}. Records are created from a subscriber's company panel.</span>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="space-y-3">
        {rows.map((f) => (
          <Card key={f.id}><CardBody>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <div><strong className="text-[var(--text-strong)]">{f.companyName ?? f.companyId}</strong> — {String(f.status).replace(/_/g, ' ')}{f.due ? ' · due' : ''}{f.contactOptOut ? ' · ⚠ contact opt-out' : ''}</div>
              <div className="text-[var(--text-muted)]">Next: {fmtDate(f.nextFollowUpAt)} · Last contacted: {fmtDate(f.lastContactedAt)}</div>
            </div>
            {f.note && <p className="text-sm mt-1">{f.note}</p>}
            <p className="text-xs text-[var(--text-muted)] mt-1">Open the subscriber list to edit this follow-up in the company panel.</p>
          </CardBody></Card>
        ))}
        {rows.length === 0 && !err && <p className="text-sm text-[var(--text-muted)]">Nothing here yet. Follow-ups appear once you save one from a subscriber's company panel.</p>}
      </div>
      <Link href="/control-center/subscribers" className="inline-block mt-4 text-sm font-medium text-[var(--primary)] no-underline">Go to subscribers →</Link>
    </div>
  );
}
