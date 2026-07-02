'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { BUSINESS_TYPES, PROVINCE_OPTIONS } from '@/lib/taxes';
import { ArrowLeft, Building2, CreditCard, Users, Save, Loader2, Calendar, Download, Upload, DatabaseBackup } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const [company, setCompany] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', legalName: '', businessType: 'corporation', businessNumber: '', gstNumber: '',
    province: 'AB', fiscalYearStart: '', fiscalYearEnd: '', currency: 'CAD', locale: 'en-CA', timezone: 'America/Edmonton',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

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
          setForm({
            name: comp.name || '', legalName: comp.legalName || '',
            businessType: comp.businessType || 'corporation',
            businessNumber: comp.businessNumber || '', gstNumber: comp.gstNumber || '',
            province: comp.province || 'AB',
            fiscalYearStart: comp.fiscalYearStart ? new Date(comp.fiscalYearStart).toISOString().slice(0, 10) : '',
            fiscalYearEnd: comp.fiscalYearEnd ? new Date(comp.fiscalYearEnd).toISOString().slice(0, 10) : '',
            currency: comp.currency || 'CAD', locale: comp.locale || 'en-CA', timezone: comp.timezone || 'America/Edmonton',
          });
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
      const res = await fetch('/api/companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      setMessage('Settings saved.');
    } catch { setMessage('Failed to save.'); }
    finally { setSaving(false); }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch('/api/backup/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="(.+)"/);
      const fileName = match?.[1] || `ledgerpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setRestoreResult({ type: 'danger', text: 'Failed to export backup.' });
    } finally {
      setExporting(false);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('Restore this backup into a brand-new company? Your existing company data will not be touched.')) return;

    setRestoring(true);
    setRestoreResult(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Restore failed');
      setRestoreResult({ type: 'success', text: `Restored into new company "${json.data.name}". Use the company switcher to open it.` });
    } catch (err: any) {
      setRestoreResult({ type: 'danger', text: err.message || 'Failed to restore backup — check the file is a valid LedgerPro backup.' });
    } finally {
      setRestoring(false);
    }
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
                  <div className="field"><label>Company Name</label><input type="text" className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                  <div className="field"><label>Legal Name</label><input type="text" className="input" value={form.legalName} onChange={e => setForm({...form, legalName: e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="field"><label>Business Type</label><select className="input" value={form.businessType} onChange={e => setForm({...form, businessType: e.target.value})}>{BUSINESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
                  <div className="field"><label>Province</label><select className="input" value={form.province} onChange={e => setForm({...form, province: e.target.value})}>{PROVINCE_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="field"><label>Business Number (BN)</label><input type="text" className="input" value={form.businessNumber} onChange={e => setForm({...form, businessNumber: e.target.value})} maxLength={9} /></div>
                  <div className="field"><label>GST/HST Number</label><input type="text" className="input" value={form.gstNumber} onChange={e => setForm({...form, gstNumber: e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="field"><label>Fiscal Year Start</label><input type="date" className="input" value={form.fiscalYearStart} onChange={e => setForm({...form, fiscalYearStart: e.target.value})} /></div>
                  <div className="field"><label>Fiscal Year End</label><input type="date" className="input" value={form.fiscalYearEnd} onChange={e => setForm({...form, fiscalYearEnd: e.target.value})} /></div>
                  <div className="field"><label>Currency</label><select className="input" value={form.currency} onChange={e => setForm({...form, currency: e.target.value})}><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option></select></div>
                </div>
                <Button type="submit" disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes</Button>
              </form>
            </CardBody>
          </Card>

          {/* Data Backup & Restore */}
          <Card>
            <CardHeader><div className="flex items-center gap-2"><DatabaseBackup size={16} className="text-[var(--text-muted)]" /><h2 className="text-sm font-semibold">Data Backup</h2></div></CardHeader>
            <CardBody>
              {restoreResult && <Alert variant={restoreResult.type} className="mb-4">{restoreResult.text}</Alert>}
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Your database is automatically backed up by our hosting provider (Neon), which supports point-in-time recovery.
                This is a self-serve copy of your own data, independent of that — useful for your own records or migrating to a new company.
              </p>
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={handleExport} disabled={exporting}>
                  {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download Backup
                </Button>
                <Button variant="ghost" onClick={() => restoreInputRef.current?.click()} disabled={restoring}>
                  {restoring ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Restore into New Company
                </Button>
                <input ref={restoreInputRef} type="file" accept="application/json" className="hidden" onChange={handleRestoreFile} disabled={restoring} />
              </div>
              <p className="text-xs text-[var(--text-faint)] mt-3">
                Restoring always creates a brand-new company — it never overwrites an existing one. Bank feed connections, audit
                log history, and import batch history are not included in backups.
              </p>
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
