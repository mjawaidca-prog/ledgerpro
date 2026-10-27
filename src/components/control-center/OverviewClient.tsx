'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { fmtDateTime } from './ControlCenterShell';

export function OverviewClient() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch('/api/platform/overview').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to load'); setData(j.data); }).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!data) return <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  const cards: Array<[string, string, string]> = [
    ['Companies — trialing', String(data.companiesBySubscriptionStatus.trialing ?? 0), 'companies (latest subscription per company)'],
    ['Companies — active', String(data.companiesBySubscriptionStatus.active ?? 0), 'companies'],
    ['Companies — past due', String(data.companiesBySubscriptionStatus.past_due ?? 0), 'companies'],
    ['Companies — canceled / expired', `${data.companiesBySubscriptionStatus.canceled ?? 0} / ${data.companiesBySubscriptionStatus.expired ?? 0}`, 'companies'],
    ['Trials expiring in 7 days', String(data.trialsExpiringWithin7Days), 'companies'],
    ['Trials expiring in 14 days', String(data.trialsExpiringWithin14Days), 'companies'],
    ['Signups this week', String(data.signupsThisWeek), 'users'],
    ['Total users', String(data.totalUsers), 'users'],
    ['Active API keys', String(data.activeApiKeys), 'keys (not revoked)'],
    ['Dead webhook deliveries', String(data.deadWebhookDeliveries), 'deliveries'],
    ['Follow-ups due', String(data.followUpsDue), 'companies'],
  ];
  const bank = Object.entries(data.bankConnectionsByStatus || {});
  return (
    <div>
      {data.bankFeedPilot?.pilotGated && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text)]"><strong>Bank feeds — pilot mode.</strong> {data.bankFeedPilot.label} Plan policy stays Pro / Enterprise / Owner only.</div>
      )}
      <p className="text-xs text-[var(--text-muted)] mb-4">As of {fmtDateTime(data.asOf)} · every card names its unit — subscription counts are per company, never per person.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {cards.map(([label, value, unit]) => (
          <Card key={label}><CardBody><div className="text-2xl font-bold text-[var(--text-strong)]">{value}</div><div className="text-sm font-medium text-[var(--text)]">{label}</div><div className="text-xs text-[var(--text-muted)]">{unit}</div></CardBody></Card>
        ))}
        <Card><CardBody><div className="text-sm font-medium text-[var(--text)] mb-1">Bank connections by status</div>{bank.length === 0 ? <div className="text-sm text-[var(--text-muted)]">No activity recorded</div> : bank.map(([k, v]: any) => <div key={k} className="text-sm flex justify-between"><span>{k}</span><strong>{String(v)}</strong></div>)}</CardBody></Card>
      </div>
      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href="/control-center/subscribers" className="text-sm font-medium text-[var(--primary)] no-underline">Open subscriber list →</Link>
        <Link href="/control-center/follow-ups" className="text-sm font-medium text-[var(--primary)] no-underline">Follow-ups due ({data.followUpsDue}) →</Link>
      </div>
    </div>
  );
}
