'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, startOfQuarter, endOfQuarter } from 'date-fns';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Loader2, FileText, Receipt, Landmark, Calendar, Download, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { exportGL } from '@/lib/export';

interface GLRow {
  id: string;
  date: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  sourceLink: string | null;
  debit: number;
  credit: number;
  glAccountCode: string;
  balance: number;
  contraAccounts: { code: string; description: string | null; debit: number; credit: number; link: string }[];
}

interface GLGroup {
  glAccountCode: string;
  accountName: string;
  accountType: string;
  entryCount: number;
  totalDebit: number;
  totalCredit: number;
  netChange: number;
  link: string;
}

interface GLData {
  account: { code: string; name: string; type: string } | null;
  period: { startDate: string; endDate: string };
  balances: { opening: number; closing: number };
  rows: GLRow[];
  grouped: GLGroup[] | null;
  totals: { debits: number; credits: number };
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const DATE_PRESETS = [
  { label: 'This month', get: () => ({ start: format(startOfMonth(new Date()), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last month', get: () => ({ start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'), end: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd') }) },
  { label: 'This quarter', get: () => ({ start: format(startOfQuarter(new Date()), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Year to date', get: () => ({ start: format(startOfYear(new Date()), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'FY 2026', get: () => ({ start: '2026-01-01', end: '2026-12-31' }) },
  { label: 'Custom', get: () => ({ start: '2026-01-01', end: new Date().toISOString().slice(0, 10) }) },
];

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  invoice: <FileText size={14} />,
  bill: <Receipt size={14} />,
  payment: <Landmark size={14} />,
  transfer: <Landmark size={14} />,
  manual: <FileText size={14} />,
};

function GLContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code') || '';
  const name = searchParams.get('name') || '';
  const urlStart = searchParams.get('start');
  const urlEnd = searchParams.get('end');

  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(urlStart || '2026-01-01');
  const [endDate, setEndDate] = useState(urlEnd || today);
  const [activePreset, setActivePreset] = useState(urlStart ? 'Custom' : 'FY 2026');
  const [data, setData] = useState<GLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ code, start: startDate, end: endDate, page: String(page), limit: '100' });
      const res = await fetch(`/api/reports/general-ledger?${params}`);
      if (!res.ok) throw new Error('Failed to fetch general ledger');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [code, startDate, endDate, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function applyPreset(preset: typeof DATE_PRESETS[0]) {
    const { start, end } = preset.get();
    setStartDate(start);
    setEndDate(end);
    setActivePreset(preset.label);
    setPage(1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={28} /></div>
    );
  }

  if (error || !data) {
    return <div className="text-center py-16 text-[var(--text-muted)]">{error || 'No data'}</div>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports/trial-balance')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
              General Ledger
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {data.account ? (
                <span>
                  <span className="font-medium text-[var(--text)]">{data.account.code} — {data.account.name}</span>
                  <span className={cn(
                    'ml-2 px-1.5 py-0.5 rounded text-xs font-medium',
                    data.account.type === 'asset' || data.account.type === 'expense'
                      ? 'bg-[var(--primary-soft)] text-[var(--accent)]'
                      : 'bg-[var(--success-soft)] text-[var(--success)]'
                  )}>
                    {data.account.type}
                  </span>
                </span>
              ) : 'All accounts'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <button onClick={() => exportGL(data)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 rounded-full transition-colors">
            <Download size={13} /> Export CSV
          </button>
          {data.pagination.total} entries · Page {page} of {data.pagination.totalPages}
        </div>
      </div>

      {/* Date presets */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Calendar size={14} className="text-[var(--text-muted)]" />
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset)}
            className={cn(
              'text-xs px-3 py-1.5 rounded-full font-medium transition-colors',
              activePreset === preset.label
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {preset.label}
          </button>
        ))}
        {activePreset === 'Custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActivePreset('Custom'); setPage(1); }} className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
            <span className="text-xs text-[var(--text-faint)]">to</span>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActivePreset('Custom'); setPage(1); }} className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
          </div>
        )}
      </div>

      {/* Summary bar */}
      {data.account && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card><CardBody className="p-3 text-center">
            <div className="text-xs text-[var(--text-muted)]">Opening Balance</div>
            <div className="text-lg font-mono font-bold text-[var(--text-strong)]">{money(data.balances.opening)}</div>
            <div className="text-micro text-[var(--text-faint)] mt-0.5">Before {format(new Date(startDate), 'MMM d')}</div>
          </CardBody></Card>
          <Card><CardBody className="p-3 text-center">
            <div className="text-xs text-[var(--text-muted)]">Period Debits</div>
            <div className="text-lg font-mono font-bold text-[var(--text)]">{money(data.totals.debits)}</div>
          </CardBody></Card>
          <Card><CardBody className="p-3 text-center">
            <div className="text-xs text-[var(--text-muted)]">Period Credits</div>
            <div className="text-lg font-mono font-bold text-[var(--text)]">{money(data.totals.credits)}</div>
          </CardBody></Card>
          <Card><CardBody className="p-3 text-center">
            <div className="text-xs text-[var(--text-muted)]">Closing Balance</div>
            <div className={cn('text-lg font-mono font-bold', data.balances.closing >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(data.balances.closing, true)}</div>
            <div className="text-micro text-[var(--text-faint)] mt-0.5">As of {format(new Date(endDate), 'MMM d')}</div>
          </CardBody></Card>
        </div>
      )}

      {/* Grouped view — all accounts */}
      {data.grouped && data.grouped.length > 0 && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold text-[var(--text-strong)]">General Ledger — All Accounts ({data.grouped.length} active)</h2></CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {data.grouped.map((g) => (
                <div
                  key={g.glAccountCode}
                  onClick={() => router.push(g.link)}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--primary-soft)] cursor-pointer transition-colors group"
                >
                  <div className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    g.accountType === 'asset' || g.accountType === 'expense' ? 'bg-[var(--primary)]' : 'bg-[var(--success)]'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-strong)] group-hover:text-[var(--primary)] transition-colors">
                      {g.glAccountCode} — {g.accountName}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      {g.entryCount} entr{g.entryCount !== 1 ? 'ies' : 'y'} · {g.accountType}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums font-medium text-[var(--text)]">
                      {g.netChange !== 0 && (
                        <span className={g.netChange >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                          {g.netChange >= 0 ? '+' : '−'}{money(Math.abs(g.netChange))}
                        </span>
                      )}
                      {g.netChange === 0 && <span className="text-[var(--text-faint)]">—</span>}
                    </div>
                    <div className="text-xs text-[var(--text-faint)]">
                      D {money(g.totalDebit)} / C {money(g.totalCredit)}
                    </div>
                  </div>
                  <ExternalLink size={14} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Detail Lines — single account */}
      {data.rows && data.rows.length > 0 && (
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="text-left text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-28">Date</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3">Description / Contra</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-28">Source</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-32">Debit</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-32">Credit</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-36">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-[var(--text-muted)]">No journal entries found for this account in the selected period.</td></tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-3)] transition-colors group">
                      <td className="px-4 py-3 text-sm text-[var(--text)]">
                        {format(new Date(row.date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-strong)]">{row.description}</div>
                        {row.contraAccounts.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {row.contraAccounts.map((contra, i) => (
                              <button
                                key={i}
                                onClick={() => router.push(contra.link)}
                                className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] bg-[var(--surface-3)] hover:bg-[var(--primary-soft)] px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-1"
                              >
                                {contra.code} <ExternalLink size={10} />
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.sourceLink ? (
                          <button
                            onClick={() => router.push(row.sourceLink!)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)] bg-[var(--primary-soft)] px-2 py-1 rounded-full transition-colors"
                          >
                            {SOURCE_ICONS[row.sourceType] || <FileText size={14} />}
                            {row.sourceId || row.sourceType}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)] capitalize">{row.sourceType}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono tabular-nums text-right text-[var(--text)]">
                        {row.debit > 0 ? money(row.debit) : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono tabular-nums text-right text-[var(--text)]">
                        {row.credit > 0 ? money(row.credit) : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono tabular-nums text-right font-medium text-[var(--text-strong)]">
                        {money(row.balance, true)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-2)]">
                  <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-[var(--text-strong)] text-right">Totals</td>
                  <td className="px-4 py-3 text-sm font-mono font-bold tabular-nums text-right text-[var(--text)]">{money(data.totals.debits)}</td>
                  <td className="px-4 py-3 text-sm font-mono font-bold tabular-nums text-right text-[var(--text)]">{money(data.totals.credits)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardBody>
      </Card>
      )}

      {/* Empty state when no data at all */}
      {(!data.grouped || data.grouped.length === 0) && (!data.rows || data.rows.length === 0) && (
        <Card><CardBody className="p-12 text-center text-[var(--text-muted)]">No journal entries found for the selected period.</CardBody></Card>
      )}

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg hover:bg-[var(--surface-3)] disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <span className="text-sm text-[var(--text-muted)] px-2">{page} of {data.pagination.totalPages}</span>
          <button
            onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))}
            disabled={page >= data.pagination.totalPages}
            className="p-2 rounded-lg hover:bg-[var(--surface-3)] disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={18} className="text-[var(--text-muted)]" />
          </button>
        </div>
      )}
    </>
  );
}

export default function GeneralLedgerPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={28} /></div>}>
        <GLContent />
      </Suspense>
    </AppShell>
  );
}
