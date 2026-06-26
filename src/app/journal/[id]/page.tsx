'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Trash2, Save, Edit3, X, CheckCircle2, AlertTriangle, Loader2, Plus, Search } from 'lucide-react';

interface LineItem {
  id: string;
  glAccountCode: string;
  accountName: string;
  accountType: string;
  description: string | null;
  debit: number;
  credit: number;
}

interface JournalDetail {
  id: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  lines: LineItem[];
  totalDebits: number;
  totalCredits: number;
  createdAt: string;
}

interface COAItem {
  code: string; name: string; type: string; detailType: string | null;
}

export default function JournalDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [entry, setEntry] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit state
  const [editDate, setEditDate] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLines, setEditLines] = useState<{ id: string; glAccountCode: string; description: string; debit: number; credit: number }[]>([]);
  const [coa, setCoa] = useState<COAItem[]>([]);
  const [acctDropdown, setAcctDropdown] = useState<string | null>(null);
  const [acctSearch, setAcctSearch] = useState<Record<string, string>>({});

  const fetchEntry = useCallback(async () => {
    try {
      const res = await fetch(`/api/journal/${id}`);
      if (!res.ok) throw new Error('Not found');
      const json = await res.json();
      setEntry(json.data || null);
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchEntry(); }, [fetchEntry]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/coa');
        const json = await res.json();
        setCoa(json.data || []);
      } catch { /* ignore */ }
    }
    load();
  }, []);

  function startEdit() {
    if (!entry) return;
    setEditDate(entry.entryDate.slice(0, 10));
    setEditDesc(entry.description);
    setEditLines(entry.lines.map((l) => ({
      id: l.id, glAccountCode: l.glAccountCode, description: l.description || '',
      debit: l.debit, credit: l.credit,
    })));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function updateEditLine(lineId: string, field: string, value: string | number) {
    setEditLines((prev) => prev.map((l) => {
      if (l.id !== lineId) return l;
      if (field === 'glAccountCode') return { ...l, glAccountCode: value as string };
      if (field === 'description') return { ...l, description: value as string };
      if (field === 'debit' && Number(value) > 0) return { ...l, debit: Number(value), credit: 0 };
      if (field === 'credit' && Number(value) > 0) return { ...l, credit: Number(value), debit: 0 };
      return l;
    }));
  }

  function addEditLine() {
    setEditLines((prev) => [...prev, { id: String(Date.now()), glAccountCode: '', description: '', debit: 0, credit: 0 }]);
  }

  function removeEditLine(lineId: string) {
    if (editLines.length <= 2) return;
    setEditLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  async function handleSave() {
    const totalD = editLines.reduce((s, l) => s + l.debit, 0);
    const totalC = editLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalD - totalC) > 0.005) {
      setError('Not balanced'); return;
    }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/journal/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryDate: editDate, description: editDesc, lines: editLines.map((l) => ({ glAccountCode: l.glAccountCode, description: l.description || undefined, debit: l.debit, credit: l.credit })) }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      setSuccess('Entry updated. GL balances adjusted.');
      setEditing(false);
      fetchEntry();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm('Delete this journal entry? GL balances will be reversed. This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
      router.push('/journal');
    } catch (err: any) { setError(err.message); setDeleting(false); }
  }

  const typeColors: Record<string, string> = {
    asset: 'text-[var(--primary)]', liability: 'text-[var(--warning)]',
    equity: 'text-[var(--success)]', income: 'text-[var(--success)]',
    expense: 'text-[var(--danger)]',
  };

  if (loading) return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={24} /></div></AppShell>;
  if (error || !entry) return <AppShell><div className="text-center py-16 text-[var(--text-muted)]">{error || 'Not found'}</div></AppShell>;

  const isManual = entry.sourceType === 'manual';

  return (
    <AppShell>
      <div className="max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push('/journal')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
              <ArrowLeft size={18} className="text-[var(--text-muted)]" />
            </button>
            <div>
              <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
                {editing ? 'Edit Journal Entry' : 'Journal Entry'}
              </h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {entry.sourceType === 'manual' ? 'Manual adjusting entry' : `Auto-generated from ${entry.sourceType}`}
                {entry.sourceId && <span> · {entry.sourceId}</span>}
              </p>
            </div>
          </div>
          {isManual && !editing && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={startEdit}><Edit3 size={14} /> Edit</Button>
              <Button variant="ghost" onClick={handleDelete} disabled={deleting} className="text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </Button>
            </div>
          )}
          {editing && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={cancelEdit}><X size={14} /> Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Changes
              </Button>
            </div>
          )}
        </div>

        {success && <Alert variant="success" className="mb-4"><CheckCircle2 size={16} /> {success}</Alert>}
        {error && <Alert variant="danger" className="mb-4"><AlertTriangle size={16} /> {error}</Alert>}

        {/* Entry details */}
        <Card className="mb-4">
          <CardBody className="p-6 space-y-4">
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Date</label>
                  <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]" />
                </div>
                <div />
                <div className="col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)]">Description</label>
                  <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="w-full border border-[var(--border)] rounded-lg px-3 py-2 mt-1 text-sm bg-[var(--surface)]" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div><div className="text-xs text-[var(--text-muted)]">Date</div><div className="text-sm font-medium text-[var(--text-strong)]">{format(new Date(entry.entryDate), 'MMMM d, yyyy h:mm a')}</div></div>
                <div><div className="text-xs text-[var(--text-muted)]">Source</div><Badge variant={entry.sourceType === 'manual' ? 'pending' : 'paid'}>{entry.sourceType}</Badge></div>
                <div className="col-span-2"><div className="text-xs text-[var(--text-muted)]">Description</div><div className="text-sm font-medium text-[var(--text-strong)]">{entry.description}</div></div>
                <div><div className="text-xs text-[var(--text-muted)]">Created</div><div className="text-sm text-[var(--text)]">{format(new Date(entry.createdAt), 'MMM d, yyyy h:mm a')}</div></div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Lines */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-[var(--text-strong)]">
              {editing ? `${editLines.length} line${editLines.length !== 1 ? 's' : ''}` : `${entry.lines.length} line${entry.lines.length !== 1 ? 's' : ''}`}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="text-left text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5">Account</th>
                  <th className="text-left text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5">Description</th>
                  <th className="text-right text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5 w-32">Debit</th>
                  <th className="text-right text-micro font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-2.5 w-32">Credit</th>
                  {editing && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {(editing ? editLines : entry.lines).map((line: any, idx: number) => (
                  <tr key={line.id} className="border-b border-[var(--border)]">
                    <td className="px-4 py-2.5">
                      {editing ? (
                        <div className="relative">
                          <button type="button" onClick={() => setAcctDropdown(acctDropdown === line.id ? null : line.id)} className={cn('w-full text-left text-sm px-2.5 py-1.5 rounded-lg border flex items-center justify-between', line.glAccountCode ? 'border-[var(--border)] bg-[var(--surface)]' : 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]')}>
                            <span className="truncate text-xs">{line.glAccountCode || 'Select...'}</span><Search size={12} className="text-[var(--text-faint)] shrink-0" />
                          </button>
                          {acctDropdown === line.id && (
                            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] max-h-48 overflow-y-auto">
                              <input type="text" placeholder="Search..." autoFocus className="w-full border-0 border-b border-[var(--border)] px-2 py-1.5 text-xs bg-transparent outline-none sticky top-0 bg-[var(--surface)]" value={acctSearch[line.id] || ''} onChange={(e) => setAcctSearch({ ...acctSearch, [line.id]: e.target.value })} />
                              {coa.filter((a) => !(acctSearch[line.id]) || a.code.includes(acctSearch[line.id]) || a.name.toLowerCase().includes(acctSearch[line.id].toLowerCase())).slice(0, 15).map((a) => (
                                <button key={a.code} type="button" onClick={() => { updateEditLine(line.id, 'glAccountCode', a.code); setAcctDropdown(null); }} className="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--primary-soft)] flex justify-between">
                                  <span><span className="font-mono text-[var(--text-muted)]">{a.code}</span> <span>{a.name}</span></span>
                                  <span className={cn('text-micro uppercase', typeColors[a.type] || '')}>{a.type}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="text-sm font-medium text-[var(--text-strong)]">{line.accountName}</div>
                          <div className={cn('text-xs font-mono', typeColors[line.accountType] || 'text-[var(--text-muted)]')}>
                            {line.glAccountCode} · {line.accountType}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {editing ? (
                        <input type="text" value={line.description || ''} onChange={(e) => updateEditLine(line.id, 'description', e.target.value)} placeholder="Line note..." className="w-full border border-transparent hover:border-[var(--border)] focus:border-[var(--border-focus)] rounded px-2 py-1 text-xs bg-transparent outline-none" />
                      ) : (
                        <span className="text-sm text-[var(--text-muted)]">{line.description || '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {editing ? (
                        <input type="number" step="0.01" min="0" value={line.debit || ''} onChange={(e) => updateEditLine(line.id, 'debit', parseFloat(e.target.value) || 0)} className="w-full text-right font-mono text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
                      ) : (
                        <span className="text-sm font-mono tabular-nums text-right block text-[var(--text)]">{line.debit > 0 ? money(line.debit) : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {editing ? (
                        <input type="number" step="0.01" min="0" value={line.credit || ''} onChange={(e) => updateEditLine(line.id, 'credit', parseFloat(e.target.value) || 0)} className="w-full text-right font-mono text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
                      ) : (
                        <span className="text-sm font-mono tabular-nums text-right block text-[var(--text)]">{line.credit > 0 ? money(line.credit) : '—'}</span>
                      )}
                    </td>
                    {editing && (
                      <td className="px-1">
                        {editLines.length > 2 && <button type="button" onClick={() => removeEditLine(line.id)} className="p-1 rounded hover:bg-[var(--danger-soft)] text-[var(--text-muted)] hover:text-[var(--danger)]"><X size={12} /></button>}
                      </td>
                    )}
                  </tr>
                ))}
                {editing && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2">
                      <button type="button" onClick={addEditLine} className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)]"><Plus size={12} /> Add Line</button>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-2)]">
                  <td colSpan={2} className="px-4 py-3 text-right text-sm font-semibold text-[var(--text-strong)]">Totals</td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-[var(--text-strong)]">
                    {money(editing ? editLines.reduce((s, l) => s + l.debit, 0) : entry.totalDebits)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-[var(--text-strong)]">
                    {money(editing ? editLines.reduce((s, l) => s + l.credit, 0) : entry.totalCredits)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardBody>
        </Card>

        <p className="text-xs text-[var(--text-faint)] mt-4">
          {isManual ? 'Manual entries can be edited or deleted. System-generated entries are locked for audit integrity.' : 'System-generated entries cannot be edited or deleted. Create a correcting manual entry instead.'}
        </p>
      </div>
    </AppShell>
  );
}
