'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Loader2, Save } from 'lucide-react';

type Account = { id: string; code: string; name: string; type: string; active: boolean };
type Registration = {
  id: string; regime: string; registrationNumber: string; province: string | null; method: string;
  filingFrequency: string; validFrom: string; validTo: string | null; active: boolean;
  reviewed: boolean; reviewedAt: string | null;
};
type Setup = {
  canManage: boolean;
  company: { name: string; province: string | null; businessNumber: string | null; gstNumber: string | null; fiscalYearStart: string };
  accounts: Account[];
  configuration: null | {
    enabled: boolean; defaultPriceMode: string; requireJurisdictionEvidence: boolean;
    configuredById: string | null; configuredAt: string | null;
    mappings: Record<string, Account | null>;
  };
  registrations: Registration[];
  reviewedPostingReadiness: { ready: boolean; issues: { code: string; message: string }[] };
  workpaperReadiness: { ready: boolean; issues: string[] };
};

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const REGIMES = [
  { value: 'gst_hst', label: 'GST/HST' },
  { value: 'qst', label: 'QST (Quebec)' },
  { value: 'pst', label: 'PST' },
  { value: 'rst', label: 'RST' },
];
const MAPPING_FIELDS: { key: string; label: string; types: string[]; hint: string }[] = [
  { key: 'gstHstOutput', label: 'GST/HST collected (output)', types: ['liability'], hint: 'Default chart code 2300 — Sales Tax Payable.' },
  { key: 'gstHstRecoverable', label: 'GST/HST recoverable (ITCs)', types: ['asset'], hint: 'Default chart code 2310 — GST/HST Recoverable.' },
  { key: 'qstOutput', label: 'QST collected (output)', types: ['liability'], hint: 'Optional. Only needed for a QST registration.' },
  { key: 'qstRecoverable', label: 'QST recoverable', types: ['asset'], hint: 'Optional. Only needed for a QST registration.' },
  { key: 'pstRstPayable', label: 'PST/RST payable', types: ['liability'], hint: 'Default chart code 2330 — Provincial Sales Tax Payable.' },
  { key: 'rounding', label: 'Tax rounding', types: ['expense'], hint: 'Expense account. Required to enable the tax workflow (a database rule), and before reviewed document postings are fully ready.' },
  { key: 'clearing', label: 'Tax clearing', types: ['asset', 'liability'], hint: 'Optional clearing account used by the reviewed engine.' },
];
const CONFIG_FIELD_BY_PURPOSE: Record<string, string> = {
  gstHstOutput: 'gstHstOutputAccountId',
  gstHstRecoverable: 'gstHstRecoverableAccountId',
  qstOutput: 'qstOutputAccountId',
  qstRecoverable: 'qstRecoverableAccountId',
  pstRstPayable: 'pstRstPayableAccountId',
  rounding: 'taxRoundingAccountId',
  clearing: 'taxClearingAccountId',
};
const DEFAULT_CODE_BY_PURPOSE: Record<string, string> = { gstHstOutput: '2300', gstHstRecoverable: '2310', pstRstPayable: '2330' };

