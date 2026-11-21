'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Plus, Loader2, Download, CheckCircle2 } from 'lucide-react';
import WritebackCard from './WritebackCard';

export default function FixedAssetsPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/fixed-assets').then((r) => r.json()),
      fetch('/api/fixed-assets/depreciation').then((r) => r.json()),
    ])
      .then(([assetsJson, previewJson]) => {
        setData(assetsJson.data || null);
        setPreview(previewJson.data || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function postDepreciation() {
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch('/api/fixed-assets/depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Posting failed');
      setPosted(true);
      load();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed');
    } finally {
      setPosting(false);
    }
  }

  const assets = data?.assets || [];
  const continuity = data?.continuity || [];
  const fy = data?.fiscalYear;

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Fixed Assets</h1>
          <p className="sub">
            The CCA register: every capital asset with its tax facts captured at purchase — cost net of
            ITCs, CCA class, available-for-use date — ready to feed Schedule 8 in Nexvar Tax. Book
            depreciation is computed here; the CCA deduction itself is computed in Nexvar Tax.
          </p>
        </div>
        <div className="spacer" />
        <a href="/api/reports/cca-register" className="mr-2">
          <Button variant="secondary">
            <Download size={16} /> Export cca-register/1
          </Button>
        </a>
        <Button onClick={() => router.push('/fixed-assets/new')}>
          <Plus size={16} /> New Asset
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : (
        <>
          {continuity.length > 0 && fy && (
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">
                  Capital cost continuity by CCA class — {fy.label} ({fy.start} → {fy.end})
                </h3>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="py-2 pr-4 font-medium">Class</th>
                        <th className="py-2 pr-4 font-medium text-right">Opening cost</th>
                        <th className="py-2 pr-4 font-medium text-right">Additions</th>
                        <th className="py-2 pr-4 font-medium text-right">Disposals (cost)</th>
                        <th className="py-2 pr-4 font-medium text-right">Closing cost</th>
                        <th className="py-2 pr-4 font-medium text-right">Book depreciation</th>
                        <th className="py-2 font-medium text-right">Net book value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {continuity.map((c: any) => (
                        <tr key={c.ccaClass} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-2 pr-4">{c.label}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(c.openingCost)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(c.additionsCost)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(c.disposalsCost)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(c.closingCost)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(c.bookDepreciation)}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{money(c.netBookValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-[var(--text-faint)] mt-2">
                  Continuity is reported per class because CCA pools are per class. UCC continuity is
                  computed in Nexvar Tax from the exported facts.
                </p>
              </CardBody>
            </Card>
          )}

          {preview && (
            <Card className="mb-4">
              <CardHeader>
                <h3 className="font-semibold text-[var(--text-strong)]">
                  Book depreciation — {preview.fiscalYear.label}
                </h3>
              </CardHeader>
              <CardBody>
                {postError && (
                  <div className="mb-3">
                    <Alert variant="danger">{postError}</Alert>
                  </div>
                )}
                {preview.alreadyPostedJournalId || posted ? (
                  <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <CheckCircle2 size={16} /> Book depreciation for {preview.fiscalYear.label} is
                    posted ({money(preview.total)}). A year is recorded once — correct it with a
                    manual journal if needed.
                  </p>
                ) : preview.total > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-6 mb-3">
                      {preview.lines.map((l: any) => (
                        <div key={l.assetId}>
                          <div className="text-xs text-[var(--text-muted)]">
                            {l.description} · Class {l.ccaClass}
                          </div>
                          <div className="font-mono tabular-nums text-lg">{money(l.amount)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button onClick={postDepreciation} disabled={posting}>
                        {posting ? <Loader2 size={16} className="animate-spin" /> : null}
                        Post {money(preview.total)} to the ledger
                      </Button>
                      <span className="text-xs text-[var(--text-faint)]">
                        One journal: Dr depreciation expense / Cr accumulated depreciation, dated{' '}
                        {preview.fiscalYear.end}. Nothing posts until you approve it here.
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">
                    No book depreciation computed for {preview.fiscalYear.label} yet.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <WritebackCard />

          {assets.length === 0 ? (
            <Card>
              <CardBody>
                <div className="py-12 text-center">
                  <p className="text-sm text-[var(--text-muted)] mb-4">
                    No assets yet. Add a vehicle, machine or computer when it is purchased and its tax
                    facts are captured once — cost net of ITCs, CCA class, available-for-use date —
                    instead of being chased at year-end.
                  </p>
                  <Button onClick={() => router.push('/fixed-assets/new')}>
                    <Plus size={14} /> Add your first asset
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {assets.map((a: any) => (
                <Card key={a.id} className="cursor-pointer" >
                  <CardHeader>
                    <div className="flex items-center justify-between w-full">
                      <div onClick={() => router.push(`/fixed-assets/${a.id}`)}>
                        <div className="font-semibold text-[var(--text-strong)]">{a.description}</div>
                        <div className="text-xs text-[var(--text-muted)]">{a.classLabel}</div>
                      </div>
                      {a.disposal ? (
                        <Badge variant="neutral">Disposed {a.disposal.date}</Badge>
                      ) : (
                        <Badge variant="info">In service</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="grid grid-cols-3 gap-4 text-sm" onClick={() => router.push(`/fixed-assets/${a.id}`)}>
                      <div>
                        <div className="text-xs text-[var(--text-muted)]">Capital cost (net of ITCs)</div>
                        <div className="font-mono tabular-nums">{money(a.capitalCost)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--text-muted)]">Accum. book depreciation</div>
                        <div className="font-mono tabular-nums">{money(a.position.accumulatedBookDep)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--text-muted)]">Net book value</div>
                        <div className="font-mono tabular-nums">{money(a.position.netBookValue)}</div>
                      </div>
                    </div>
                    <p className="text-xs text-[var(--text-faint)] mt-2">
                      Available for use {a.availableForUseDate}
                      {a.aiip ? ' · AIIP' : ''}
                      {a.wouldBeClass53 ? ' · would-be Class 53' : ''}
                      {a.luxuryVehicle ? ' · luxury vehicle (Class 10.1)' : ''}
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
