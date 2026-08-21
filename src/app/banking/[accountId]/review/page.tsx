'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { ArrowLeft, Loader2, Plus, Check, X, Search, ArrowRight } from 'lucide-react';
import { N, SIGNED } from '@/lib/fx-format';
import { fetchWithTenantHeaders } from '@/lib/tenant-client';

interface QueueRow {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  currency: string;
  status: string;
  pill: string;
  suggested: { id: string; ref: string; contactName: string; confidence: string } | null;
  category: { code: string; name: string } | null;
  contact: { id: string; name: string } | null;
  appliedRule: { id: string; name: string } | null;
  payeeGuess: string | null;
  taxCode: string | null;
  splits: unknown;
  posted: boolean;
}

interface Tiles {
  toReview: number;
  suggestedMatches: number;
  categorizedByRules: number;
  postedThisMonth: number;
}

interface MatchSuggestion {
  doc: { type: string; id: string; ref: string; contactName: string; total: number; outstanding: number; dueDate: string | null };
  confidence: 'high' | 'likely' | null;
  signals: { name: string; matched: boolean; detail: string }[];
  journalPreview: { code: string; name: string; memo: string; debit: number; credit: number }[];
}

type Mode = 'suggest' | 'categorize' | 'split' | 'find' | null;

export default function ReviewPage({ params }: { params: { accountId: string } }) {
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [tiles, setTiles] = useState<Tiles>({ toReview: 0, suggestedMatches: 0, categorizedByRules: 0, postedThisMonth: 0 });
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [matches, setMatches] = useState<MatchSuggestion[] | null>(null);
  const [categories, setCategories] = useState<{ id: string; code: string; name: string; type: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Categorize form
  const [catCategory, setCatCategory] = useState('');
  const [catContact, setCatContact] = useState('');
  const [catTax, setCatTax] = useState('');
  const [catMemo, setCatMemo] = useState('');
  const [catRemember, setCatRemember] = useState(false);
  // Split form
  const [splitLines, setSplitLines] = useState<{ categoryCode: string; amount: number; taxCode: string | null; taxRate: number | null; taxInclusive: boolean }[]>([]);
  // Find form
  const [findQuery, setFindQuery] = useState('');
  const [findCandidates, setFindCandidates] = useState<{ id: string; ref: string; contactName: string; dueDate: string | null; outstanding: number }[]>([]);
  const [findSelected, setFindSelected] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetchWithTenantHeaders(`/api/bank-transactions?accountId=${params.accountId}&limit=300`)
      .then((r) => r.json())
      .then((json) => {
        setRows(json.data?.rows ?? []);
        setTiles(json.data?.tiles ?? tiles);
      })
      .catch(() => {});
    fetchWithTenantHeaders('/api/coa')
      .then((r) => r.json())
      .then((json) => setCategories(json.data ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectRow = async (row: QueueRow) => {
    setSelected(row);
    setMode(null);
    setError(null);
    if (row.suggested) {
      const res = await fetchWithTenantHeaders(`/api/bank-transactions/${row.id}/suggested-matches`);
      const json = await res.json();
      setMatches(json.data?.matches ?? []);
      setMode('suggest');
    } else if (row.category || row.appliedRule) {
      setMode('categorize');
      setCatCategory(row.category?.code ?? '');
    } else {
      setMode('categorize');
    }
    setSplitLines([{ categoryCode: '', amount: Math.abs(row.amount), taxCode: null, taxRate: null, taxInclusive: true }]);
  };

  const postCategorize = async (post: boolean) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders(`/api/bank-transactions/${selected.id}/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryCode: catCategory || null,
          taxCode: catTax || null,
          taxRate: catTax ? parseTaxRate(catTax) : null,
          taxInclusive: true,
          contactId: catContact || null,
          memo: catMemo || null,
          createRule: catRemember,
          post,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      load();
      setSelected(null);
      setMode(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const postSplit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders(`/api/bank-transactions/${selected.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits: splitLines.map((s) => ({ ...s, amount: Number(s.amount) })), post: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      load();
      setSelected(null);
      setMode(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const postMatch = async (docs: { type: string; id: string; amount: number }[]) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders(`/api/bank-transactions/${selected.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docs }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      load();
      setSelected(null);
      setMode(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const searchInvoices = async () => {
    if (!selected) return;
    const res = await fetchWithTenantHeaders(`/api/search?q=${encodeURIComponent(findQuery)}`);
    const json = await res.json().catch(() => ({ data: [] }));
    setFindCandidates(json.data ?? []);
  };

  const findSelectedDocs = findCandidates.filter((c) => findSelected.has(c.id));
  const findTotal = findSelectedDocs.reduce((s, c) => s + c.outstanding, 0);
  const findRemainder = Math.abs(selected?.amount ?? 0) - findTotal;

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/banking')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Banking <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Review imported transactions</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Review imported transactions</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px] mb-6">
        Rows land here uncategorized unless a rule caught them. Match against an invoice or bill where one exists, categorize where none does.
      </p>

      {/* Stat tiles */}
      <div className="grid grid-cols-4 gap-4 mb-6 max-[900px]:grid-cols-2">
        <Tile label="To review" value={String(tiles.toReview)} tone="warn" note="oldest is 4 days old" />
        <Tile label="Suggested matches" value={String(tiles.suggestedMatches)} tone="ok" note="against open invoices and bills" />
        <Tile label="Categorized by rules" value={String(tiles.categorizedByRules)} tone="ink" note="of imported rows" />
        <Tile label="Posted this month" value={String(tiles.postedThisMonth)} tone="mute" note="across all accounts" />
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="grid grid-cols-[1fr_372px] gap-6 max-[1100px]:grid-cols-1">
        {/* Queue */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
          <div className="grid grid-cols-[86px_1fr_112px_118px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div>Date</div><div>Description</div><div className="text-right">Amount</div><div className="text-right">Status</div>
          </div>
          {!rows ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">Nothing in the queue. Import a statement to get started.</div>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                onClick={() => selectRow(row)}
                className={cn(
                  'w-full grid grid-cols-[86px_1fr_112px_118px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 text-left transition-colors',
                  selected?.id === row.id ? 'bg-[var(--primary-soft)] border-l-[3px] border-l-[var(--primary)]' : 'hover:bg-[var(--surface-2)]'
                )}
              >
                <div className="font-mono text-[12.5px] text-[var(--text)]">{row.date}</div>
                <div className="min-w-0">
                  <div className={cn('text-[13.5px] truncate', selected?.id === row.id ? 'text-[var(--text-strong)] font-semibold' : 'text-[var(--text)]')}>{row.description}</div>
                  <div className="font-mono text-[10.5px] text-[var(--text-faint)]">
                    {row.suggested ? `suggested: ${row.suggested.ref} · ${row.suggested.contactName}` : row.appliedRule ? `rule ${row.appliedRule.name}` : row.category ? `${row.category.code} ${row.category.name}` : 'no rule matched this payee'}
                  </div>
                </div>
                <div className={cn('text-right font-mono tabular-nums text-[13px]', row.amount >= 0 ? 'text-[var(--success)]' : 'text-[var(--text-strong)]')}>{SIGNED(row.amount)}</div>
                <div className="text-right"><Pill label={row.pill} /></div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 min-h-[320px]">
          {!selected ? (
            <div className="py-16 text-center text-sm text-[var(--text-muted)]">Select a row to review it.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--text-muted)]">
                  {mode === 'suggest' ? 'Suggested match' : mode === 'split' ? 'Split and tax' : mode === 'find' ? 'Find and match' : 'Categorize'}
                </div>
                <div className="text-[15px] font-semibold text-[var(--text-strong)] mt-1">{selected.payeeGuess || selected.description}</div>
                <div className="font-mono text-[20px] font-bold tabular-nums mt-1 text-[var(--text-strong)]">{SIGNED(selected.amount)}</div>
                <div className="font-mono text-[11px] text-[var(--text-faint)]">{selected.date} · {selected.description}</div>
              </div>

              {mode === 'suggest' && matches && matches.length > 0 && (
                <div className="space-y-3">
                  <div className="rounded-[var(--r-lg)] bg-[var(--success-soft)] border border-[var(--success-soft-border)] p-3.5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--success)]">
                      {matches[0].confidence === 'high' ? 'High confidence · 3 of 3 signals' : 'Likely match · 2 of 3 signals'}
                    </div>
                    <div className="text-[14px] font-semibold text-[var(--text-strong)] mt-1">{matches[0].doc.ref} · {matches[0].doc.contactName}</div>
                    <div className="text-xs text-[var(--success)] mt-1">
                      Same amount, payee name in the description, and the invoice is within ten days of this payment.
                    </div>
                    <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2 pt-2 border-t border-[var(--success-soft-border)]">
                      <span>Invoice total</span>
                      <span className="font-mono tabular-nums text-[var(--text-strong)]">{N(matches[0].doc.outstanding)} {selected.currency}</span>
                    </div>
                  </div>

                  <div className="text-xs text-[var(--text-muted)]">What posts</div>
                  <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
                    {matches[0].journalPreview.map((l, i) => (
                      <div key={i} className="grid grid-cols-[50px_1fr_80px_80px] px-3 py-2 border-b border-[var(--surface-3)] last:border-b-0 text-[12px]">
                        <div className="font-mono text-[var(--text-muted)]">{l.code}</div>
                        <div className="text-[var(--text)]">{l.name}</div>
                        <div className="text-right font-mono tabular-nums text-[var(--text)]">{l.debit > 0 ? N(l.debit) : '—'}</div>
                        <div className="text-right font-mono tabular-nums text-[var(--text)]">{l.credit > 0 ? N(l.credit) : '—'}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => postMatch([{ type: matches[0].doc.type, id: matches[0].doc.id, amount: Math.abs(selected.amount) }])}
                      disabled={busy}
                      className="flex-1 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin inline" /> : 'Match and post'}
                    </button>
                    <button onClick={() => setMode('find')} className="rounded-full border border-[var(--border)] text-[13px] font-medium px-4 py-2 text-[var(--text)] hover:border-[var(--border-strong)] transition-colors">
                      Find another
                    </button>
                  </div>
                </div>
              )}

              {mode === 'categorize' && (
                <div className="space-y-3">
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Category</label>
                    <select value={catCategory} onChange={(e) => setCatCategory(e.target.value)} className="mt-1 w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none">
                      <option value="">Select…</option>
                      {categories.filter((c) => (selected.amount > 0 ? c.type === 'income' : c.type === 'expense')).map((c) => (
                        <option key={c.id} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                    <div className="text-xs text-[var(--text-muted)] mt-1">Suggested from earlier {selected.payeeGuess ?? 'entries'}.</div>
                  </div>
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Contact</label>
                    <input value={catContact} onChange={(e) => setCatContact(e.target.value)} placeholder={selected.payeeGuess ?? 'Contact name — created on posting'} className="mt-1 w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
                  </div>
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Sales tax</label>
                    <select value={catTax} onChange={(e) => setCatTax(e.target.value)} className="mt-1 w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none">
                      <option value="">No tax</option>
                      <option value="GST 5% (included)">GST 5% (included)</option>
                      <option value="GST/HST 13% (included)">GST/HST 13% (included)</option>
                      <option value="Exempt">Exempt</option>
                    </select>
                    {catTax && (
                      <div className="text-xs text-[var(--primary)] mt-1">
                        {catTax} · {N(parseTaxRate(catTax) ? Math.abs(selected.amount) - Math.abs(selected.amount) / (1 + parseTaxRate(catTax)! / 100) : 0)} tax backed out of {N(Math.abs(selected.amount))}.
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Memo</label>
                    <input value={catMemo} onChange={(e) => setCatMemo(e.target.value)} className="mt-1 w-full border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--text)]">
                    <input type="checkbox" checked={catRemember} onChange={(e) => setCatRemember(e.target.checked)} className="accent-[var(--primary)]" />
                    Remember this for &ldquo;{selected.payeeGuess ?? selected.description}&rdquo; and apply it on future imports
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => postCategorize(true)} disabled={busy} className="flex-1 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors">
                      {busy ? 'Posting…' : 'Post to ledger'}
                    </button>
                    <button onClick={() => setMode('split')} className="rounded-full border border-[var(--border)] text-[13px] font-medium px-4 py-2 text-[var(--text)] hover:border-[var(--border-strong)] transition-colors">
                      Split
                    </button>
                  </div>
                </div>
              )}

              {mode === 'split' && (
                <div className="space-y-3">
                  {splitLines.map((line, i) => (
                    <div key={i} className="border border-[var(--border)] rounded-[var(--r-lg)] p-3 space-y-2">
                      <select
                        value={line.categoryCode}
                        onChange={(e) => setSplitLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, categoryCode: e.target.value } : l)))}
                        className="w-full border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 text-[12.5px] text-[var(--text)] outline-none"
                      >
                        <option value="">Category…</option>
                        {categories.filter((c) => (selected.amount > 0 ? c.type === 'income' : c.type === 'expense')).map((c) => (
                          <option key={c.id} value={c.code}>{c.code} — {c.name}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={line.amount || ''}
                        onChange={(e) => setSplitLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, amount: parseFloat(e.target.value) || 0 } : l)))}
                        className="w-full border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[13px] text-right text-[var(--text)] outline-none"
                      />
                    </div>
                  ))}
                  <button onClick={() => setSplitLines((prev) => [...prev, { categoryCode: '', amount: 0, taxCode: null, taxRate: null, taxInclusive: true }])} className="flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
                    <Plus size={12} /> Add a split line
                  </button>
                  <div className="rounded-[var(--r-lg)] bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1 text-[12.5px]">
                    <div className="flex justify-between"><span className="text-[var(--text-muted)]">Transaction amount</span><span className="font-mono tabular-nums text-[var(--text)]">{N(Math.abs(selected.amount))}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--text-muted)]">Allocated across {splitLines.length} line{splitLines.length === 1 ? '' : 's'}</span><span className="font-mono tabular-nums text-[var(--text)]">{N(splitLines.reduce((s, l) => s + (l.amount || 0), 0))}</span></div>
                    <div className={cn('flex justify-between font-semibold', Math.abs(Math.abs(selected.amount) - splitLines.reduce((s, l) => s + (l.amount || 0), 0)) < 0.005 ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
                      <span>{Math.abs(Math.abs(selected.amount) - splitLines.reduce((s, l) => s + (l.amount || 0), 0)) < 0.005 ? 'Fully allocated' : 'Still to allocate'}</span>
                      <span className="font-mono tabular-nums">{N(Math.abs(selected.amount) - splitLines.reduce((s, l) => s + (l.amount || 0), 0))}</span>
                    </div>
                  </div>
                  <button onClick={postSplit} disabled={busy} className="w-full rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors">
                    Post {splitLines.length} line{splitLines.length === 1 ? '' : 's'}
                  </button>
                  <div className="text-xs text-[var(--text-faint)] text-center">Posts as one transaction with {splitLines.length} ledger line{splitLines.length === 1 ? '' : 's'}.</div>
                </div>
              )}

              {mode === 'find' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input value={findQuery} onChange={(e) => setFindQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchInvoices()} placeholder="Search open invoices…" className="w-full pl-8 pr-3 py-2 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] text-[13px] text-[var(--text)] outline-none" />
                    </div>
                    <button onClick={searchInvoices} className="rounded-[var(--r-lg)] border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] hover:border-[var(--border-strong)] transition-colors">Search</button>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">Tick more than one to match a single deposit against several invoices.</div>
                  {findCandidates.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setFindSelected((prev) => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })}
                      className={cn('w-full text-left border rounded-[var(--r-lg)] px-3 py-2.5 flex items-center gap-2.5 transition-colors', findSelected.has(c.id) ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]')}
                    >
                      <span className={cn('w-4 h-4 rounded-[4px] flex items-center justify-center', findSelected.has(c.id) ? 'bg-[var(--primary)]' : 'border border-[var(--border-strong)]')}>
                        {findSelected.has(c.id) && <Check size={10} strokeWidth={3.5} className="text-white" />}
                      </span>
                      <span className="flex-1 text-[13px] text-[var(--text)]">{c.ref} · {c.contactName}</span>
                      <span className="font-mono text-[12px] tabular-nums text-[var(--text)]">{N(c.outstanding)}</span>
                    </button>
                  ))}
                  {findCandidates.length > 0 && (
                    <div className="rounded-[var(--r-lg)] bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1 text-[12.5px]">
                      <div className="flex justify-between"><span className="text-[var(--text-muted)]">Selected invoices</span><span className="font-mono tabular-nums text-[var(--text)]">{N(findTotal)}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--text-muted)]">Deposit</span><span className="font-mono tabular-nums text-[var(--text)]">{N(Math.abs(selected.amount))}</span></div>
                      <div className={cn('flex justify-between font-semibold', Math.abs(findRemainder) < 0.005 ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
                        <span>{Math.abs(findRemainder) < 0.005 ? 'Fully matched' : 'Unmatched remainder'}</span>
                        <span className="font-mono tabular-nums">{N(Math.abs(findRemainder))}</span>
                      </div>
                    </div>
                  )}
                  {findSelected.size > 0 && (
                    <button
                      onClick={() => postMatch(findSelectedDocs.map((c) => ({ type: 'invoice', id: c.id, amount: c.outstanding })))}
                      disabled={busy || Math.abs(findRemainder) > 0.005}
                      className="w-full rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors"
                    >
                      Match {findSelected.size} invoice{findSelected.size === 1 ? '' : 's'}{Math.abs(findRemainder) > 0.005 ? ` and hold ${N(Math.abs(findRemainder))} on account` : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function parseTaxRate(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'ok' | 'warn' | 'ink' | 'mute' }) {
  const color = tone === 'ok' ? 'text-[var(--success)]' : tone === 'warn' ? 'text-[var(--warning)]' : tone === 'ink' ? 'text-[var(--text-strong)]' : 'text-[var(--text-muted)]';
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--text-muted)]">{label}</div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums mt-1.5', color)}>{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{note}</div>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  const kind =
    label === 'Match found'
      ? { bg: 'bg-[var(--success-soft)] border-[var(--success-soft-border)]', dot: 'bg-[var(--success)]', fg: 'text-[var(--success)]' }
      : label === 'Posted'
        ? { bg: 'bg-[var(--success-soft)] border-[var(--success-soft-border)]', dot: 'bg-[var(--success)]', fg: 'text-[var(--success)]' }
        : label === 'Categorized'
          ? { bg: 'bg-[var(--neutral-soft)] border-[var(--neutral-soft-border)]', dot: 'bg-[var(--text-faint)]', fg: 'text-[var(--text-muted)]' }
          : { bg: 'bg-[var(--warning-soft)] border-[var(--warning-soft-border)]', dot: 'bg-[var(--warning)]', fg: 'text-[var(--warning)]' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full border whitespace-nowrap', kind.bg)}>
      <span className={cn('w-[5px] h-[5px] rounded-full', kind.dot)} />
      <span className={cn('font-mono text-[9.5px] uppercase tracking-[0.08em]', kind.fg)}>{label}</span>
    </span>
  );
}
