'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { money, moneySigned } from '@/lib/money';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';

const selectClass =
  'font-sans text-base text-[var(--text-strong)] bg-[var(--surface)] border border-[var(--border-strong)] rounded-md h-[var(--control-h)] px-3 w-full focus:outline-none focus:border-[var(--border-focus)]';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="text-sm text-[var(--text-strong)]">{children}</div>
    </div>
  );
}

export default function FixedAssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [asset, setAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disposalForm, setDisposalForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    proceeds: '',
    reason: 'sold',
    notes: '',
  });
  const [savingDisposal, setSavingDisposal] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/fixed-assets/${id}`)
      .then((r) => r.json())
      .then((json) => setAsset(json.data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function recordDisposal(e: React.FormEvent) {
    e.preventDefault();
    setSavingDisposal(true);
    setError(null);
    try {
      const res = await fetch(`/api/fixed-assets/${id}/disposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: disposalForm.date,
          proceeds: parseFloat(disposalForm.proceeds) || 0,
          reason: disposalForm.reason,
          notes: disposalForm.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not record the disposal');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the disposal');
    } finally {
      setSavingDisposal(false);
    }
  }

  async function removeDisposal() {
    if (!confirm('Remove the recorded disposal? The asset returns to in-service.')) return;
    await fetch(`/api/fixed-assets/${id}/disposal`, { method: 'DELETE' });
    load();
  }

  async function deleteAsset() {
    if (!confirm(`Delete "${asset.description}" from the register? This cannot be undone.`)) return;
    const res = await fetch(`/api/fixed-assets/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/fixed-assets');
    else {
      const json = await res.json().catch(() => ({}));
      setError(json.error || 'Could not delete the asset');
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }
  if (!asset) {
    return (
      <AppShell>
        <Alert variant="danger">Asset not found.</Alert>
      </AppShell>
    );
  }

  const schedule: any[] = asset.schedule || [];
  const disposalRow = schedule.find((r) => r.disposal);

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
          <h1 className="greet">{asset.description}</h1>
          <p className="sub">{asset.classLabel}</p>
        </div>
        <div className="spacer" />
        {asset.disposal ? (
          <Badge variant="neutral">Disposed {asset.disposal.date}</Badge>
        ) : (
          <Badge variant="info">In service</Badge>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="danger">{error}</Alert>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader>
          <h3 className="font-semibold text-[var(--text-strong)]">Facts</h3>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-4 gap-4">
            <Fact label="Gross cost">{money(asset.grossCost)}</Fact>
            <Fact label="ITC claimed">{money(asset.itcClaimed)}</Fact>
            <Fact label="Government assistance">{money(asset.governmentAssistance)}</Fact>
            <Fact label="Capital cost (net)">{money(asset.capitalCost)}</Fact>
            <Fact label="Acquired">{asset.acquisitionDate}</Fact>
            <Fact label="Available for use">{asset.availableForUseDate}</Fact>
            <Fact label="AIIP">{asset.aiip ? 'Yes' : 'No'}</Fact>
            <Fact label="Would-be Class 53">{asset.wouldBeClass53 ? 'Yes' : 'No'}</Fact>
            <Fact label="Vendor">{asset.vendor || '—'}</Fact>
            <Fact label="Invoice ref">{asset.invoiceRef || '—'}</Fact>
            <Fact label="Serial / VIN">{asset.serialNumber || '—'}</Fact>
            <Fact label="Location">{asset.location || '—'}</Fact>
            <Fact label="Book policy">
              {asset.bookMethod === 'mirror_tax' && 'Mirror tax (CCA shape)'}
              {asset.bookMethod === 'straight_line' && `Straight-line over ${asset.bookLifeYears ?? '—'} years`}
              {asset.bookMethod === 'declining_balance' && `Declining balance at ${asset.bookRatePct ?? '—'}%`}
              {asset.bookMethod === 'none' && 'No book depreciation'}
            </Fact>
            <Fact label="Accum. book depreciation">{money(asset.position.accumulatedBookDep)}</Fact>
            <Fact label="Net book value">{money(asset.position.netBookValue)}</Fact>
            <Fact label="Asset GL account">{asset.assetAccountCode || '—'}</Fact>
          </div>
          {asset.notes && <p className="text-sm text-[var(--text-muted)] mt-3">{asset.notes}</p>}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <h3 className="font-semibold text-[var(--text-strong)]">Book depreciation schedule</h3>
        </CardHeader>
        <CardBody>
          {schedule.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No depreciation years yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="py-2 pr-4 font-medium">Fiscal year</th>
                    <th className="py-2 pr-4 font-medium text-right">Opening NBV</th>
                    <th className="py-2 pr-4 font-medium text-right">Depreciation</th>
                    <th className="py-2 pr-4 font-medium text-right">Closing NBV</th>
                    <th className="py-2 font-medium text-right">Accumulated</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={r.label} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 pr-4">
                        {r.label}
                        <span className="text-[var(--text-faint)]"> · {r.start} → {r.end}</span>
                        {r.disposal && (
                          <span className="block text-xs text-[var(--text-muted)]">
                            Disposed {r.disposal.date} for {money(r.disposal.proceeds)} — book gain/loss{' '}
                            {moneySigned(r.disposal.gainLoss)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(r.openingNbv)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(r.depreciation)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(r.closingNbv)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{money(r.accumulatedDep)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-[var(--text-faint)] mt-2">
            Book depreciation only — the CCA deduction is computed in Nexvar Tax from these facts. No
            depreciation is taken in the year of disposal; the book gain/loss is proceeds minus net book
            value.
          </p>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <h3 className="font-semibold text-[var(--text-strong)]">Disposal</h3>
        </CardHeader>
        <CardBody>
          {asset.disposal ? (
            <>
              <div className="grid grid-cols-4 gap-4 mb-3">
                <Fact label="Date">{asset.disposal.date}</Fact>
                <Fact label="Proceeds">{money(asset.disposal.proceeds)}</Fact>
                <Fact label="Reason">
                  {asset.disposal.reason === 'sold' && 'Sold'}
                  {asset.disposal.reason === 'scrapped' && 'Scrapped'}
                  {asset.disposal.reason === 'shareholder_taken' && 'Taken by shareholder'}
                  {asset.disposal.reason === 'traded_in' && 'Traded in'}
                  {asset.disposal.reason === 'other' && 'Other'}
                </Fact>
                <Fact label="Book gain/loss">
                  {disposalRow ? moneySigned(disposalRow.disposal.gainLoss) : '—'}
                </Fact>
              </div>
              {asset.disposal.reason === 'shareholder_taken' && (
                <div className="mb-3">
                  <Alert variant="warning">
                    An asset taken by the shareholder is disposed of at fair market value for tax
                    purposes — the proceeds recorded here should be the FMV, and a shareholder benefit
                    may need to be considered. Recapture or terminal loss is computed in Nexvar Tax
                    from the class pool.
                  </Alert>
                </div>
              )}
              <Button variant="ghost" onClick={removeDisposal}>
                Remove disposal
              </Button>
            </>
          ) : (
            <form onSubmit={recordDisposal} className="grid grid-cols-4 gap-4 items-end">
              <label className="block">
                <span className="block text-sm font-medium text-[var(--text-strong)] mb-1">Date</span>
                <Input
                  type="date"
                  value={disposalForm.date}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-[var(--text-strong)] mb-1">Proceeds</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={disposalForm.proceeds}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, proceeds: e.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-[var(--text-strong)] mb-1">Reason</span>
                <select
                  className={selectClass}
                  value={disposalForm.reason}
                  onChange={(e) => setDisposalForm((f) => ({ ...f, reason: e.target.value }))}
                >
                  <option value="sold">Sold</option>
                  <option value="scrapped">Scrapped</option>
                  <option value="shareholder_taken">Taken by shareholder</option>
                  <option value="traded_in">Traded in</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <Button type="submit" disabled={savingDisposal}>
                {savingDisposal ? <Loader2 size={16} className="animate-spin" /> : null} Record disposal
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      <Button variant="destructive" onClick={deleteAsset}>
        <Trash2 size={14} /> Delete asset
      </Button>
    </AppShell>
  );
}
