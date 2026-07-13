'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, Printer, Download, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { parseLocalDate } from '@/lib/reporting';

// ── Types ──

interface AccountLine { code: string; name: string; detailType: string | null; balance: number; priorBalance: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface SubSection { accounts: AccountLine[]; total: number; priorTotal: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface EquityGroup { accounts: AccountLine[]; total: number; priorTotal: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }

interface BSData {
  companyName: string; currency: string;
  period: { asOf: string; label: string };
  comparisonLabel: string; comparisonMode: string; generatedAt: string;
  sections: {
    assets: { current: SubSection; nonCurrent: SubSection; total: number; priorTotal: number; changePct: number };
    liabilities: { current: SubSection; nonCurrent: SubSection; total: number; priorTotal: number; changePct: number };
    equity: Record<string, EquityGroup>;
    totalEquity: number; priorTotalEquity: number;
    totalLiabilitiesAndEquity: number; priorTotalLiabilitiesAndEquity: number;
  };
  isBalanced: boolean;
}
type CompareMode = 'none' | 'prior_period' | 'prior_year';

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
  if (direction === 'flat' || favorable === null) return <span className="text-[var(--text-faint)] text-xs">—</span>;
  const arrow = direction === 'up' ? '▲' : '▼';
  const color = favorable ? 'text-[var(--success)]' : 'text-[var(--danger)]';
  return <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', color)}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

function SectionTotal({ label, total, priorTotal, hasComparison, cmp }: { label: string; total: number; priorTotal?: number; hasComparison: boolean; cmp?: { changePct: number; direction: string; favorable: boolean | null } }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 border-t border-[var(--border)]">
      <span className="text-sm font-bold text-[var(--text-strong)]">{label}</span>
      <div className="flex items-center gap-3">
        {hasComparison && priorTotal !== undefined && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[90px] text-right">{money(priorTotal)}</span>}
        {hasComparison && cmp && <ChangePct pct={cmp.changePct} direction={cmp.direction} favorable={cmp.favorable} />}
        <span className="text-sm font-mono font-bold tabular-nums text-[var(--text-strong)] w-[90px] text-right">{money(total)}</span>
      </div>
    </div>
  );
}

// ── Main ──

export default function BalanceSheetPage() {
  const router = useRouter();
  const fy = useFiscalYear();
  const now = new Date(); const today = now.toISOString().slice(0, 10);
  const fyEnd = fy.fiscalYearEnd ? parseLocalDate(fy.fiscalYearEnd) : new Date(now.getFullYear(), 11, 31);
  const fyLabel = fy.defaultYear ? `FY ${fy.defaultYear}` : 'FY';

  const [asOf, setAsOf] = useState(fy.fiscalYearEnd || today);
  const [preset, setPreset] = useState('fy_end');
  const [compareMode, setCompareMode] = useState<CompareMode>('none');
  const [hideZeroBalances, setHideZeroBalances] = useState(false);
  const [data, setData] = useState<BSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const periodDd = useDropdown(); const compareDd = useDropdown(); const exportDd = useDropdown();

  useEffect(() => { if (fy.loaded && fy.fiscalYearEnd) { setAsOf(fy.fiscalYearEnd); setPreset('fy_end'); } }, [fy.loaded, fy.fiscalYearEnd]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/reports/balance-sheet?asOf=${asOf}&compare=${compareMode}`);
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

  // Zero-balance filter
  const filterAccts = (accounts: AccountLine[]) => hideZeroBalances ? accounts.filter(a => a.balance !== 0) : accounts;
  const sumAccts = (accounts: AccountLine[]) => accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <AppShell>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/reports')} className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"><ArrowLeft size={18} /></button>
          <span className="text-sm text-[var(--text-muted)]">Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)]">Balance Sheet</strong></span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
        <div className="relative" ref={periodDd.ref}>
          <button onClick={() => periodDd.setOpen(!periodDd.open)} className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]">
            <span className="text-[var(--text-muted)]">{preset === 'today' ? 'Today' : preset === 'fy_end' ? fyLabel : 'Custom'}</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {periodDd.open && (
            <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[180px] z-20 overflow-hidden">
              {[['today','Today'],['fy_end',fyLabel],['custom','Custom…']].map(([k,l]) => (
                <button key={k} onClick={() => { periodDd.setOpen(false); setPreset(k); if (k==='today') setAsOf(today); }} className={cn('w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] flex items-center gap-2', preset===k ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]')}>{preset===k && '✓'} {l}</button>
              ))}
            </div>
          )}
        </div>
        {preset === 'custom' && <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)] font-mono" />}
        <div className="flex-1" />
        <div className="relative" ref={compareDd.ref}>
          <button onClick={() => compareDd.setOpen(!compareDd.open)} className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]">
            <span className="text-[var(--text-muted)]">{compareMode==='prior_period'?'vs. Prior period':compareMode==='prior_year'?'vs. Prior year':'No comparison'}</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {compareDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
              {(['prior_period','prior_year','none'] as CompareMode[]).map(m => (
                <button key={m} onClick={() => { setCompareMode(m); compareDd.setOpen(false); }} className={cn('w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] flex items-center gap-2', compareMode===m ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]')}>{compareMode===m && '✓'} {m==='prior_period'?'Prior period':m==='prior_year'?'Prior year':'No comparison'}</button>
              ))}
            </div>
          )}
        </div>
        <div className="relative" ref={exportDd.ref}>
          <button onClick={() => exportDd.setOpen(!exportDd.open)} className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"><Download size={14} className="text-[var(--text-muted)]"/><span className="text-[var(--text-muted)]">Export</span><ChevronDown size={14} className="text-[var(--text-muted)]"/></button>
          {exportDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[180px] z-20 overflow-hidden">
              {[['pdf','Export as PDF'],['csv','Export as CSV']].map(([k,l]) => (
                <button key={k} onClick={() => { exportDd.setOpen(false); if(k==='pdf') window.print(); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] text-[var(--text)]">{l}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"><Printer size={14} className="text-[var(--text-muted)]"/> Print</button>
        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] ml-1"><input type="checkbox" checked={hideZeroBalances} onChange={e => setHideZeroBalances(e.target.checked)}/> Hide zero</label>
        {data && (
          <div className={cn('flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full font-medium ml-2', data.isBalanced ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]')}>
            {data.isBalanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{data.isBalanced ? 'Balanced' : 'Unbalanced'}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-[var(--text-muted)]"/></div>
      : error ? <div className="py-20 text-center text-[var(--text-muted)]">{error}</div>
      : data ? (
        <div className="max-w-[1000px] mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-10 py-10 shadow-[var(--shadow-sm)] print:shadow-none print:border-none print:px-0 print:py-0">
            {/* Document Header */}
            <div className="text-center pb-4 border-b-2 border-[var(--text-strong)] print:border-gray-800">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">LedgerPro</div>
              <div className="text-[22px] font-bold text-[var(--text-strong)]">{data.companyName}</div>
              <div className="text-base font-semibold text-[var(--text)] mt-1">Balance Sheet</div>
              <div className="font-mono text-[13px] text-[var(--text-muted)] mt-2.5">As at {periodLabel}</div>
              <div className="font-mono text-xs text-[var(--text-faint)] mt-0.5">Accrual basis · {currency} · Generated {genAt}</div>
            </div>

            {/* Two-column grid */}
            <div className="grid grid-cols-2 gap-6 mt-4">
              {/* ASSETS */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">Assets</h3>
                {/* Current Assets */}
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono mb-1">Current Assets</div>
                {filterAccts(data.sections.assets.current.accounts).map(a => (
                  <div key={a.code} onClick={() => router.push(`/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}&start=${fy.fiscalYearStart || '2020-01-01'}&end=${asOf}`)} className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--primary-soft)] group">
                    <div className="flex-1 min-w-0"><span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--primary)]">{a.name}</span><span className="text-xs text-[var(--text-muted)] ml-1.5">{a.code}</span></div>
                    <div className="flex items-center gap-2 ml-3">
                      {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(a.priorBalance)}</span>}
                      {hasComparison && <ChangePct pct={a.changePct} direction={a.direction} favorable={a.favorable} />}
                      <span className="text-sm font-mono tabular-nums text-[var(--text)] w-[90px] text-right">{money(a.balance)}</span>
                    </div>
                  </div>
                ))}
                <SectionTotal label="Total Current Assets" total={hideZeroBalances ? sumAccts(filterAccts(data.sections.assets.current.accounts)) : data.sections.assets.current.total} priorTotal={data.sections.assets.current.priorTotal} hasComparison={hasComparison} cmp={data.sections.assets.current} />

                {/* Non-Current Assets */}
                {filterAccts(data.sections.assets.nonCurrent.accounts).length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono mt-4 mb-1">Non-Current Assets</div>
                    {filterAccts(data.sections.assets.nonCurrent.accounts).map(a => (
                      <div key={a.code} onClick={() => router.push(`/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}&start=${fy.fiscalYearStart || '2020-01-01'}&end=${asOf}`)} className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--primary-soft)] group">
                        <div className="flex-1 min-w-0"><span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--primary)]">{a.name}</span><span className="text-xs text-[var(--text-muted)] ml-1.5">{a.code}</span></div>
                        <div className="flex items-center gap-2 ml-3">
                          {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(a.priorBalance)}</span>}
                          {hasComparison && <ChangePct pct={a.changePct} direction={a.direction} favorable={a.favorable} />}
                          <span className="text-sm font-mono tabular-nums text-[var(--text)] w-[90px] text-right">{money(a.balance)}</span>
                        </div>
                      </div>
                    ))}
                    <SectionTotal label="Total Non-Current Assets" total={hideZeroBalances ? sumAccts(filterAccts(data.sections.assets.nonCurrent.accounts)) : data.sections.assets.nonCurrent.total} priorTotal={data.sections.assets.nonCurrent.priorTotal} hasComparison={hasComparison} cmp={data.sections.assets.nonCurrent} />
                  </>
                )}

                {/* Total Assets */}
                <div className="flex items-center justify-between py-3.5 px-3 mt-2 border-t-2 border-[var(--text-strong)]">
                  <span className="text-base font-bold text-[var(--text-strong)]">Total Assets</span>
                  <div className="flex items-center gap-2">
                    {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(data.sections.assets.priorTotal)}</span>}
                    {hasComparison && <ChangePct pct={data.sections.assets.changePct} direction={data.sections.assets.changePct > 0.005 ? 'up' : data.sections.assets.changePct < -0.005 ? 'down' : 'flat'} favorable={data.sections.assets.changePct > 0.005} />}
                    <span className="text-base font-mono font-bold tabular-nums text-[var(--text-strong)] w-[90px] text-right">{money(hideZeroBalances ? sumAccts(filterAccts(data.sections.assets.current.accounts)) + sumAccts(filterAccts(data.sections.assets.nonCurrent.accounts)) : data.sections.assets.total)}</span>
                  </div>
                </div>
              </div>

              {/* LIABILITIES + EQUITY */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">Liabilities &amp; Equity</h3>
                {/* Current Liabilities */}
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono mb-1">Current Liabilities</div>
                {filterAccts(data.sections.liabilities.current.accounts).map(a => (
                  <div key={a.code} onClick={() => router.push(`/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}&start=${fy.fiscalYearStart || '2020-01-01'}&end=${asOf}`)} className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--primary-soft)] group">
                    <div className="flex-1 min-w-0"><span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--primary)]">{a.name}</span><span className="text-xs text-[var(--text-muted)] ml-1.5">{a.code}</span></div>
                    <div className="flex items-center gap-2 ml-3">
                      {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(a.priorBalance)}</span>}
                      {hasComparison && <ChangePct pct={a.changePct} direction={a.direction} favorable={a.favorable} />}
                      <span className="text-sm font-mono tabular-nums text-[var(--text)] w-[90px] text-right">{money(a.balance)}</span>
                    </div>
                  </div>
                ))}
                {filterAccts(data.sections.liabilities.current.accounts).length === 0 && <div className="text-xs text-[var(--text-faint)] py-2 italic">No current liabilities</div>}
                <SectionTotal label="Total Current Liabilities" total={hideZeroBalances ? sumAccts(filterAccts(data.sections.liabilities.current.accounts)) : data.sections.liabilities.current.total} priorTotal={data.sections.liabilities.current.priorTotal} hasComparison={hasComparison} cmp={data.sections.liabilities.current} />

                {/* Non-Current Liabilities */}
                {filterAccts(data.sections.liabilities.nonCurrent.accounts).length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono mt-4 mb-1">Non-Current Liabilities</div>
                    {filterAccts(data.sections.liabilities.nonCurrent.accounts).map(a => (
                      <div key={a.code} onClick={() => router.push(`/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}&start=${fy.fiscalYearStart || '2020-01-01'}&end=${asOf}`)} className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--primary-soft)] group">
                        <div className="flex-1 min-w-0"><span className="text-sm text-[var(--text)] truncate group-hover:text-[var(--primary)]">{a.name}</span><span className="text-xs text-[var(--text-muted)] ml-1.5">{a.code}</span></div>
                        <div className="flex items-center gap-2 ml-3">
                          {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(a.priorBalance)}</span>}
                          {hasComparison && <ChangePct pct={a.changePct} direction={a.direction} favorable={a.favorable} />}
                          <span className="text-sm font-mono tabular-nums text-[var(--text)] w-[90px] text-right">{money(a.balance)}</span>
                        </div>
                      </div>
                    ))}
                    <SectionTotal label="Total Non-Current Liabilities" total={hideZeroBalances ? sumAccts(filterAccts(data.sections.liabilities.nonCurrent.accounts)) : data.sections.liabilities.nonCurrent.total} priorTotal={data.sections.liabilities.nonCurrent.priorTotal} hasComparison={hasComparison} cmp={data.sections.liabilities.nonCurrent} />
                  </>
                )}

                {/* Total Liabilities */}
                <div className="flex items-center justify-between py-2.5 px-3 border-t border-[var(--border)]">
                  <span className="text-sm font-bold text-[var(--text-strong)]">Total Liabilities</span>
                  <div className="flex items-center gap-2">
                    {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(data.sections.liabilities.priorTotal)}</span>}
                    {hasComparison && <ChangePct pct={data.sections.liabilities.changePct} direction={data.sections.liabilities.changePct > 0.005 ? 'up' : data.sections.liabilities.changePct < -0.005 ? 'down' : 'flat'} favorable={!(data.sections.liabilities.changePct > 0.005)} />}
                    <span className="text-sm font-mono font-bold tabular-nums text-[var(--text-strong)] w-[90px] text-right">{money(hideZeroBalances ? sumAccts(filterAccts(data.sections.liabilities.current.accounts)) + sumAccts(filterAccts(data.sections.liabilities.nonCurrent.accounts)) : data.sections.liabilities.total)}</span>
                  </div>
                </div>

                {/* Equity sections */}
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono mt-4 mb-1">Equity</div>
                {Object.entries(data.sections.equity).filter(([,g]) => filterAccts(g.accounts).length > 0).map(([key, group]) => (
                  <div key={key}>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-faint)] font-mono mt-2 mb-0.5 px-2">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                    {filterAccts(group.accounts).map(a => (
                      <div key={a.code || a.name} className="flex items-center justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-[var(--primary-soft)] group">
                        <div className="flex-1 min-w-0"><span className="text-sm text-[var(--text)] truncate">{a.name}</span>{a.code && <span className="text-xs text-[var(--text-muted)] ml-1.5">{a.code}</span>}</div>
                        <div className="flex items-center gap-2 ml-3">
                          {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(a.priorBalance)}</span>}
                          {hasComparison && <ChangePct pct={a.changePct} direction={a.direction} favorable={a.favorable} />}
                          <span className="text-sm font-mono tabular-nums text-[var(--text)] w-[90px] text-right">{money(a.balance)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex items-center justify-between py-2.5 px-3 border-t border-[var(--border)]">
                  <span className="text-sm font-bold text-[var(--text-strong)]">Total Equity</span>
                  <div className="flex items-center gap-2">
                    {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(data.sections.priorTotalEquity)}</span>}
                    <span className="text-sm font-mono font-bold tabular-nums text-[var(--text-strong)] w-[90px] text-right">{money(hideZeroBalances ? Object.values(data.sections.equity).reduce((s, g) => s + sumAccts(filterAccts(g.accounts)), 0) : data.sections.totalEquity)}</span>
                  </div>
                </div>

                {/* Total Liabilities + Equity */}
                <div className="flex items-center justify-between py-3.5 px-3 mt-2 border-t-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50 rounded-lg">
                  <span className="text-base font-bold text-[var(--text-strong)]">Total Liabilities &amp; Equity</span>
                  <div className="flex items-center gap-2">
                    {hasComparison && <span className="text-xs font-mono tabular-nums text-[var(--text-faint)] w-[80px] text-right">{money(data.sections.priorTotalLiabilitiesAndEquity)}</span>}
                    <span className="text-base font-mono font-bold tabular-nums text-[var(--text-strong)] w-[90px] text-right">{money(hideZeroBalances ? (sumAccts(filterAccts(data.sections.liabilities.current.accounts)) + sumAccts(filterAccts(data.sections.liabilities.nonCurrent.accounts)) + Object.values(data.sections.equity).reduce((s, g) => s + sumAccts(filterAccts(g.accounts)), 0)) : data.sections.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>

                {/* Equation verification */}
                <div className={cn('text-center text-xs px-4 py-2 rounded-lg font-medium mt-3', data.isBalanced ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]')}>
                  Assets = Liabilities + Equity {data.isBalanced ? '✓' : '⚠'}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-faint)] mt-6 pt-3 border-t border-[var(--border)] print:block">
              <span>{data.companyName} · Balance Sheet</span>
              <span>Page 1 of 1 · Confidential</span>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
