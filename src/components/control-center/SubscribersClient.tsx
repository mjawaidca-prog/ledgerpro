'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/Card';
import { fmtDate } from './ControlCenterShell';

const STATUSES = ['', 'trialing', 'active', 'past_due', 'canceled', 'expired'];
const PLANS = ['', 'Free Trial', 'Basic', 'Pro', 'Enterprise', 'Owner'];

export function SubscribersClient() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [expiry, setExpiry] = useState('');
  const [err, setErr] = useState('');
  const limit = 25;

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) p.set('search', search); if (plan) p.set('plan', plan); if (status) p.set('status', status); if (expiry) p.set('expiry', expiry);
      const r = await fetch(`/api/platform/subscribers?${p}`); const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load');
      setRows(j.data || []); setTotal(j.pagination?.total || 0); setErr('');
    } catch (e: any) { setErr(e.message); }
  }, [page, search, plan, status, expiry]);
  useEffect(() => { load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-4">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, email, company…" className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm flex-1 min-w-[200px]" />
        <select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }} className="px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"><option value="">Any plan</option>{PLANS.filter(Boolean).map((p) => <option key={p}>{p}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"><option value="">Any status</option>{STATUSES.filter(Boolean).map((s) => <option key={s}>{s}</option>)}</select>
        <select value={expiry} onChange={(e) => { setExpiry(e.target.value); setPage(1); }} className="px-2 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"><option value="">Any trial expiry</option><option value="7">Expires in 7 days</option><option value="14">Expires in 14 days</option><option value="expired">Trial date passed</option></select>
      </div>
      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
      <p className="text-xs text-[var(--text-muted)] mb-3">One row per user (subscriber). A user with several companies counts once here; their companies roll up inside the row. {total} subscriber(s).</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.user.id}><CardBody>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <Link href={`/control-center/subscribers/${r.user.id}`} className="font-semibold text-[var(--text-strong)] no-underline hover:underline">{r.user.name}</Link>
                <div className="text-sm text-[var(--text-muted)]">{r.user.email} · signed up {fmtDate(r.user.createdAt)}</div>
              </div>
              <div className="text-sm text-right">
                <div><strong>{r.companyCount}</strong> compan{r.companyCount === 1 ? 'y' : 'ies'} · onboarding {r.onboarding.complete}/{r.onboarding.total} complete</div>
                <div className="text-[var(--text-muted)]">{Object.entries(r.planCounts).map(([k, v]: any) => `${k} ×${v}`).join(' · ') || 'No subscription recorded'}</div>
                <div className="text-[var(--text-muted)]">Earliest trial expiry: {fmtDate(r.earliestTrialExpiry)}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-2 flex-wrap">
              {r.companies.map((c: any) => (
                <span key={c.companyId} className="text-xs px-2 py-1 rounded-full border border-[var(--border)]">{c.companyName} — {c.planName ?? 'No plan'} · {c.status}{c.billingLabel === 'complimentary_owner' ? ' · Complimentary (Owner)' : ''}{(r.followUps || []).find((f: any) => f.companyId === c.companyId)?.contactOptOut ? ' · ⚠ contact opt-out' : ''}</span>
              ))}
            </div>
          </CardBody></Card>
        ))}
        {rows.length === 0 && !err && <p className="text-sm text-[var(--text-muted)]">No subscribers match.</p>}
      </div>
      <div className="flex items-center gap-3 mt-4 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-md border border-[var(--border)] disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
