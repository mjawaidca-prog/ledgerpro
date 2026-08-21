'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { ArrowLeft, Loader2, Clock } from 'lucide-react';
import { N, SIGNED } from '@/lib/fx-format';
import { fetchWithTenantHeaders } from '@/lib/tenant-client';

interface Candidate {
  id: string;
  date: string;
  description: string;
  amount: number;
  source: string;
  ticked: boolean;
}

interface Verdict {
  ledgerBalance: number;
  difference: number;
  inBalance: boolean;
  causes: string[];
  tickedCount: number;
  totalCandidates: number;
}

interface HistoryRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  statement: number;
  ledger: number | null;
  difference: number | null;
  closedBy: string | null;
  closedAt: string | null;
  state: string;
  accountName: string;
}

export default function ReconcilePage({ params }: { params: { accountId: string } }) {
  const router = useRouter();
  const [view, setView] = useState('reconcile');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [openRec, setOpenRec] = useState<{ id: string; periodStart: string; periodEnd: string; statementClosingBalance: number; unrecordedItems: { description: string; amount: number }[] } | null>(null);
  const [accountName, setAccountName] = useState('');
  const [lockedThrough, setLockedThrough] = useState<string | null>(null);
  const [opening, setOpening] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [statementBalance, setStatementBalance] = useState('');
  const [unrecorded, setUnrecorded] = useState<{ description: string; amount: number }[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [varianceReason, setVarianceReason] = useState('');
  const [showVariance, setShowVariance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchWithTenantHeaders(`/api/reconciliations?accountId=${params.accountId}`)
      .then((r) => r.json())
      .then((json) => {
        const ws = json.data?.workingSet;
        setHistory(json.data?.history ?? []);
        if (ws) {
          setCandidates(ws.candidates);
          setOpening(ws.openingBalance);
          setAccountName(ws.account.name);
          setLockedThrough(ws.account.lockedThrough ? String(ws.account.lockedThrough).slice(0, 10) : null);
          setOpenRec(ws.open);
          setTicked(new Set(ws.open?.tickedIds ?? ws.candidates.filter((c: Candidate) => c.ticked).map((c: Candidate) => c.id)));
          setStatementBalance(ws.open ? String(ws.open.statementClosingBalance) : '');
          setUnrecorded((ws.open?.unrecordedItems as any[]) ?? []);
        }
      })
      .catch(() => {});
  }, [params.accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRow = async (id: string) => {
    if (!openRec) return;
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    await updateTicks(next, statementBalance, unrecorded);
  };

  const updateTicks = async (nextTicked: Set<string>, balance: string, items: { description: string; amount: number }[]) => {
    if (!openRec) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders(`/api/reconciliations/${openRec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickedTransactionIds: [...nextTicked],
          statementClosingBalance: Number(balance),
          unrecordedItems: items,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setVerdict(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openReconciliation = async () => {
    setBusy(true);
    setError(null);
    try {
      // Default period: from the account's lock (or earliest candidate) to the latest candidate date.
      const start = lockedThrough ?? (candidates && candidates.length ? candidates[0].date : new Date().toISOString().slice(0, 10));
      const end = candidates && candidates.length ? candidates[candidates.length - 1].date : new Date().toISOString().slice(0, 10);
      const res = await fetchWithTenantHeaders('/api/reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: params.accountId, periodStart: start, periodEnd: end, statementClosingBalance: Number(statementBalance || 0) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      load();
      // Tick everything by default.
      const allIds = candidates?.map((c) => c.id) ?? [];
      const rec = json.data;
      const res2 = await fetchWithTenantHeaders(`/api/reconciliations/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickedTransactionIds: allIds, statementClosingBalance: Number(statementBalance || 0), unrecordedItems: unrecorded }),
      });
      const json2 = await res2.json();
      if (res2.ok) setVerdict(json2.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!openRec || !verdict) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders(`/api/reconciliations/${openRec.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ varianceReason: verdict.inBalance ? undefined : varianceReason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      load();
      setVerdict(null);
      setVarianceReason('');
      setShowVariance(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const periodLabel = openRec
    ? `${new Date(openRec.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(openRec.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : '';

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
          Banking <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">{accountName || 'Reconcile'}</strong>
        </span>
      </div>

      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Reconcile to statement</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px]">
            Agree the ledger to the closing balance on the statement, then lock the period so a later import cannot silently change it.
          </p>
        </div>
        <Segmented
          options={[
            { value: 'reconcile', label: 'Reconcile' },
            { value: 'history', label: 'History' },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {view === 'history' ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
          <div className="grid grid-cols-[150px_130px_130px_100px_1fr_110px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div>Period</div><div className="text-right">Statement</div><div className="text-right">Ledger</div><div className="text-right">Difference</div><div>Closed by</div><div className="text-right">State</div>
          </div>
          {history.map((h) => (
            <div key={h.id} className="grid grid-cols-[150px_130px_130px_100px_1fr_110px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
              <div className="font-mono text-[var(--text)]">{`${new Date(h.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(h.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text)]">{N(h.statement)}</div>
              <div className="text-right font-mono tabular-nums text-[var(--text)]">{h.ledger !== null ? N(h.ledger) : '—'}</div>
              <div className={cn('text-right font-mono tabular-nums', h.difference !== null && h.difference !== 0 ? 'text-[var(--warning)]' : 'text-[var(--text-faint)]')}>
                {h.difference !== null && Math.abs(h.difference) > 0.005 ? SIGNED(h.difference) : '—'}
              </div>
              <div className="text-[var(--text-muted)]">{h.closedBy ? `${h.closedBy} · ${h.closedAt ? new Date(h.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}` : '—'}</div>
              <div className="text-right">
                <span className={cn('inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full border font-mono text-[9.5px] uppercase tracking-[0.08em]', h.state === 'locked' ? 'bg-[var(--neutral-soft)] border-[var(--neutral-soft-border)] text-[var(--text-muted)]' : 'bg-[var(--warning-soft)] border-[var(--warning-soft-border)] text-[var(--warning)]')}>
                  {h.state === 'locked' ? 'Locked' : 'Closed with variance'}
                </span>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            {lockedThrough
              ? `Everything on or before ${lockedThrough} is locked. An import that contains locked dates will skip those rows and tell you which ones.`
              : 'Nothing is locked yet — closing a reconciliation locks its date range.'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_380px] gap-6 max-[1100px]:grid-cols-1">
          {/* Tick list */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
              <div className="text-sm font-semibold text-[var(--text-strong)]">Tick off what the statement shows</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">Imported rows are pre-ticked. Untick anything the bank has not actually cleared.</div>
              <div className="font-mono text-[11px] text-[var(--text-faint)] mt-1.5">{ticked.size} of {candidates?.length ?? 0} ticked</div>
            </div>
            <div className="grid grid-cols-[36px_86px_1fr_120px_112px] px-4 py-2 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
              <div /><div>Date</div><div>Description</div><div>Source</div><div className="text-right">Amount</div>
            </div>
            {!candidates ? (
              <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>
            ) : candidates.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">No transactions in this account yet.</div>
            ) : (
              candidates.map((c) => (
                <div key={c.id} className={cn('grid grid-cols-[36px_86px_1fr_120px_112px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center', !ticked.has(c.id) && 'opacity-80')}>
                  <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggleRow(c.id)} disabled={!openRec} className="w-4 h-4 accent-[var(--primary)]" />
                  <div className="font-mono text-[12.5px] text-[var(--text)]">{c.date}</div>
                  <div className={cn('text-[13.5px] truncate', ticked.has(c.id) ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>{c.description}</div>
                  <div className="font-mono text-[10.5px] uppercase text-[var(--text-faint)]">{c.source}</div>
                  <div className={cn('text-right font-mono tabular-nums text-[13px]', c.amount >= 0 ? 'text-[var(--success)]' : 'text-[var(--text-strong)]')}>{SIGNED(c.amount)}</div>
                </div>
              ))
            )}
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 space-y-3">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Statement</div>
              {openRec ? (
                <>
                  <div className="field">
                    <label>Closing date</label>
                    <div className="font-mono text-[13px] text-[var(--text-strong)] mt-1">{openRec.periodEnd}</div>
                  </div>
                  <div className="field">
                    <label>Closing balance</label>
                    <input type="number" step="0.01" value={statementBalance} onChange={(e) => { setStatementBalance(e.target.value); updateTicks(ticked, e.target.value, unrecorded); }} className="input" />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-muted)]">Unrecorded statement items</label>
                    {unrecorded.map((u, i) => (
                      <div key={i} className="flex gap-2 mt-1.5">
                        <input
                          value={u.description}
                          onChange={(e) => { const next = [...unrecorded]; next[i] = { ...next[i], description: e.target.value }; setUnrecorded(next); updateTicks(ticked, statementBalance, next); }}
                          className="flex-1 border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 text-[12.5px] text-[var(--text)] outline-none"
                          placeholder="Description (e.g. bank charge)"
                        />
                        <input
                          type="number" step="0.01"
                          value={u.amount || ''}
                          onChange={(e) => { const next = [...unrecorded]; next[i] = { ...next[i], amount: parseFloat(e.target.value) || 0 }; setUnrecorded(next); updateTicks(ticked, statementBalance, next); }}
                          className="w-[110px] border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[12.5px] text-right text-[var(--text)] outline-none"
                          placeholder="0.00"
                        />
                      </div>
                    ))}
                    <button onClick={() => setUnrecorded((prev) => [...prev, { description: '', amount: 0 }])} className="text-xs font-medium text-[var(--primary)] mt-2 hover:text-[var(--primary-hover)] transition-colors">
                      + Add unrecorded item
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[13px] text-[var(--text-muted)]">No open reconciliation for this account.</div>
                  <div className="field">
                    <label>Statement closing balance</label>
                    <input type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} className="input" placeholder="84,210.55" />
                  </div>
                  <button onClick={openReconciliation} disabled={busy} className="w-full rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]">
                    Start reconciliation
                  </button>
                </>
              )}
            </div>

            {/* Math block + verdict */}
            {openRec && verdict && (
              <div className="space-y-3">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 space-y-2">
                  <div className="flex justify-between text-[13px]"><span className="text-[var(--text-muted)]">Statement closing balance</span><span className="font-mono tabular-nums text-[var(--text)]">{N(Number(statementBalance))}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-[var(--text-muted)]">Ledger balance at {openRec.periodEnd}</span><span className="font-mono tabular-nums text-[var(--text)]">{N(verdict.ledgerBalance)}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-[var(--text-muted)]">Ticked in this session</span><span className="font-mono tabular-nums text-[var(--text)]">{verdict.tickedCount} lines</span></div>
                </div>

                {verdict.inBalance ? (
                  <div className="rounded-[var(--r-xl)] bg-[var(--success-soft)] border border-[var(--success-soft-border)] p-5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-bold text-[var(--success)]">In balance</span>
                      <span className="font-mono text-[22px] font-bold tabular-nums text-[var(--success)]">0.00</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1">Every statement line has a match in the ledger. Closing this reconciliation locks the period.</div>
                    <button onClick={close} disabled={busy} className="mt-3 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors">
                      Finish and lock {periodLabel}
                    </button>
                    <div className="text-xs text-[var(--text-faint)] mt-2">Later imports will skip rows inside it.</div>
                  </div>
                ) : (
                  <div className="rounded-[var(--r-xl)] bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] p-5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-bold text-[var(--warning)]">Out of balance by</span>
                      <span className="font-mono text-[22px] font-bold tabular-nums text-[var(--warning)]">{N(Math.abs(verdict.difference))}</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-1">
                      {verdict.causes.length > 0
                        ? `${verdict.causes[0]}${verdict.causes[1] ? `, and ${verdict.causes[1]}.` : '.'}`
                        : 'Untick anything the bank has not cleared and enter any statement charges missing from the ledger.'}
                    </div>
                    <button disabled className="mt-3 w-full rounded-full bg-[var(--neutral-soft)] text-[var(--text-muted)] text-[13px] font-semibold px-4 py-2 cursor-not-allowed">
                      Locking blocked — {N(Math.abs(verdict.difference))} unexplained
                    </button>
                    {!showVariance ? (
                      <button onClick={() => setShowVariance(true)} className="mt-2 text-xs font-medium text-[var(--warning)] hover:underline">
                        Close with a variance…
                      </button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <input value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Reason (required — recorded against the period)" className="w-full border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 text-[12.5px] text-[var(--text)] outline-none" />
                        <button onClick={close} disabled={busy || !varianceReason.trim()} className="rounded-full border border-[var(--warning)] text-[var(--warning)] text-[12.5px] font-semibold px-4 py-1.5 hover:bg-[var(--warning-soft)] transition-colors disabled:opacity-50">
                          Close with variance
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Reminder card */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-4 flex items-start gap-3">
              <Clock size={15} className="text-[var(--primary)] flex-none mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-[var(--text-strong)]">Import reminder</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  Without a bank feed the reminder is what keeps a period from being reconciled against a half-imported month.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
