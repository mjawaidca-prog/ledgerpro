'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { CCA_CLASS_CODES, CCA_CLASSES } from '@/lib/cca/classes';
import { money } from '@/lib/money';

const selectClass =
  'font-sans text-base text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] rounded-md h-[var(--control-h)] px-3 w-full focus:outline-none focus:border-[var(--border-focus)]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text-strong)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-faint)] mt-1">{hint}</span>}
    </label>
  );
}

export default function NewFixedAssetPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    description: '',
    vendor: '',
    invoiceRef: '',
    serialNumber: '',
    location: '',
    ccaClass: '8',
    grossCost: '',
    itcClaimed: '',
    governmentAssistance: '',
    acquisitionDate: today,
    availableForUseDate: today,
    aiip: '',
    wouldBeClass53: false,
    luxuryVehicle: false,
    assetAccountCode: '',
    bookMethod: 'mirror_tax',
    bookRatePct: '',
    bookLifeYears: '',
    openingAccumDep: '',
    openingAccumThrough: '',
    notes: '',
  });
  const set =
    (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const setCheck =
    (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.checked }));

  useEffect(() => {
    fetch('/api/coa')
      .then((r) => r.json())
      .then((json) => setAccounts(Array.isArray(json.data) ? json.data : []))
      .catch(() => {});
  }, []);

  const gross = parseFloat(form.grossCost) || 0;
  const itc = parseFloat(form.itcClaimed) || 0;
  const assistance = parseFloat(form.governmentAssistance) || 0;
  const capitalCost = gross - itc - assistance;
  const isClass43 = form.ccaClass === '43';
  const classInfo = CCA_CLASSES[form.ccaClass];
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.active !== false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description,
          vendor: form.vendor || null,
          invoiceRef: form.invoiceRef || null,
          serialNumber: form.serialNumber || null,
          location: form.location || null,
          ccaClass: form.ccaClass,
          grossCost: gross,
          itcClaimed: itc,
          governmentAssistance: assistance,
          acquisitionDate: form.acquisitionDate,
          availableForUseDate: form.availableForUseDate,
          aiip: form.aiip === '' ? undefined : form.aiip === 'yes',
          wouldBeClass53: isClass43 ? form.wouldBeClass53 : false,
          luxuryVehicle: form.luxuryVehicle,
          assetAccountCode: form.assetAccountCode || null,
          bookMethod: form.bookMethod,
          bookRatePct: form.bookRatePct === '' ? null : parseFloat(form.bookRatePct),
          bookLifeYears: form.bookLifeYears === '' ? null : parseInt(form.bookLifeYears, 10),
          openingAccumDep: form.openingAccumDep === '' ? 0 : parseFloat(form.openingAccumDep),
          openingAccumThrough: form.openingAccumThrough || null,
          notes: form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const details = json.details
          ? Object.values(json.details).flat().join(' ')
          : json.error || 'Could not save the asset';
        throw new Error(details);
      }
      router.push(`/fixed-assets/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the asset');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <button
            onClick={() => router.push('/fixed-assets')}
            className="flex items-center gap-1 text-sm text-[var(--text-muted)] mb-1"
          >
            <ArrowLeft size={14} /> Fixed Assets
          </button>
          <h1 className="greet">New Asset</h1>
          <p className="sub">
            Capture the tax facts now, at purchase — they are what Schedule 8 needs, and they cannot be
            reconstructed as reliably at year-end.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4">
            <Alert variant="danger">{error}</Alert>
          </div>
        )}

        <Card className="mb-4">
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">The asset</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Description">
                <Input value={form.description} onChange={set('description')} required placeholder="e.g. 2023 Ford F-150" />
              </Field>
              <Field label="Vendor">
                <Input value={form.vendor} onChange={set('vendor')} placeholder="Who it was bought from" />
              </Field>
              <Field label="Invoice reference">
                <Input value={form.invoiceRef} onChange={set('invoiceRef')} />
              </Field>
              <Field label="Serial number / VIN">
                <Input value={form.serialNumber} onChange={set('serialNumber')} />
              </Field>
              <Field label="Location">
                <Input value={form.location} onChange={set('location')} />
              </Field>
              <Field label="Asset GL account" hint="The fixed-asset account the cost sits in. The register creates the accumulated depreciation and depreciation expense accounts for you.">
                <select className={selectClass} value={form.assetAccountCode} onChange={set('assetAccountCode')}>
                  <option value="">— Not mapped yet —</option>
                  {assetAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">Tax facts (for CCA / Schedule 8)</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="CCA class" hint="The classes Nexvar Tax models — pick the one the asset belongs to.">
                <select className={selectClass} value={form.ccaClass} onChange={set('ccaClass')}>
                  {CCA_CLASS_CODES.map((code) => (
                    <option key={code} value={code}>
                      {CCA_CLASSES[code].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Gross cost" hint="The full invoice amount, including any GST/HST paid.">
                <Input type="number" step="0.01" min="0" value={form.grossCost} onChange={set('grossCost')} required />
              </Field>
              <Field
                label="Less: GST/HST ITC claimed"
                hint="Capital cost for CCA is NET of ITCs — the export carries the net figure, so enter the ITC claimed on this purchase here."
              >
                <Input type="number" step="0.01" min="0" value={form.itcClaimed} onChange={set('itcClaimed')} />
              </Field>
              <Field label="Less: government assistance" hint="Grants or assistance received toward this purchase also reduce the capital cost.">
                <Input type="number" step="0.01" min="0" value={form.governmentAssistance} onChange={set('governmentAssistance')} />
              </Field>
              <div className="col-span-2 text-sm">
                <span className="text-[var(--text-muted)]">Capital cost (net): </span>
                <span className="font-mono tabular-nums font-semibold text-[var(--text-strong)]">
                  {money(Math.max(capitalCost, 0))}
                </span>
                {capitalCost < 0 && (
                  <span className="text-[var(--danger)] ml-2">
                    ITCs plus assistance cannot exceed the gross cost.
                  </span>
                )}
              </div>
              <Field label="Date acquired">
                <Input type="date" value={form.acquisitionDate} onChange={set('acquisitionDate')} required />
              </Field>
              <Field
                label="Available-for-use date"
                hint="CCA cannot be claimed before the asset is available for use. Defaults to the acquisition date."
              >
                <Input type="date" value={form.availableForUseDate} onChange={set('availableForUseDate')} required />
              </Field>
              <Field
                label="Accelerated Investment Incentive Property (AIIP)"
                hint="Leave on Auto to apply the date rule (acquired after Nov 20, 2018 and available for use before 2028)."
              >
                <select className={selectClass} value={form.aiip} onChange={set('aiip')}>
                  <option value="">Auto (by acquisition date)</option>
                  <option value="yes">Yes — AIIP</option>
                  <option value="no">No</option>
                </select>
              </Field>
              {isClass43 && (
                <Field
                  label="Would-be Class 53"
                  hint="This Class 43 asset would have been Class 53 if acquired in 2025 — the flag Nexvar Tax needs for its first-year factors."
                >
                  <label className="flex items-center gap-2 h-[var(--control-h)]">
                    <input type="checkbox" checked={form.wouldBeClass53} onChange={setCheck('wouldBeClass53')} />
                    <span className="text-sm">Would-be Class 53</span>
                  </label>
                </Field>
              )}
              <Field label="Luxury passenger vehicle" hint="A passenger vehicle over the CRA cost cap belongs in its own Class 10.1.">
                <label className="flex items-center gap-2 h-[var(--control-h)]">
                  <input type="checkbox" checked={form.luxuryVehicle} onChange={setCheck('luxuryVehicle')} />
                  <span className="text-sm">Luxury vehicle (cost cap applies)</span>
                </label>
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <h3 className="font-semibold text-[var(--text-strong)]">Book depreciation</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Book policy"
                hint="Default: mirror the tax shape (class rate, declining balance, half-year/AIIP first year) so the Schedule 1 difference stays small. Book depreciation is not the CCA deduction — Nexvar Tax computes that."
              >
                <select className={selectClass} value={form.bookMethod} onChange={set('bookMethod')}>
                  <option value="mirror_tax">Mirror tax (CCA shape) — default</option>
                  <option value="straight_line">Straight-line over a life</option>
                  <option value="declining_balance">Declining balance at a book rate</option>
                  <option value="none">No book depreciation</option>
                </select>
              </Field>
              {form.bookMethod === 'declining_balance' && (
                <Field label="Book rate (%)">
                  <Input type="number" step="0.01" min="0" max="100" value={form.bookRatePct} onChange={set('bookRatePct')} required />
                </Field>
              )}
              {(form.bookMethod === 'straight_line' ||
                (form.bookMethod === 'mirror_tax' && classInfo.method === 'SL' && classInfo.ratePct == null)) && (
                <Field label="Life / lease term (years)">
                  <Input type="number" step="1" min="1" max="100" value={form.bookLifeYears} onChange={set('bookLifeYears')} required />
                </Field>
              )}
              <Field
                label="Opening accumulated depreciation"
                hint="Only when adopting the register mid-life: book depreciation already recorded in the GL for this asset."
              >
                <Input type="number" step="0.01" min="0" value={form.openingAccumDep} onChange={set('openingAccumDep')} />
              </Field>
              {form.openingAccumDep !== '' && parseFloat(form.openingAccumDep) > 0 && (
                <Field label="Opening depreciation recorded through">
                  <Input type="date" value={form.openingAccumThrough} onChange={set('openingAccumThrough')} />
                </Field>
              )}
              <Field label="Notes">
                <Input value={form.notes} onChange={set('notes')} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Save asset
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/fixed-assets')}>
            Cancel
          </Button>
        </div>
      </form>
    </AppShell>
  );
}
