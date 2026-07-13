'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, Printer, Download, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';

// ── Types ──

interface BVRow {
  glAccountCode: string; accountName: string; accountType: string;
  budgetAmount: number; actualAmount: number; variance: number; variancePct: number;
  isOverBudget: boolean; direction: 'up' | 'down' | 'flat'; favorable: boolean | null;
}
interface BVSection { rows: BVRow[]; totalBudget: number; totalActual: number; totalVariance: number; variancePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface BVData {
  companyName: string; currency: string;
  budget: { id: string; name: string; fiscalYear: number; period: string | null };
  generatedAt: string;
  sections: { income: BVSection; expenses: BVSection };
  totals: { budget: number; actual: number; variance: number; variancePct: number };
}

// ── Helpers ──

function VarPct({ pct, direction, favorable }: { pct: number; direction: string; favorable: boolean | null }) {
  if (direction === 'flat' || favorable === null) return <span className="text-[var(--text-faint)] text-xs">—</span>;
  const arrow = direction === 'up' ? '▲' : '▼';
  const color = favorable ? 'text-[var(--success)]' : 'text-[var(--danger)]';
  return <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', color)}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

// ── Budget List (when no budget selected) ──

function BudgetList() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/reports/budget-vs-actual').then(r => r.json()).then(j => setBudgets(j.data?.budgets || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="max-w-lg mx-auto py-12">
        <div className="text-center mb-8">
          <TrendingUp size={40} className="mx-auto text-[var(--text-muted)] mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text-strong)] mb-2">Budget vs Actual</h1>
          <p className="text-sm text-[var(--text-muted)]">Select a budget to compare against actuals.</p>
        </div>
        {loading ? <div className="flex items-center justify-center py-8"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
        : budgets.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--text-muted)] mb-4">No budgets found. Create one first.</p>
            <button onClick={() => router.push('/budgets')} className="text-sm text-[var(--primary)] font-medium">Go to Budgets</button>
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map((b: any) => (
              <button key={b.id} onClick={() => router.push(`/reports/budget-vs-actual?budgetId=${b.id}`)} className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors">
                <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] grid place-items-center flex-none"><TrendingUp size={18} className="text-[var(--primary)]" /></div>
                <div className="flex-1"><div className="text-sm font-semibold text-[var(--text-strong)]">{b.name}</div><div className="text-xs text-[var(--text-muted)]">FY {b.fiscalYear}{b.period ? ` · ${b.period}` : ''}</div></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Main Content ──

function BudgetVsActualContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const budgetId = searchParams.get('budgetId') || '';
  const [data, setData] = useState<BVData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  useEffect(() => {
    if (!budgetId) { setLoading(false); return; }
    fetch(`/api/reports/budget-vs-actual?budgetId=${budgetId}`)
      .then(r => r.json()).then(j => setData(j.data)).catch(() => {}).finally(() => setLoading(false));
  }, [budgetId]);

  if (!budgetId) return <BudgetList />;

  const now = new Date();
  const hasIncome = data && data.sections.income.rows.length > 0;
  const hasExpenses = data && data.sections.expenses.rows.length > 0;
  const currency = data?.currency || 'USD';
  const genAt = data?.generatedAt ? format(new Date(data.generatedAt), 'MMM d, yyyy') : format(now, 'MMM d, yyyy');

  return (
    <AppShell>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/reports')} className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"><ArrowLeft size={18} /></button>
          <span className="text-sm text-[var(--text-muted)]">Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)]">Budget vs Actual</strong></span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
        <button onClick={() => router.push('/reports/budget-vs-actual')} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] hover:border-[var(--border-strong)] text-[var(--text-muted)]">Change Budget</button>
        <div className="flex-1" />
        <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"><Printer size={14} className="text-[var(--text-muted)]"/> Print</button>
        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] ml-1"><input type="checkbox" checked={hideZeroBalances} onChange={e => setHideZeroBalances(e.target.checked)}/> Hide zero</label>
      </div>

      {loading ? <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[var(--text-muted)]"/></div>
      : data ? (
        <div className="max-w-[900px] mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-10 py-10 shadow-[var(--shadow-sm)] print:shadow-none print:border-none print:px-0 print:py-0">
            {/* Document Header */}
            <div className="text-center pb-4 border-b-2 border-[var(--text-strong)] print:border-gray-800">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">LedgerPro</div>
              <div className="text-[22px] font-bold text-[var(--text-strong)]">{data.companyName}</div>
              <div className="text-base font-semibold text-[var(--text)] mt-1">Budget vs Actual</div>
              <div className="font-mono text-[13px] text-[var(--text-muted)] mt-2.5">{data.budget.name} — FY {data.budget.fiscalYear}</div>
              <div className="font-mono text-xs text-[var(--text-faint)] mt-0.5">{currency} · Generated {genAt}</div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-4 my-6">
              {[
                { label: 'Budget', value: data.totals.budget, color: 'text-[var(--text-strong)]' },
                { label: 'Actual', value: data.totals.actual, color: data.totals.variance > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
                { label: 'Variance', value: data.totals.variance, color: data.totals.variance > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
                { label: 'Variance %', value: `${data.totals.variancePct}%`, color: data.totals.variancePct > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
              ].map(c => (
                <div key={c.label} className="text-center p-3 rounded-xl bg-[var(--surface-2)]">
                  <div className="text-xs text-[var(--text-muted)]">{c.label}</div>
                  <div className={cn('font-mono text-lg font-bold mt-1', c.color)}>{typeof c.value === 'number' ? money(c.value) : c.value}</div>
                </div>
              ))}
            </div>

            {/* Statement Table */}
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono">Account</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[110px]">Budget</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[110px]">Actual</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[100px]">Variance</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[80px]">%</th>
                </tr>
              </thead>
              <tbody>
                {/* Income */}
                {hasIncome && (
                  <>
                    <tr><td colSpan={5} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">Income</td></tr>
                    {(hideZeroBalances ? data.sections.income.rows.filter(r => r.actualAmount !== 0 || r.budgetAmount !== 0) : data.sections.income.rows).map(r => (
                      <tr key={r.glAccountCode} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${r.glAccountCode}&name=${encodeURIComponent(r.accountName)}`)}>
                        <td className="py-1.5 text-sm text-[var(--text)] pl-2">{r.accountName}<span className="text-xs text-[var(--text-muted)] ml-1.5">{r.glAccountCode}</span></td>
                        <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(r.budgetAmount)}</td>
                        <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(r.actualAmount)}</td>
                        <td className={cn('py-1.5 text-sm font-mono tabular-nums text-right', r.variance > 0 ? 'text-[var(--danger)]' : r.variance < 0 ? 'text-[var(--success)]' : 'text-[var(--text)]')}>{money(r.variance, true)}</td>
                        <td className="py-1.5 text-right"><VarPct pct={r.variancePct} direction={r.direction} favorable={r.favorable} /></td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--border)]">
                      <td className="py-2.5 text-sm font-bold text-[var(--text-strong)] pl-2">Total Income</td>
                      <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.income.totalBudget)}</td>
                      <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.income.totalActual)}</td>
                      <td className={cn('py-2.5 text-sm font-mono font-bold tabular-nums text-right', data.sections.income.totalVariance > 0 ? 'text-[var(--danger)]' : data.sections.income.totalVariance < 0 ? 'text-[var(--success)]' : 'text-[var(--text-strong)]')}>{money(data.sections.income.totalVariance, true)}</td>
                      <td className="py-2.5 text-right"><VarPct pct={data.sections.income.variancePct} direction={data.sections.income.direction} favorable={data.sections.income.favorable} /></td>
                    </tr>
                  </>
                )}

                {/* Expenses */}
                {hasExpenses && (
                  <>
                    <tr><td colSpan={5} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">Expenses</td></tr>
                    {(hideZeroBalances ? data.sections.expenses.rows.filter(r => r.actualAmount !== 0 || r.budgetAmount !== 0) : data.sections.expenses.rows).map(r => (
                      <tr key={r.glAccountCode} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${r.glAccountCode}&name=${encodeURIComponent(r.accountName)}`)}>
                        <td className="py-1.5 text-sm text-[var(--text)] pl-2">{r.accountName}<span className="text-xs text-[var(--text-muted)] ml-1.5">{r.glAccountCode}</span></td>
                        <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(r.budgetAmount)}</td>
                        <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(r.actualAmount)}</td>
                        <td className={cn('py-1.5 text-sm font-mono tabular-nums text-right', r.variance < 0 ? 'text-[var(--success)]' : r.variance > 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>{money(r.variance, true)}</td>
                        <td className="py-1.5 text-right"><VarPct pct={r.variancePct} direction={r.direction} favorable={r.favorable} /></td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--border)]">
                      <td className="py-2.5 text-sm font-bold text-[var(--text-strong)] pl-2">Total Expenses</td>
                      <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.expenses.totalBudget)}</td>
                      <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.expenses.totalActual)}</td>
                      <td className={cn('py-2.5 text-sm font-mono font-bold tabular-nums text-right', data.sections.expenses.totalVariance < 0 ? 'text-[var(--success)]' : data.sections.expenses.totalVariance > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]')}>{money(data.sections.expenses.totalVariance, true)}</td>
                      <td className="py-2.5 text-right"><VarPct pct={data.sections.expenses.variancePct} direction={data.sections.expenses.direction} favorable={data.sections.expenses.favorable} /></td>
                    </tr>
                  </>
                )}

                {/* Grand Total */}
                <tr className="border-t-2 border-b-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50">
                  <td className="py-3.5 text-base font-bold text-[var(--text-strong)] pl-2">Net Result</td>
                  <td className="py-3.5 text-base font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.totals.budget)}</td>
                  <td className="py-3.5 text-base font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.totals.actual)}</td>
                  <td className={cn('py-3.5 text-base font-mono font-bold tabular-nums text-right', data.totals.variance > 0 ? 'text-[var(--success)]' : data.totals.variance < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]')}>{money(data.totals.variance, true)}</td>
                  <td className="py-3.5 text-right font-mono text-sm font-bold">{data.totals.variancePct.toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-faint)] mt-6 pt-3 border-t border-[var(--border)] print:block">
              <span>{data.companyName} · Budget vs Actual</span>
              <span>Page 1 of 1 · Confidential</span>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function BudgetVsActualPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>}>
      <BudgetVsActualContent />
    </Suspense>
  );
}
