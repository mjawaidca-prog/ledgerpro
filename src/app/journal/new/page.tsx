'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Trash2, CheckCircle2, AlertTriangle, Loader2, Search, X } from 'lucide-react';

interface JournalLine {
  id: string;
  glAccountCode: string;
  glAccountName: string;
  description: string;
  debit: number;
  credit: number;
}

interface COAItem {
  code: string;
  name: string;
  type: string;
  detailType: string | null;
}

export default function NewJournalEntryPage() {
  const router = useRouter();

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([
    { id: '1', glAccountCode: '', glAccountName: '', description: '', debit: 0, credit: 0 },
    { id: '2', glAccountCode: '', glAccountName: '', description: '', debit: 0, credit: 0 },
  ]);
  const [coa, setCoa] = useState<COAItem[]>([]);
  const [coaLoading, setCoaLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [accountSearch, setAccountSearch] = useState<Record<string, string>>({});
  const [accountDropdown, setAccountDropdown] = useState<string | null>(null);

  // Fetch COA
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/coa');
        const json = await res.json();
        setCoa(json.data || []);
      } catch { /* ignore */ } finally { setCoaLoading(false); }
    }
    load();
  }, []);

  function filteredAccounts(query: string): COAItem[] {
    if (!query) return coa.slice(0, 20);
    const q = query.toLowerCase();
    return coa.filter(
      (a) => a.code.includes(q) || a.name.toLowerCase().includes(q)
    ).slice(0, 20);
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { id: String(Date.now()), glAccountCode: '', glAccountName: '', description: '', debit: 0, credit: 0 },
    ]);
  }

  function removeLine(id: string) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function updateLine(id: string, field: keyof JournalLine, value: string | number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;

        if (field === 'glAccountCode') {
          const acct = coa.find((a) => a.code === value);
          return { ...l, glAccountCode: value as string, glAccountName: acct?.name || '' };
        }

        // Auto-clear opposite field
        if (field === 'debit' && Number(value) > 0) {
          return { ...l, debit: Number(value), credit: 0 };
        }
        if (field === 'credit' && Number(value) > 0) {
          return { ...l, credit: Number(value), debit: 0 };
        }

        return { ...l, [field]: value };
      })
    );
  }

  const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
  const diff = Math.abs(totalDebits - totalCredits);
  const isBalanced = diff < 0.005 && (totalDebits > 0 || totalCredits > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }
    if (!isBalanced) {
      setError(`Journal entry is not balanced. Difference: ${money(diff)}`);
      return;
    }

    const emptyLines = lines.filter((l) => !l.glAccountCode);
    if (emptyLines.length > 0) {
      setError('All lines must have a GL account selected.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryDate,
          description,
          lines: lines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description || undefined,
            debit: l.debit,
            credit: l.credit,
          })),
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to post');
      }

      setSuccess(true);
      setTimeout(() => router.push('/journal'), 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const typeColors: Record<string, string> = {
    asset: 'text-[var(--primary)]', liability: 'text-[var(--warning)]',
    equity: 'text-[var(--success)]', income: 'text-[var(--success)]',
    expense: 'text-[var(--danger)]',
  };

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">New Journal Entry</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Create a manual adjusting entry. Debits must equal credits.
            </p>
          </div>
        </div>

        {success && (
          <Alert variant="success" className="mb-4">
            <CheckCircle2 size={16} /> Journal entry posted successfully. Redirecting...
          </Alert>
        )}

        {error && (
          <Alert variant="danger" className="mb-4">
            <AlertTriangle size={16} /> {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          {/* Header fields */}
          <Card className="mb-4">
            <CardBody className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">
                    Entry Date
                  </label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--primary-soft)] outline-none"
                    required
                  />
                </div>
                <div className="col-span-1" />
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Monthly depreciation, Year-end adjustment, Correction entry..."
                    className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 bg-[var(--surface)] text-sm text-[var(--text)] focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--primary-soft)] outline-none"
                    required
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Line items */}
          <Card className="mb-4">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <h2 className="text-sm font-semibold text-[var(--text-strong)]">Lines</h2>
                <span className="text-xs text-[var(--text-muted)]">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                      <th className="text-left text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5 w-[180px]">Account</th>
                      <th className="text-left text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5">Description</th>
                      <th className="text-right text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5 w-[140px]">Debit</th>
                      <th className="text-right text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5 w-[140px]">Credit</th>
                      <th className="w-10 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={line.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                        {/* Account selector */}
                        <td className="px-4 py-2 relative">
                          <button
                            type="button"
                            onClick={() => setAccountDropdown(accountDropdown === line.id ? null : line.id)}
                            className={cn(
                              'w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-1',
                              line.glAccountCode
                                ? 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-strong)]'
                                : 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                            )}
                          >
                            <span className="truncate">
                              {line.glAccountCode ? `${line.glAccountCode} — ${line.glAccountName}` : 'Select account...'}
                            </span>
                            <Search size={14} className="text-[var(--text-faint)] shrink-0" />
                          </button>
                          {accountDropdown === line.id && (
                            <div className="absolute z-50 left-4 right-4 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] max-h-[240px] overflow-y-auto">
                              <input
                                type="text"
                                placeholder="Search by code or name..."
                                autoFocus
                                className="w-full border-0 border-b border-[var(--border)] px-3 py-2 text-sm bg-transparent outline-none sticky top-0 bg-[var(--surface)]"
                                value={accountSearch[line.id] || ''}
                                onChange={(e) => setAccountSearch({ ...accountSearch, [line.id]: e.target.value })}
                              />
                              {filteredAccounts(accountSearch[line.id] || '').map((acct) => (
                                <button
                                  key={acct.code}
                                  type="button"
                                  onClick={() => {
                                    updateLine(line.id, 'glAccountCode', acct.code);
                                    setAccountDropdown(null);
                                    setAccountSearch({ ...accountSearch, [line.id]: '' });
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--primary-soft)] transition-colors flex items-center justify-between"
                                >
                                  <div>
                                    <span className="font-mono text-xs text-[var(--text-muted)] mr-2">{acct.code}</span>
                                    <span className="text-[var(--text)]">{acct.name}</span>
                                  </div>
                                  <span className={cn('text-micro uppercase font-semibold', typeColors[acct.type] || '')}>{acct.type}</span>
                                </button>
                              ))}
                              {filteredAccounts(accountSearch[line.id] || '').length === 0 && (
                                <div className="px-3 py-4 text-xs text-[var(--text-faint)] text-center">No accounts found</div>
                              )}
                            </div>
                          )}
                        </td>
                        {/* Description */}
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={line.description}
                            onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                            placeholder="Line description (optional)"
                            className="w-full border border-transparent hover:border-[var(--border)] focus:border-[var(--border-focus)] rounded-md px-2 py-1.5 text-sm bg-transparent outline-none transition-colors"
                          />
                        </td>
                        {/* Debit */}
                        <td className="px-4 py-2">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-faint)]">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.debit || ''}
                              onChange={(e) => updateLine(line.id, 'debit', parseFloat(e.target.value) || 0)}
                              className="w-full text-right font-mono text-sm border border-[var(--border)] rounded-md px-3 py-1.5 pl-6 bg-[var(--surface)] focus:border-[var(--border-focus)] outline-none"
                              placeholder="0.00"
                            />
                          </div>
                        </td>
                        {/* Credit */}
                        <td className="px-4 py-2">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-faint)]">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.credit || ''}
                              onChange={(e) => updateLine(line.id, 'credit', parseFloat(e.target.value) || 0)}
                              className="w-full text-right font-mono text-sm border border-[var(--border)] rounded-md px-3 py-1.5 pl-6 bg-[var(--surface)] focus:border-[var(--border-focus)] outline-none"
                              placeholder="0.00"
                            />
                          </div>
                        </td>
                        {/* Remove */}
                        <td className="px-2">
                          {lines.length > 2 && (
                            <button type="button" onClick={() => removeLine(line.id)} className="p-1.5 rounded-md hover:bg-[var(--danger-soft)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-2)]">
                      <td colSpan={2} className="px-4 py-3">
                        <button type="button" onClick={addLine} className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)] transition-colors">
                          <Plus size={14} /> Add Line
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-[var(--text-strong)]">
                        {money(totalDebits)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-[var(--text-strong)]">
                        {money(totalCredits)}
                      </td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={2} className="px-4 py-2 text-right text-sm font-medium text-[var(--text-muted)]">
                        Difference
                      </td>
                      <td colSpan={2} className={cn(
                        'px-4 py-2 text-right font-mono text-sm font-bold tabular-nums',
                        isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                      )}>
                        {isBalanced ? (
                          <span className="flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Balanced</span>
                        ) : (
                          <span>{money(diff)}</span>
                        )}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* Submit */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-faint)]">
              This will create a manual journal entry and update GL account balances immediately.
            </p>
            <Button type="submit" disabled={submitting || !isBalanced}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Post Journal Entry
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
