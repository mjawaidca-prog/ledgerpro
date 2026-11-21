'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Loader2, Upload, CheckCircle2, FileJson } from 'lucide-react';

/**
 * The Nexvar Tax write-back card (design §3.4): import a
 * cca-writeback/1 file, see the filed figures and the per-class
 * variance against the register, and approve the proposed
 * Schedule 1 journal. Importing never posts anything — the
 * journal posts only from the Approve button here.
 */
export default function WritebackCard() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch('/api/fixed-assets/writeback')
      .then((r) => r.json())
      .then((json) => setStatus(json.data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function doImport(payloadText: string) {
    setImporting(true);
    setImportError(null);
    setImportNote(null);
    try {
      const res = await fetch('/api/fixed-assets/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: payloadText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      setPasteText('');
      setImportNote(
        json.data.versioned
          ? `Imported as a new version for ${json.data.fiscalYear.label} — the previous filing stays on record, and this one is now the latest.`
          : `Imported for ${json.data.fiscalYear.label}. CCA claimed as filed: ${money(json.data.totalCcaClaimed)}.`
      );
      load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function onFileChosen(file: File) {
    const text = await file.text();
    await doImport(text);
  }

  async function postJournal(recordId: string) {
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/fixed-assets/writeback/${recordId}/post-journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Posting failed');
      load();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Posting failed');
    } finally {
      setPosting(false);
    }
  }

  const latest = status?.latest;
  const records = status?.records || [];

  return (
    <Card className="mb-4">
      <CardHeader>
        <h3 className="font-semibold text-[var(--text-strong)]">Nexvar Tax write-back — filed CCA &amp; UCC</h3>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--text-muted)] mb-4 max-w-[720px]">
              After the T2 is filed in Nexvar Tax, import its <span className="font-mono text-[13px]">cca-writeback/1</span>{' '}
              file here. The register then opens next year from the filed UCC, shows where the filed
              figures differ from its own projection, and proposes the Schedule 1 year-end journal —
              which posts only when you approve it. A second file for the same year is kept as a new
              version; nothing is ever replaced silently.
            </p>

            {importError && (
              <div className="mb-3">
                <Alert variant="danger">{importError}</Alert>
              </div>
            )}
            {importNote && (
              <div className="mb-3">
                <Alert variant="success">{importNote}</Alert>
              </div>
            )}

            <div className="mb-5">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder='Paste a cca-writeback/1 payload here, or choose the file Nexvar Tax produced…'
                className="w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] font-mono text-[var(--text)] outline-none min-h-[84px]"
              />
              <div className="flex items-center gap-3 mt-2">
                <Button onClick={() => doImport(pasteText)} disabled={importing || pasteText.trim() === ''}>
                  {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  Import write-back
                </Button>
                <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
                  <FileJson size={16} /> Choose file
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFileChosen(f);
                    e.target.value = '';
                  }}
                />
                <span className="text-xs text-[var(--text-faint)]">
                  The file is hash-checked and matched to this company and fiscal year before anything is stored.
                </span>
              </div>
            </div>

            {latest && (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="text-sm font-medium text-[var(--text-strong)]">
                    Latest filing on record — {latest.record.fiscalYearLabel}
                  </span>
                  <Badge variant="info">Return {latest.record.returnId}</Badge>
                  {latest.record.confirmationNumber && (
                    <Badge variant="neutral">CRA confirmation {latest.record.confirmationNumber}</Badge>
                  )}
                  <span className="text-xs text-[var(--text-muted)]">
                    Filed {new Date(latest.record.filedAt).toLocaleDateString()} · CCA claimed{' '}
                    {latest.record.totalCcaClaimed != null ? money(latest.record.totalCcaClaimed) : '—'}
                  </span>
                </div>

                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                        <th className="py-2 pr-4 font-medium">Class</th>
                        <th className="py-2 pr-4 font-medium text-right">CCA claimed (filed)</th>
                        <th className="py-2 pr-4 font-medium text-right">Closing UCC (filed)</th>
                        <th className="py-2 pr-4 font-medium text-right">Closing UCC (register projection)</th>
                        <th className="py-2 font-medium text-right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.variance.map((v: any) => (
                        <tr key={v.ccaClass} className="border-b border-[var(--border)] last:border-0 align-top">
                          <td className="py-2 pr-4">Class {v.ccaClass}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(v.filedClaim)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">{money(v.filedClosingUcc)}</td>
                          <td className="py-2 pr-4 text-right font-mono tabular-nums">
                            {v.expectedClosingUcc != null ? money(v.expectedClosingUcc) : '—'}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {v.difference != null ? money(v.difference) : '—'}
                            <div className="font-sans text-xs text-[var(--text-muted)] mt-1 max-w-[340px] ml-auto text-left">
                              {v.causeText}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-[var(--border)] pt-4">
                  <h4 className="text-sm font-medium text-[var(--text-strong)] mb-2">
                    Proposed Schedule 1 journal — {latest.record.fiscalYearLabel}
                  </h4>
                  {postError && (
                    <div className="mb-3">
                      <Alert variant="danger">{postError}</Alert>
                    </div>
                  )}
                  {latest.journal.noSchedule1Lines ? (
                    <p className="text-sm text-[var(--text-muted)]">
                      This write-back carries no Schedule 1 adjustment lines, so no journal is proposed.
                      The filed CCA and UCC figures above are still on record and feed next year&rsquo;s export.
                    </p>
                  ) : latest.journal.status === 'posted' ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <CheckCircle2 size={16} /> The Schedule 1 journal for this filing is posted. Correct
                      it with a manual journal if needed.
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto mb-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                              <th className="py-2 pr-4 font-medium">Account</th>
                              <th className="py-2 pr-4 font-medium">Description</th>
                              <th className="py-2 pr-4 font-medium text-right">Debit</th>
                              <th className="py-2 font-medium text-right">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {latest.journal.lines.map((l: any, i: number) => (
                              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                                <td className="py-2 pr-4 font-mono text-[13px]">{l.glAccountCode}</td>
                                <td className="py-2 pr-4">{l.description}</td>
                                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                                  {l.debit > 0 ? money(l.debit) : '—'}
                                </td>
                                <td className="py-2 text-right font-mono tabular-nums">
                                  {l.credit > 0 ? money(l.credit) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {latest.journal.blockedReason ? (
                        <Alert variant="warning">{latest.journal.blockedReason}</Alert>
                      ) : (
                        <div className="flex items-center gap-3">
                          <Button onClick={() => postJournal(latest.record.id)} disabled={posting}>
                            {posting ? <Loader2 size={16} className="animate-spin" /> : null}
                            Approve &amp; post journal
                          </Button>
                          <span className="text-xs text-[var(--text-faint)]">
                            Dated {latest.record.fiscalYearEnd}. Nothing from a write-back posts without
                            this approval.
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {records.length > 0 && (
              <div className="border-t border-[var(--border)] mt-4 pt-3">
                <div className="text-xs text-[var(--text-muted)]">
                  {records.map((r: any) => (
                    <div key={r.id} className="flex flex-wrap gap-2 items-center py-1">
                      <span className="font-medium text-[var(--text)]">{r.fiscalYearLabel}</span>
                      <span>return {r.returnId}</span>
                      <span>imported {new Date(r.importedAt).toLocaleDateString()}</span>
                      {r.isLatest ? <Badge variant="paid">Latest</Badge> : <Badge variant="draft">Superseded</Badge>}
                      <Badge variant="neutral">Journal: {r.journalStatus}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
