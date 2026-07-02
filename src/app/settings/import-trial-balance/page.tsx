'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { cn } from '@/lib/cn';
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface ParsedRow {
  code: string;
  name: string;
  debit: number;
  credit: number;
  matched: boolean;
  existingName: string | null;
  existingType: string | null;
  existingActive: boolean | null;
  type?: string; // set by the user for unmatched rows
}

const ACCOUNT_TYPES = [
  { value: '', label: 'Select type…' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

export default function ImportTrialBalancePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ journalEntryId: string; accountsCreated: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setFileName(file.name);
    setParsing(true);
    setParseError(null);
    setRows(null);
    setImportResult(null);
    try {
      const csvText = await file.text();
      const res = await fetch('/api/import/trial-balance/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to parse file');
      setRows(json.data.rows);
    } catch (err: any) {
      setParseError(err.message || 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  }

  function setRowType(code: string, type: string) {
    setRows((prev) => prev?.map((r) => (r.code === code ? { ...r, type } : r)) ?? null);
  }

  const totalDebit = rows?.reduce((s, r) => s + r.debit, 0) ?? 0;
  const totalCredit = rows?.reduce((s, r) => s + r.credit, 0) ?? 0;
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.02;
  const unmatchedMissingType = rows?.filter((r) => !r.matched && !r.type).length ?? 0;
  const canImport = !!rows?.length && isBalanced && unmatchedMissingType === 0;

  async function handleImport() {
    if (!rows) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/import/trial-balance/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOfDate, rows }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to import');
      setImportResult(json.data);
    } catch (err: any) {
      setImportError(err.message || 'Failed to import');
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/settings')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-strong)]">Import Opening Trial Balance</h1>
            <p className="text-sm text-[var(--text-muted)]">Migrate a trial balance exported from QuickBooks Online or another accounting system.</p>
          </div>
        </div>

        {importResult ? (
          <Card>
            <CardBody>
              <Alert variant="success" className="mb-4">
                Imported. {importResult.accountsCreated > 0 && `Created ${importResult.accountsCreated} new account${importResult.accountsCreated === 1 ? '' : 's'}. `}
                Posted as journal entry {importResult.journalEntryId}.
              </Alert>
              <div className="flex gap-3">
                <Button onClick={() => router.push('/reports/trial-balance')}>View Trial Balance</Button>
                <Button variant="secondary" onClick={() => { setRows(null); setImportResult(null); setFileName(''); }}>Import Another File</Button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader><h2 className="text-sm font-semibold">1. Upload File</h2></CardHeader>
              <CardBody>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  A CSV with an account number/code column, an account name column, and either Debit/Credit columns or a
                  single signed Amount column. This is the standard format QBO, Xero, and CaseWare all export trial
                  balances in.
                </p>
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                    {parsing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose CSV File
                  </Button>
                  {fileName && <span className="text-sm text-[var(--text-muted)]">{fileName}</span>}
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
                </div>
                {parseError && <Alert variant="danger" className="mt-4">{parseError}</Alert>}
              </CardBody>
            </Card>

            {rows && rows.length > 0 && (
              <>
                <Card className="mb-6">
                  <CardHeader>
                    <h2 className="text-sm font-semibold">2. Review &amp; Confirm</h2>
                    <div className="spacer" />
                    <div className={cn(
                      'flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium',
                      isBalanced ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'
                    )}>
                      {isBalanced ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                      {isBalanced ? 'Balanced' : 'Unbalanced'}
                    </div>
                  </CardHeader>
                  <CardBody className="p-0">
                    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-[var(--surface-2)]">
                          <tr className="border-b border-[var(--border)]">
                            <th className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2.5 w-28">Code</th>
                            <th className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2.5">Account</th>
                            <th className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2.5 w-44">Match</th>
                            <th className="text-right text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2.5 w-32">Debit</th>
                            <th className="text-right text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2.5 w-32">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.code} className="border-b border-[var(--border)]">
                              <td className="px-4 py-2 text-sm font-mono text-[var(--text-muted)]">{r.code}</td>
                              <td className="px-4 py-2 text-sm text-[var(--text-strong)]">{r.name}</td>
                              <td className="px-4 py-2 text-sm">
                                {r.matched ? (
                                  <span className="text-[var(--success)]">Matches {r.existingName}{r.existingActive === false ? ' (inactive)' : ''}</span>
                                ) : (
                                  <select
                                    className="select text-xs h-8"
                                    value={r.type || ''}
                                    onChange={(e) => setRowType(r.code, e.target.value)}
                                  >
                                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                )}
                              </td>
                              <td className="px-4 py-2 text-sm font-mono tabular-nums text-right">{r.debit > 0 ? money(r.debit) : '—'}</td>
                              <td className="px-4 py-2 text-sm font-mono tabular-nums text-right">{r.credit > 0 ? money(r.credit) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-2)]">
                            <td colSpan={3} className="px-4 py-3 text-sm font-bold text-right">Totals</td>
                            <td className="px-4 py-3 text-sm font-mono font-bold text-right">{money(totalDebit)}</td>
                            <td className="px-4 py-3 text-sm font-mono font-bold text-right">{money(totalCredit)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader><h2 className="text-sm font-semibold">3. Post as Opening Balances</h2></CardHeader>
                  <CardBody>
                    {!isBalanced && (
                      <Alert variant="danger" className="mb-4">
                        Debits and credits don't match — check the source file. A journal entry can't be posted until this balances.
                      </Alert>
                    )}
                    {unmatchedMissingType > 0 && (
                      <Alert variant="danger" className="mb-4">
                        {unmatchedMissingType} new account{unmatchedMissingType === 1 ? '' : 's'} still need{unmatchedMissingType === 1 ? 's' : ''} a type selected above.
                      </Alert>
                    )}
                    {importError && <Alert variant="danger" className="mb-4">{importError}</Alert>}
                    <div className="flex items-center gap-4">
                      <div className="field">
                        <label>As Of Date</label>
                        <input type="date" className="input" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
                      </div>
                      <div className="flex-1" />
                      <Button onClick={handleImport} disabled={!canImport || importing}>
                        {importing ? <Loader2 size={14} className="animate-spin" /> : null}
                        Post Opening Balances
                      </Button>
                    </div>
                    <p className="text-xs text-[var(--text-faint)] mt-3">
                      This posts one balanced journal entry dated {asOfDate}. New accounts are created active and ready to use immediately.
                    </p>
                  </CardBody>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
