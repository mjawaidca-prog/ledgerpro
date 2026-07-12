'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, parseISO } from 'date-fns';
import {
  ArrowLeft, Check, Loader2, AlertTriangle, Search, CheckCircle2,
  Building2, BookOpen, ArrowRightLeft, X,
} from 'lucide-react';

interface ReconData {
  account: { id: string; name: string; currentBalance: number; glAccountCode: string | null };
  transactions: { id: string; date: string; description: string; merchant: string | null; amount: number; status: string; category: { code: string; name: string } | null }[];
  journalLines: { id: string; entryId: string; date: string; description: string; sourceType: string; sourceId: string | null; debit: number; credit: number }[];
  stats: { unreconciledCount: number; statementBalance: number; glBalance: number };
}

function AccountPicker() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(json => setAccounts(json.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="max-w-lg mx-auto py-12">
        <div className="text-center mb-8">
          <Building2 size={40} className="mx-auto text-[var(--text-muted)] mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text-strong)] mb-2">Reconcile Account</h1>
          <p className="text-sm text-[var(--text-muted)]">Select a bank account to reconcile.</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8">
            <AlertTriangle size={32} className="mx-auto text-[var(--warning)] mb-3" />
            <p className="text-sm text-[var(--text-muted)] mb-4">No bank accounts found. Connect an account first.</p>
            <Button onClick={() => router.push('/banking')}><ArrowLeft size={14} /> Go to Banking</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acct: any) => (
              <button
                key={acct.id}
                onClick={() => router.push(`/banking/reconcile?accountId=${acct.id}`)}
                className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] grid place-items-center flex-none">
                  <Building2 size={18} className="text-[var(--primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">{acct.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {acct.kind} {acct.mask ? `·••${acct.mask}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-semibold text-[var(--text-strong)]">{money(acct.currentBalance)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ReconcileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountId = searchParams.get('accountId') || '';

  const [data, setData] = useState<ReconData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTxns, setSelectedTxns] = useState<Set<string>>(new Set());
  const [selectedGL, setSelectedGL] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);
  const [txSearch, setTxSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!accountId) { setLoading(false); setError('No account selected.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/reconciliation?accountId=${accountId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggleTx(id: string) {
    setSelectedTxns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGL(id: string) {
    setSelectedGL((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleReconcile() {
    if (selectedTxns.size === 0) {
      setMessage({ type: 'danger', text: 'Select at least one transaction to reconcile.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: Array.from(selectedTxns) }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed');
      }
      const json = await res.json();
      setMessage({ type: 'success', text: `${json.data.reconciledCount} transaction(s) reconciled.` });
      setSelectedTxns(new Set());
      setSelectedGL(new Set());
      fetchData();
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally { setSaving(false); }
  }

  function selectAllTx() {
    if (!data) return;
    const filtered = data.transactions.filter(txFilter);
    if (selectedTxns.size === filtered.length) {
      setSelectedTxns(new Set());
    } else {
      setSelectedTxns(new Set(filtered.map((t) => t.id)));
    }
  }

  function txFilter(tx: ReconData['transactions'][0]) {
    if (!txSearch) return true;
    const q = txSearch.toLowerCase();
    return tx.description.toLowerCase().includes(q) ||
      (tx.merchant || '').toLowerCase().includes(q) ||
      (tx.category?.name || '').toLowerCase().includes(q);
  }

  if (!accountId) {
    return <AccountPicker />;
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/banking')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]">
          <ArrowLeft size={18} className="text-[var(--text-muted)]" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-strong)]">Reconcile</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {data ? `${data.account.name} — ${data.stats.unreconciledCount} unreconciled` : 'Loading...'}
          </p>
        </div>
        <Button onClick={handleReconcile} disabled={saving || selectedTxns.size === 0}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Reconcile {selectedTxns.size > 0 ? `(${selectedTxns.size})` : ''}
        </Button>
      </div>

      {message && <Alert variant={message.type} className="mb-4">{message.text}</Alert>}

      {loading && (
        <div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
      )}

      {error && (
        <Alert variant="danger" className="mb-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} /><span>{error}</span>
            <div className="flex-1" /><Button variant="ghost" size="sm" onClick={fetchData}>Retry</Button>
          </div>
        </Alert>
      )}

      {!loading && data && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardBody>
                <div className="text-xs text-[var(--text-muted)] mb-1">Statement Balance</div>
                <div className="font-mono text-xl font-semibold text-[var(--text-strong)]">{money(data.stats.statementBalance)}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-[var(--text-muted)] mb-1">GL Balance</div>
                <div className="font-mono text-xl font-semibold text-[var(--text-strong)]">{money(data.stats.glBalance)}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-[var(--text-muted)] mb-1">Difference</div>
                <div className={cn(
                  'font-mono text-xl font-semibold',
                  Math.abs(data.stats.glBalance - data.stats.statementBalance) < 0.01
                    ? 'text-[var(--success)]'
                    : 'text-[var(--danger)]'
                )}>
                  {money(data.stats.glBalance - data.stats.statementBalance)}
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-2 gap-6">
            {/* Left: Statement Transactions */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h3 className="font-semibold text-[var(--text-strong)] flex items-center gap-2">
                    <Building2 size={16} /> Bank Statement
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                      <input
                        type="text"
                        placeholder="Filter..."
                        value={txSearch}
                        onChange={(e) => setTxSearch(e.target.value)}
                        className="h-[28px] w-[140px] pl-[24px] pr-2 text-xs rounded-md border border-[var(--border)] bg-[var(--surface)] focus:outline-none focus:border-[var(--border-focus)]"
                      />
                    </div>
                    <button onClick={selectAllTx} className="text-xs text-[var(--accent)] hover:text-[var(--primary)]">
                      {selectedTxns.size > 0 ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardBody>
                <div className="max-h-[500px] overflow-y-auto space-y-0.5">
                  {data.transactions.filter(txFilter).length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] text-center py-8">All transactions reconciled.</p>
                  ) : (
                    data.transactions.filter(txFilter).map((tx) => (
                      <button
                        key={tx.id}
                        onClick={() => toggleTx(tx.id)}
                        className={cn(
                          'w-full text-left flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors',
                          selectedTxns.has(tx.id)
                            ? 'bg-[var(--primary-soft)] border border-[var(--border-focus)]'
                            : 'hover:bg-[var(--surface-3)] border border-transparent'
                        )}
                      >
                        <input type="checkbox" checked={selectedTxns.has(tx.id)} onChange={() => toggleTx(tx.id)} className="rounded" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[var(--text-strong)] truncate">{tx.merchant || tx.description}</div>
                          <div className="text-[10px] text-[var(--text-faint)] flex items-center gap-2">
                            <span>{format(new Date(tx.date), 'MMM d')}</span>
                            {tx.category && <Badge variant="neutral">{tx.category.name}</Badge>}
                          </div>
                        </div>
                        <span className={cn('font-mono text-sm tabular-nums shrink-0', tx.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>
                          {money(tx.amount)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>

            {/* Right: GL Entries */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h3 className="font-semibold text-[var(--text-strong)] flex items-center gap-2">
                    <BookOpen size={16} /> General Ledger
                  </h3>
                  <span className="text-xs text-[var(--text-muted)]">
                    {data.journalLines.length} entries
                  </span>
                </div>
              </CardHeader>
              <CardBody>
                <div className="max-h-[500px] overflow-y-auto space-y-0.5">
                  {data.journalLines.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] text-center py-8">No GL entries for this account.</p>
                  ) : (
                    data.journalLines.map((jl) => (
                      <div
                        key={jl.id}
                        className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-transparent"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[var(--text-strong)] truncate">{jl.description}</div>
                          <div className="text-[10px] text-[var(--text-faint)] flex items-center gap-2">
                            <span>{format(new Date(jl.date), 'MMM d')}</span>
                            <Badge variant="draft">{jl.sourceType}</Badge>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {jl.debit > 0 && <span className="font-mono text-sm tabular-nums text-[var(--danger)] block">{money(jl.debit)}</span>}
                          {jl.credit > 0 && <span className="font-mono text-sm tabular-nums text-[var(--success)] block">{money(jl.credit)}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          </div>

          {selectedTxns.size > 0 && (
            <div className="mt-4 flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
              <span className="text-sm text-[var(--text-strong)]">
                <span className="font-semibold">{selectedTxns.size}</span> transaction(s) selected for reconciliation
              </span>
              <Button onClick={handleReconcile} disabled={saving} size="sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Complete Reconciliation
              </Button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function ReconcilePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>}>
      <ReconcileContent />
    </Suspense>
  );
}
