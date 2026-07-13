'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, endOfMonth, subMonths } from 'date-fns';
import { ArrowLeft, Loader2, Printer, Download, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { parseLocalDate, formatReportPeriod } from '@/lib/reporting';
import { exportTrialBalance, exportCaseWareTrialBalance } from '@/lib/export';

// ── Types ──

interface TBRow {
  code: string; name: string; type: string; detailType: string | null; gifiCode: string | null;
  debit: number; credit: number;
  priorDebit: number; priorCredit: number;
  changePctDebit: number; changePctCredit: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
  hasActivity: boolean;
}
interface TBSection { rows: TBRow[]; totalDebit: number; totalCredit: number; priorTotalDebit: number; priorTotalCredit: number; changePctDebit: number; changePctCredit: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface TBData {
  companyName: string; currency: string;
  period: { asOf: string; label: string };
  comparisonLabel: string; comparisonMode: string; generatedAt: string;
  sections: Record<string, TBSection>;
  totalDebits: number; totalCredits: number; isBalanced: boolean; accountCount: number;
}
type CompareMode = 'none' | 'prior_period' | 'prior_year';

const TYPE_LABELS: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

// ── Dropdown hook ──

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return { open, setOpen, ref };
}

// ── Helpers ──

function ChangePct({ pct, direction, favorable }: { pct: number; direction: string; favorable: boolean | null }) {
  if (direction === 'flat' || favorable === null) return <span className="text-[var(--text-faint)]">—</span>;
  const arrow = direction === 'up' ? '▲' : '▼';
  const color = favorable ? 'text-[var(--success)]' : 'text-[var(--danger)]';
  return <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', color)}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

// ── Main ──

export default function TrialBalancePage() {
  const router = useRouter();
  const fy = useFiscalYear();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fyStart = fy.fiscalYearStart ? parseLocalDate(fy.fiscalYearStart) : new Date(now.getFullYear(), 0, 1);
  const fyEnd = fy.fiscalYearEnd ? parseLocalDate(fy.fiscalYearEnd) : new Date(now.getFullYear(), 11, 31);
  const fyLabel = fy.defaultYear ? `FY ${fy.defaultYear}` : 'FY';

  type PresetKey = 'today' | 'last_month_end' | 'q1_end' | 'q2_end' | 'fy_end' | 'custom';
  const [preset, setPreset] = useState<PresetKey>('fy_end');
  const [asOf, setAsOf] = useState(format(fyEnd, 'yyyy-MM-dd'));
  const [customDate, setCustomDate] = useState(asOf);
  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);
  const [data, setData] = useState<TBData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const periodDd = useDropdown(); const compareDd = useDropdown(); const exportDd = useDropdown();

  useEffect(() => { if (fy.loaded && fy.fiscalYearEnd) { setAsOf(fy.fiscalYearEnd); setPreset('fy_end'); } }, [fy.loaded, fy.fiscalYearEnd]);

  function applyPreset(key: PresetKey) {
    setPreset(key); periodDd.setOpen(false);
    let d: string;
    switch (key) {
      case 'today': d = today; break;
      case 'last_month_end': d = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'); break;
      case 'q1_end': d = format(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 2, 1)), 'yyyy-MM-dd'); break;
      case 'q2_end': d = format(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 5, 1)), 'yyyy-MM-dd'); break;
      case 'fy_end': d = format(fyEnd, 'yyyy-MM-dd'); break;
      case 'custom': d = customDate; break;
      default: d = asOf;
    }
    setAsOf(d);
  }

  function applyCompare(mode: CompareMode) { setCompareMode(mode); compareDd.setOpen(false); }

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/reports/trial-balance?asOf=${asOf}&compare=${compareMode}`);
      if (!res.ok) throw new Error('Failed');
      setData((await res.json()).data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [asOf, compareMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasComparison = compareMode !== 'none' && !!data?.comparisonLabel;
  const periodLabel = data?.period?.label || asOf;
  const currency = data?.currency || 'USD';
  const genAt = data?.generatedAt ? format(new Date(data.generatedAt), 'MMM d, yyyy') : format(now, 'MMM d, yyyy');

  return (
    <AppShell>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/reports')} className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"><ArrowLeft size={18} /></button>
          <span className="text-sm text-[var(--text-muted)]">Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)]">Trial Balance</strong></span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
        {/* Period dropdown */}
        <div className="relative" ref={periodDd.ref}>
          <button onClick={() => periodDd.setOpen(!periodDd.open)} className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]">
            <span className="text-[var(--text-muted)]">{preset === 'today' ? 'Today' : preset === 'last_month_end' ? 'End of last month' : preset === 'q1_end' ? 'End of Q1' : preset === 'q2_end' ? 'End of Q2' : preset === 'fy_end' ? fyLabel : 'Custom'}</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {periodDd.open && (
            <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
              {([['today','Today'],['last_month_end','End of last month'],['q1_end','End of Q1'],['q2_end','End of Q2'],['fy_end',fyLabel],['custom','Custom…']] as [PresetKey,string][]).map(([k,l]) => (
                <button key={k} onClick={() => applyPreset(k)} className={cn('w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] flex items-center gap-2', preset===k ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]')}>{preset===k && '✓'} {l}</button>
              ))}
            </div>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
            <button onClick={() => { setAsOf(customDate); }} className="text-xs bg-[var(--primary)] text-white px-3 py-1.5 rounded-full font-medium">Apply</button>
          </div>
        )}
        <div className="flex-1" />
        {/* Comparison */}
        <div className="relative" ref={compareDd.ref}>
          <button onClick={() => compareDd.setOpen(!compareDd.open)} className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]">
            <span className="text-[var(--text-muted)]">{compareMode==='prior_period'?'vs. Prior period':compareMode==='prior_year'?'vs. Prior year':'No comparison'}</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {compareDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
              {(['prior_period','prior_year','none'] as CompareMode[]).map(m => (
                <button key={m} onClick={() => applyCompare(m)} className={cn('w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] flex items-center gap-2', compareMode===m ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]')}>{compareMode===m && '✓'} {m==='prior_period'?'Prior period':m==='prior_year'?'Prior year':'No comparison'}</button>
              ))}
            </div>
          )}
        </div>
        {/* Export */}
        <div className="relative" ref={exportDd.ref}>
          <button onClick={() => exportDd.setOpen(!exportDd.open)} className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"><Download size={14} className="text-[var(--text-muted)]"/><span className="text-[var(--text-muted)]">Export</span><ChevronDown size={14} className="text-[var(--text-muted)]"/></button>
          {exportDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[180px] z-20 overflow-hidden">
              {[['pdf','Export as PDF'],['excel','Export as Excel'],['csv','Export as CSV']].map(([k,l]) => (
                <button key={k} onClick={() => { exportDd.setOpen(false); if(k==='pdf') window.print(); else if(data) { if(k==='csv') exportTrialBalance(data); else exportCaseWareTrialBalance(data); } }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] text-[var(--text)]">{l}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"><Printer size={14} className="text-[var(--text-muted)]"/> Print</button>
        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] ml-1"><input type="checkbox" checked={hideZeroBalances} onChange={e => setHideZeroBalances(e.target.checked)}/> Hide zero</label>
      </div>

      {/* Content */}
      {loading ? <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[var(--text-muted)]"/></div>
      : error ? <div className="py-20 text-center text-[var(--text-muted)]">{error}</div>
      : data ? (
        <div className="max-w-[900px] mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-10 py-10 shadow-[var(--shadow-sm)] print:shadow-none print:border-none print:px-0 print:py-0">
            {/* Document Header */}
            <div className="text-center pb-4 border-b-2 border-[var(--text-strong)] print:border-gray-800">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">LedgerPro</div>
              <div className="text-[22px] font-bold text-[var(--text-strong)]">{data.companyName}</div>
              <div className="text-base font-semibold text-[var(--text)] mt-1">Trial Balance</div>
              <div className="font-mono text-[13px] text-[var(--text-muted)] mt-2.5">As at {periodLabel}</div>
              <div className="font-mono text-xs text-[var(--text-faint)] mt-0.5">Accrual basis · {currency} · Generated {genAt}</div>
            </div>

            {/* Statement Table */}
            <table className="w-full mt-4">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[70px]">Code</th>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono">Account</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[110px]">Debit</th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[110px]">Credit</th>
                  {hasComparison && <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[80px]">Δ Dt</th>}
                  {hasComparison && <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[80px]">Δ Cr</th>}
                </tr>
              </thead>
              <tbody>
                {TYPE_ORDER.map(type => {
                  const section = data.sections[type];
                  if (!section) return null;
                  const rows = hideZeroBalances ? section.rows.filter(r => r.debit !== 0 || r.credit !== 0) : section.rows;
                  if (rows.length === 0) return null;
                  const sDebit = rows.reduce((s,r) => s + r.debit, 0);
                  const sCredit = rows.reduce((s,r) => s + r.credit, 0);
                  return (
                    <React.Fragment key={type}>
                      <tr><td colSpan={hasComparison ? 6 : 4} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">{TYPE_LABELS[type]}</td></tr>
                      {rows.map(r => (
                        <tr key={r.code} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${r.code}&name=${encodeURIComponent(r.name)}&start=${fyStart.toISOString().slice(0,10)}&end=${asOf}`)}>
                          <td className="py-1.5 text-xs font-mono text-[var(--text-muted)]">{r.code}</td>
                          <td className="py-1.5 text-sm text-[var(--text)] pl-2">{r.name}{r.detailType && <span className="text-xs text-[var(--text-faint)] ml-1">· {r.detailType}</span>}</td>
                          <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{r.debit > 0 ? money(r.debit) : <span className="text-[var(--text-faint)]">—</span>}</td>
                          <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{r.credit > 0 ? money(r.credit) : <span className="text-[var(--text-faint)]">—</span>}</td>
                          {hasComparison && <td className="py-1.5 text-right"><ChangePct pct={r.changePctDebit} direction={r.direction} favorable={r.favorable}/></td>}
                          {hasComparison && <td className="py-1.5 text-right"><ChangePct pct={r.changePctCredit} direction={r.direction} favorable={r.favorable}/></td>}
                        </tr>
                      ))}
                      <tr className="border-t border-[var(--border)]">
                        <td colSpan={2} className="py-2.5 text-sm font-bold text-[var(--text-strong)] text-right">Total {TYPE_LABELS[type]}</td>
                        <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{sDebit > 0 ? money(sDebit) : '—'}</td>
                        <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{sCredit > 0 ? money(sCredit) : '—'}</td>
                        {hasComparison && <td className="py-2.5 text-right"><ChangePct pct={section.changePctDebit} direction={section.direction} favorable={section.favorable}/></td>}
                        {hasComparison && <td className="py-2.5 text-right"><ChangePct pct={section.changePctCredit} direction={section.direction} favorable={section.favorable}/></td>}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* Grand Total */}
                <tr className="border-t-2 border-b-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50">
                  <td colSpan={2} className="py-3.5 text-base font-bold text-[var(--text-strong)] text-right">Totals</td>
                  <td className={cn('py-3.5 text-base font-mono font-bold tabular-nums text-right', data.isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(data.totalDebits)}</td>
                  <td className={cn('py-3.5 text-base font-mono font-bold tabular-nums text-right', data.isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(data.totalCredits)}</td>
                  {hasComparison && <td colSpan={2} className="py-3.5 text-right text-xs text-[var(--text-muted)]">Debits = Credits {data.isBalanced ? '✓' : '⚠'}</td>}
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-faint)] mt-6 pt-3 border-t border-[var(--border)] print:block">
              <span>{data.companyName} · Trial Balance</span>
              <span>Page 1 of 1 · Confidential</span>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
