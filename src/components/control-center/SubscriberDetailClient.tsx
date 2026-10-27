'use client';
import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { fmtDate, fmtDateTime } from './ControlCenterShell';
import { FollowUpPanel } from './FollowUpPanel';

function milestone(label: string, iso?: string | null) {
  return <div className="flex justify-between text-sm py-0.5"><span className="text-[var(--text-muted)]">{label}</span><span>{fmtDate(iso)}</span></div>;
}

export function SubscriberDetailClient({ userId }: { userId: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch(`/api/platform/subscribers/${userId}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed'); setData(j.data); }).catch((e) => setErr(e.message)); }, [userId]);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!data) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  const billingText = (s: any) => !s ? 'No subscription recorded' : s.billingLabel === 'complimentary_owner' ? 'Complimentary — no Stripe (Owner plan)' : s.billingLabel === 'stripe' ? `Stripe subscription ${s.stripeSubscriptionId}` : 'No Stripe subscription';
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--text-strong)]">{data.user.name}</h2>
      <p className="text-sm text-[var(--text-muted)] mb-5">{data.user.email} · signed up {fmtDate(data.user.createdAt)} · email verified: {data.user.emailVerified ? fmtDate(data.user.emailVerified) : 'Not recorded'}</p>
      <div className="space-y-4">
        {data.companies.map((c: any) => (
          <Card key={c.id}>
            <CardHeader><div className="font-semibold text-[var(--text-strong)]">{c.name}</div><div className="text-xs text-[var(--text-muted)]">Membership role: {c.membershipRole} · province: {c.province ?? 'Not recorded'} · created {fmtDate(c.createdAt)}</div></CardHeader>
            <CardBody>
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Subscription (per company)</h3>
                  {c.subscription ? <>
                    <div className="text-sm">Plan: <strong>{c.subscription.planName ?? 'Unknown'}</strong> · Status: <strong>{c.subscription.status}</strong></div>
                    <div className="text-sm">Trial ends: {fmtDate(c.subscription.trialEndsAt)} · Period: {fmtDate(c.subscription.currentPeriodStart)} – {fmtDate(c.subscription.currentPeriodEnd)}</div>
                    <div className="text-sm">Billing: {billingText(c.subscription)}</div>
                  </> : <p className="text-sm text-[var(--text-muted)]">No subscription recorded</p>}
                  <h3 className="text-sm font-semibold mt-4 mb-1">Milestones (derived)</h3>
                  {milestone('Company created', c.createdAt)}
                  <div className="flex justify-between text-sm py-0.5"><span className="text-[var(--text-muted)]">Onboarding complete</span><span>{c.milestones.onboardingComplete ? 'Yes (completion date not stored separately)' : 'No'}</span></div>
                  {milestone('First statement import', c.milestones.firstStatementImport)}
                  {milestone('First invoice', c.milestones.firstInvoice)}
                  {milestone('First bank connection', c.milestones.firstBankConnection)}
                  {milestone('API key created', c.milestones.apiKeyCreated)}
                  {milestone('API key last used', c.milestones.apiKeyFirstUsed)}
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-2">Bank & API health (status only)</h3>
                  {c.bankConnections.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No bank connections recorded</p> : c.bankConnections.map((b: any) => <div key={b.id} className="text-sm py-0.5">{b.institutionName} — {b.status} · last sync {fmtDateTime(b.lastSyncAt)}</div>)}
                  {c.apiKeys.length === 0 ? <p className="text-sm text-[var(--text-muted)] mt-2">No API keys recorded</p> : c.apiKeys.map((k: any) => <div key={k.id} className="text-sm py-0.5">{k.name} ({k.keyPrefix}…) — {k.revoked ? 'revoked' : 'active'} · {k.requestCount} requests · last used {fmtDateTime(k.lastUsedAt)}</div>)}
                  <p className="text-xs text-[var(--text-muted)] mt-2">API access for this company: {c.apiAccessEnabled ? 'enabled' : 'disabled'}. No balances, transactions or documents are shown in the Control Center.</p>
                </div>
              </div>
              <FollowUpPanel companyId={c.id} companyName={c.name} initial={c.followUp} />
            </CardBody>
          </Card>
        ))}
        {data.companies.length === 0 && <p className="text-sm text-[var(--text-muted)]">This user has no company memberships recorded.</p>}
      </div>
    </div>
  );
}
