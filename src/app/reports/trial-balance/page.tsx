'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, ExternalLink, Calendar, Download } from 'lucide-react';
import { exportTrialBalance, exportCaseWareTrialBalance } from '@/lib/export';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { format as formatDate, startOfMonth, subMonths, endOfMonth, startOfYear, startOfQuarter } from 'date-fns';

interface TBRow {
  code: string;
  name: string;
  type: string;
  detailType: string | null;
  gifiCode: string | null;
  debit: number;
  credit: number;
  hasActivity: boolean;
  link: string;
}

interface TBData {
  asOf: string;
  rows: TBRow[];
  grouped: Record<string, TBRow[]>;
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  accountCount: number;
  prior: (Omit<TBData, 'prior'>) | null;
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

export default function TrialBalancePage() {
  const router = useRouter();
  const [data, setData] = useState<TBData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fy = useFiscalYear();
  const defaultAsOf = fy.fiscalYearEnd || new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [activePreset, setActivePreset] = useState('FY End');
  const [compare, setCompare] = useState(false);
  useEffect(() => { if (fy.loaded && fy.fiscalYearEnd) { setAsOf(fy.fiscalYearEnd); setActivePreset('FY End'); } }, [fy.loaded, fy.fiscalYearEnd]);

  // Dynamic presets based on company fiscal year
  const fyStart = fy.fiscalYearStart ? new Date(fy.fiscalYearStart) : new Date(new Date().getFullYear(), 0, 1);
  const fyEnd = fy.fiscalYearEnd ? new Date(fy.fiscalYearEnd) : new Date(new Date().getFullYear(), 11, 31);
  const fyLabel = fy.fiscalYearStart ? `FY ${fyStart.getFullYear()}` : 'FY';

  const presets = [
    { label: 'Today', value: new Date().toISOString().slice(0, 10) },
    { label: 'End of last month', value: formatDate(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd') },
    { label: 'End of Q1', value: formatDate(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 2, 1)), 'yyyy-MM-dd') },
    { label: 'End of Q2', value: formatDate(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 5, 1)), 'yyyy-MM-dd') },
    { label: fyLabel, value: formatDate(fyEnd, 'yyyy-MM-dd') },
  ];

  function applyPreset(label: string, value: string) {
    setActivePreset(label);
    setAsOf(value);
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/trial-balance?asOf=${asOf}&compare=${compare}`);
      if (!res.ok) throw new Error('Failed to fetch trial balance');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [asOf, compare]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={28} /></div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="text-center py-16 text-[var(--text-muted)]">{error || 'No data'}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Trial Balance</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              As of {format(new Date(data.asOf), 'MMM d, yyyy')} · {data.accountCount} accounts · {data.isBalanced ? 'Balanced' : 'Unbalanced'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Compare prior year
          </label>
          <button onClick={() => exportTrialBalance(data)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 rounded-full transition-colors">
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => exportCaseWareTrialBalance(data)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--primary)] bg-[var(--primary-soft)] px-3 py-1.5 rounded-full transition-colors">
            <Download size={13} /> Export to CaseWare
          </button>
          <div className="flex items-center gap-1">
            <Calendar size={14} className="text-[var(--text-muted)]" />
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.label, p.value)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-colors',
                  activePreset === p.label
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--surface-3)] text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input type="text" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" value={asOf} onChange={(e) => { setAsOf(e.target.value); setActivePreset('Custom'); }} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)] font-mono" />
          <div className={cn(
            'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full font-medium',
            data.isBalanced ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'
          )}>
            {data.isBalanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {data.isBalanced ? 'Balanced' : 'Unbalanced'}
          </div>
        </div>
      </div>

      {/* Trial Balance Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                  <th className="text-left text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-24">Code</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3">Account</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-36">Debit</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-4 py-3 w-36">Credit</th>
                </tr>
              </thead>
              <tbody>
                {TYPE_ORDER.map((type) => {
                  const rows = data.grouped[type];
                  if (!rows || rows.length === 0) return null;
                  const typeTotalDebit = rows.reduce((s, r) => s + r.debit, 0);
                  const typeTotalCredit = rows.reduce((s, r) => s + r.credit, 0);

                  return (
                    <React.Fragment key={type}>
                      {/* Section header */}
                      <tr className="bg-[var(--surface-3)]">
                        <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-[var(--text-strong)]">
                          {TYPE_LABELS[type]}
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => router.push(row.link)}
                          className="border-b border-[var(--border)] hover:bg-[var(--primary-soft)] cursor-pointer transition-colors group"
                        >
                          <td className="px-4 py-2.5 text-sm font-mono text-[var(--text-muted)]">{row.code}</td>
                          <td className="px-4 py-2.5 text-sm">
                            <span className="font-medium text-[var(--text-strong)] group-hover:text-[var(--primary)] transition-colors">
                              {row.name}
                            </span>
                            {row.detailType && <span className="text-xs text-[var(--text-faint)] ml-1.5">· {row.detailType}</span>}
                            <ExternalLink size={12} className="inline ml-1.5 text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">
                            {row.debit > 0 ? money(row.debit) : <span className="text-[var(--text-faint)]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">
                            {row.credit > 0 ? money(row.credit) : <span className="text-[var(--text-faint)]">—</span>}
                          </td>
                        </tr>
                      ))}
                      {/* Type subtotal */}
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-1)]">
                        <td colSpan={2} className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] text-right">
                          Total {TYPE_LABELS[type]}
                        </td>
                        <td className="px-4 py-2 text-sm font-mono font-semibold tabular-nums text-right text-[var(--text-strong)]">
                          {typeTotalDebit > 0 ? money(typeTotalDebit) : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm font-mono font-semibold tabular-nums text-right text-[var(--text-strong)]">
                          {typeTotalCredit > 0 ? money(typeTotalCredit) : '—'}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}

                {/* Grand Total */}
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-2)]">
                  <td colSpan={2} className="px-4 py-3 text-base font-bold text-[var(--text-strong)] text-right">
                    Totals
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-base font-mono font-bold tabular-nums text-right',
                    data.isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                  )}>
                    {money(data.totalDebits)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-base font-mono font-bold tabular-nums text-right',
                    data.isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                  )}>
                    {money(data.totalCredits)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <p className="text-xs text-[var(--text-faint)] text-center mt-4">
        Click any account to open its General Ledger · Debits must equal Credits for a balanced trial balance
      </p>
      {(() => {
        const missingGifi = data.rows.filter((r) => !r.gifiCode).length;
        return missingGifi > 0 ? (
          <p className="text-xs text-[var(--warning)] text-center mt-2">
            {missingGifi} of {data.rows.length} accounts have no GIFI code set — add one in Chart of Accounts before filing a T2 or exporting to CaseWare for a complete mapping.
          </p>
        ) : null;
      })()}
    </AppShell>
  );
}
