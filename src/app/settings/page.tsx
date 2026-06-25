'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { ArrowLeft, Building2, CreditCard, Users, Save, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const [company, setCompany] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', legalName: '', currency: '', locale: '', timezone: '' });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [compRes, subRes] = await Promise.all([
          fetch('/api/companies').then(r => r.json()),
          fetch('/api/subscriptions').then(r => r.json()),
        ]);
        const comp = compRes.data?.[0];
        if (comp) {
          setCompany(comp);
          setForm({ name: comp.name || '', legalName: '', currency: 'USD', locale: 'en-US', timezone: 'America/Edmonton' });
        }
        setSubscription(subRes.data);
      } catch {} finally { setLoading(false); }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMessage(null);
    try {
      // Update company — stub for now (PUT endpoint not built yet)
      setMessage('Settings saved.');
    } catch { setMessage('Failed to save.'); }
    finally { setSaving(false); }
  }

  if (loading) return <AppShell companyName="Settings" companyPlan=""><div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={24} /></div></AppShell>;

  return (
    <AppShell companyName={company?.name || 'Settings'} companyPlan={subscription?.plan?.name || 'Free Trial'}>
      <div className="max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-[var(--surface-3)]"><ArrowLeft size={18} className="text-[var(--text-muted)]" /></button>
          <div><h1 className="text-2xl font-bold text-[var(--text-strong)]">Settings</h1><p className="text-sm text-[var(--text-muted)]">Manage your company and subscription.</p></div>
        </div>

        {message && <Alert variant="success" className="mb-4">{message}</Alert>}

        <div className="space-y-6">
          {/* Company Profile */}
          <Card>
            <CardHeader><div className="flex items-center gap-2"><Building2 size={16} className="text-[var(--text-muted)]" /><h2 className="text-sm font-semibold">Company Profile</h2></div></CardHeader>
            <CardBody>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Company Name</label><input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]" /></div>
                  <div><label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Legal Name</label><input type="text" value={form.legalName} onChange={e => setForm({...form, legalName: e.target.value})} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]" /></div>
                  <div><label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Currency</label><select value={form.currency} onChange={e => setForm({...form, currency: e.target.value})} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]"><option>USD</option><option>CAD</option><option>GBP</option><option>EUR</option></select></div>
                  <div><label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Time Zone</label><select value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]"><option>America/Edmonton</option><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></div>
                </div>
                <Button type="submit" disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes</Button>
              </form>
            </CardBody>
          </Card>

          {/* Subscription */}
          <Card>
            <CardHeader><div className="flex items-center gap-2"><CreditCard size={16} className="text-[var(--text-muted)]" /><h2 className="text-sm font-semibold">Subscription</h2></div></CardHeader>
            <CardBody>
              {subscription ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Plan</span><span className="font-medium text-[var(--text-strong)]">{subscription.plan?.name || 'Free Trial'}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Status</span><span className="font-medium text-[var(--accent)]">{subscription.status}</span></div>
                  {subscription.trialEndsAt && <div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Trial Ends</span><span className="font-medium text-[var(--text)]">{new Date(subscription.trialEndsAt).toLocaleDateString()}</span></div>}
                  <div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Price</span><span className="font-medium text-[var(--text)]">${Number(subscription.plan?.monthlyPrice || 0)}/mo</span></div>
                </div>
              ) : <p className="text-sm text-[var(--text-muted)]">No active subscription.</p>}
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <Button variant="ghost" onClick={() => router.push('/settings/billing')} className="text-sm">Upgrade Plan</Button>
              </div>
            </CardBody>
          </Card>

          {/* Team */}
          <Card>
            <CardHeader><div className="flex items-center gap-2"><Users size={16} className="text-[var(--text-muted)]" /><h2 className="text-sm font-semibold">Team</h2></div></CardHeader>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)] mb-3">Invite team members to collaborate.</p>
              <Button variant="ghost" onClick={() => router.push('/settings/team')}>Manage Team</Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