export default function TaxSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'danger' | 'success'; text: string } | null>(null);
  // Configuration form state
  const [enabled, setEnabled] = useState(false);
  const [priceMode, setPriceMode] = useState('exclusive');
  const [requireEvidence, setRequireEvidence] = useState(true);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [configReviewed, setConfigReviewed] = useState(false);
  // Registration form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [regime, setRegime] = useState('gst_hst');
  const [regNumber, setRegNumber] = useState('');
  const [province, setProvince] = useState('');
  const [frequency, setFrequency] = useState('annual');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [regActive, setRegActive] = useState(true);
  const [regReviewed, setRegReviewed] = useState(false);

  const hydrate = useCallback((data: Setup) => {
    setSetup(data);
    if (data.configuration) {
      setEnabled(data.configuration.enabled);
      setPriceMode(data.configuration.defaultPriceMode);
      setRequireEvidence(data.configuration.requireJurisdictionEvidence);
      const next: Record<string, string> = {};
      for (const field of MAPPING_FIELDS) next[field.key] = data.configuration.mappings[field.key]?.id ?? '';
      setMappings(next);
    } else {
      const next: Record<string, string> = {};
      for (const field of MAPPING_FIELDS) {
        const fallback = DEFAULT_CODE_BY_PURPOSE[field.key];
        next[field.key] = fallback ? (data.accounts.find((a) => a.code === fallback && a.active)?.id ?? '') : '';
      }
      setMappings(next);
      setEnabled(false);
    }
    setConfigReviewed(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/tax/setup', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load tax setup.');
      hydrate(j.data as Setup);
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => { load(); }, [load]);

  // Prefill the new-registration form from the company profile when setup loads.
  useEffect(() => {
    if (!setup || editingId) return;
    setRegNumber((prev) => prev || (setup.company.gstNumber ?? ''));
    setProvince((prev) => prev || (setup.company.province ?? ''));
    setValidFrom((prev) => prev || setup.company.fiscalYearStart);
  }, [setup, editingId]);

  const saveConfiguration = async () => {
    setSaving(true); setMessage(null);
    try {
      const body: Record<string, unknown> = {
        enabled, defaultPriceMode: priceMode, requireJurisdictionEvidence: requireEvidence, reviewed: configReviewed,
      };
      for (const field of MAPPING_FIELDS) body[CONFIG_FIELD_BY_PURPOSE[field.key]] = mappings[field.key] || null;
      const r = await fetch('/api/tax/setup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to save configuration.');
      hydrate(j.data as Setup);
      setMessage({ kind: 'success', text: 'Tax configuration saved.' });
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const resetRegistrationForm = () => {
    setEditingId(null); setRegime('gst_hst'); setRegNumber(setup?.company.gstNumber ?? '');
    setProvince(setup?.company.province ?? ''); setFrequency('annual');
    setValidFrom(setup?.company.fiscalYearStart ?? ''); setValidTo(''); setRegActive(true); setRegReviewed(false);
  };

  const editRegistration = (r: Registration) => {
    setEditingId(r.id); setRegime(r.regime); setRegNumber(r.registrationNumber);
    setProvince(r.province ?? ''); setFrequency(r.filingFrequency);
    setValidFrom(r.validFrom); setValidTo(r.validTo ?? ''); setRegActive(r.active); setRegReviewed(false);
  };

  const saveRegistration = async () => {
    setSaving(true); setMessage(null);
    try {
      const body = {
        regime, registrationNumber: regNumber.trim(), province: province || null, method: 'regular',
        filingFrequency: frequency, validFrom, validTo: validTo || null, active: regActive, reviewed: regReviewed,
      };
      const r = await fetch(editingId ? `/api/tax/setup/registrations/${editingId}` : '/api/tax/setup/registrations', {
        method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to save registration.');
      hydrate(j.data.setup as Setup);
      resetRegistrationForm();
      setMessage({ kind: 'success', text: editingId ? 'Registration updated.' : 'Registration added.' });
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const reviewRegistration = async (r: Registration) => {
    setSaving(true); setMessage(null);
    try {
      const res = await fetch(`/api/tax/setup/registrations/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to record review.');
      hydrate(j.data.setup as Setup);
      setMessage({ kind: 'success', text: 'Registration marked reviewed.' });
    } catch (e) {
      setMessage({ kind: 'danger', text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const readOnly = setup ? !setup.canManage : true;

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <button onClick={() => router.push('/settings')} className="flex items-center gap-1 text-sm text-[var(--text-muted)] mb-2">
            <ArrowLeft size={14} /> Back to Settings
          </button>
          <h1 className="greet">Tax Setup</h1>
          <p className="sub">Tax registrations and GL tax accounts for Tax Workpapers and the reviewed tax workflow. Changes are owner/admin only and are audit-logged.</p>
        </div>
      </div>

      {message && <Alert variant={message.kind} className="mb-4">{message.text}</Alert>}
      {loading && <p className="text-sm text-[var(--text-muted)] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading tax setup…</p>}
      {!loading && readOnly && <Alert variant="info" className="mb-4">You can view tax setup, but only an owner or admin can change it.</Alert>}

      {setup && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><h2 className="text-sm font-semibold">Tax Workpapers readiness</h2></CardHeader>
              <CardBody>
                {setup.workpaperReadiness.ready
                  ? <p className="text-sm">Ready — workpapers can be created, prepared and reviewed. GST/HST periods without reviewed postings use the GL simple-path bridge; a period containing reviewed postings uses the reviewed path and requires reviewed tax postings to be enabled.</p>
                  : <ul className="list-disc ml-5 text-sm space-y-1">{setup.workpaperReadiness.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader><h2 className="text-sm font-semibold">Reviewed document posting readiness</h2></CardHeader>
              <CardBody>
                {setup.reviewedPostingReadiness.ready
                  ? <p className="text-sm">Ready — invoices and bills can post through the reviewed tax engine.</p>
                  : <><p className="text-sm text-[var(--text-muted)] mb-2">Separate from workpapers: this also needs approved tax-code versions in the catalogue.</p>
                    <ul className="list-disc ml-5 text-sm space-y-1">{setup.reviewedPostingReadiness.issues.map((i) => <li key={i.code + i.message}>{i.message}</li>)}</ul></>}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Configuration &amp; GL mappings</h2>
                {setup.configuration
                  ? <Badge variant={setup.configuration.configuredAt ? 'paid' : 'pending'}>{setup.configuration.configuredAt ? `Reviewed ${setup.configuration.configuredAt.slice(0, 10)}` : 'Not reviewed'}</Badge>
                  : <Badge variant="draft">Not created</Badge>}
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={enabled} disabled={readOnly} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5" />
                <span><span className="font-medium">Enable reviewed tax postings</span><br />
                <span className="text-[var(--text-muted)]">Controls invoices, bills and bank postings that use reviewed tax treatment. It is not required for GST/HST GL simple-path workpapers. Enabling requires jurisdiction evidence on, a mapped tax rounding account, and the review attestation below (a database rule).</span></span>
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-sm">Default price mode
                  <select value={priceMode} disabled={readOnly} onChange={(e) => setPriceMode(e.target.value)} className="input w-full mt-1">
                    <option value="exclusive">Tax exclusive (amounts exclude tax)</option>
                    <option value="inclusive">Tax inclusive (amounts include tax)</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm pt-6">
                  <input type="checkbox" checked={requireEvidence} disabled={readOnly} onChange={(e) => setRequireEvidence(e.target.checked)} className="mt-0.5" />
                  <span>Require jurisdiction evidence on reviewed postings</span>
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {MAPPING_FIELDS.map((field) => (
                  <label key={field.key} className="block text-sm">{field.label}
                    <select
                      value={mappings[field.key] ?? ''}
                      disabled={readOnly}
                      onChange={(e) => setMappings((old) => ({ ...old, [field.key]: e.target.value }))}
                      className="input w-full mt-1"
                    >
                      <option value="">Not mapped</option>
                      {setup.accounts.filter((a) => a.active && field.types.includes(a.type)).map((a) => (
                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                      ))}
                    </select>
                    <span className="text-xs text-[var(--text-muted)]">{field.hint}</span>
                  </label>
                ))}
              </div>
              {!readOnly && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={configReviewed} onChange={(e) => setConfigReviewed(e.target.checked)} className="mt-0.5" />
                    <span>I reviewed these mappings and settings. Saving without this box checked clears any earlier review stamp.</span>
                  </label>
                  <Button onClick={saveConfiguration} disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save configuration
                  </Button>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><h2 className="text-sm font-semibold">Tax registrations</h2></CardHeader>
            <CardBody className="space-y-3">
              {setup.registrations.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">No registrations yet. Add the company&apos;s GST/HST registration below — the number from the company profile is prefilled when available.</p>
                : setup.registrations.map((r) => (
                  <div key={r.id} className="border border-[var(--border)] rounded-lg p-3 flex flex-wrap items-center gap-3 justify-between">
                    <div>
                      <div className="font-medium text-sm">{REGIMES.find((x) => x.value === r.regime)?.label ?? r.regime} • {r.registrationNumber}</div>
                      <div className="text-sm text-[var(--text-muted)]">
                        {r.province ?? '—'} • {r.filingFrequency} • {r.validFrom} → {r.validTo ?? 'open-ended'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.active ? 'paid' : 'draft'}>{r.active ? 'Active' : 'Inactive'}</Badge>
                      <Badge variant={r.reviewed ? 'paid' : 'pending'}>{r.reviewed ? 'Reviewed' : 'Not reviewed'}</Badge>
                      {!readOnly && !r.reviewed && <Button variant="secondary" onClick={() => reviewRegistration(r)} disabled={saving}>Mark reviewed</Button>}
                      {!readOnly && <Button variant="ghost" onClick={() => editRegistration(r)}>Edit</Button>}
                    </div>
                  </div>
                ))}

              {!readOnly && (
                <div className="border-t border-[var(--border)] pt-4 space-y-3">
                  <h3 className="text-sm font-semibold">{editingId ? 'Edit registration' : 'Add registration'}</h3>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="block text-sm">Regime
                      <select value={regime} onChange={(e) => setRegime(e.target.value)} className="input w-full mt-1">
                        {REGIMES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">Registration number
                      <input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} className="input w-full mt-1" placeholder="123456789 RT0001" />
                    </label>
                    <label className="block text-sm">Province
                      <select value={province} onChange={(e) => setProvince(e.target.value)} className="input w-full mt-1">
                        <option value="">—</option>
                        {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">Filing frequency
                      <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="input w-full mt-1">
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="block text-sm">Valid from
                      <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="input w-full mt-1" />
                    </label>
                    <label className="block text-sm">Valid to (optional)
                      <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="input w-full mt-1" />
                    </label>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">Method is always the regular method — the only method this release supports. The validity range must cover the full workpaper period.</p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={regActive} onChange={(e) => setRegActive(e.target.checked)} /> Active</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={regReviewed} onChange={(e) => setRegReviewed(e.target.checked)} /> I reviewed this registration</label>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveRegistration} disabled={saving || !regNumber.trim() || !validFrom}>
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {editingId ? 'Save registration' : 'Add registration'}
                    </Button>
                    {editingId && <Button variant="ghost" onClick={resetRegistrationForm}>Cancel edit</Button>}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <p className="text-sm text-[var(--text-muted)]">
            Next step: <a href="/reports/tax-workpapers" className="font-semibold underline">Reports → Tax Workpapers</a> to create a period workpaper once readiness above is green.
          </p>
        </div>
      )}
    </AppShell>
  );
}
