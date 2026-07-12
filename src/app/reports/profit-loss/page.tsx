'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, startOfMonth, subMonths, endOfMonth, startOfQuarter } from 'date-fns';
import { ArrowLeft, Loader2, Printer, Download, ChevronDown } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { exportPandL } from '@/lib/export';

// ── Types ──

interface SectionRow {
  code: string;
  name: string;
  amount: number;
  priorAmount: number;
  changePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

interface Section {
  rows: SectionRow[];
  total: number;
  priorTotal: number;
  changePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

interface HighlightRow {
  amount: number;
  priorAmount: number;
  changePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
  marginPct: number;
}

interface PnLSections {
  income: Section;
  cogs: Section;
  grossProfit: HighlightRow;
  operatingExpenses: Section;
  netIncome: HighlightRow;
}

interface PnLData {
  companyName: string;
  currency: string;
  period: { startDate: string; endDate: string; label: string };
  comparisonLabel: string;
  comparisonMode: string;
  generatedAt: string;
  sections: PnLSections;
}

type CompareMode = 'none' | 'prior_period' | 'prior_year';

// ── Dropdown hook ──

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return { open, setOpen, ref };
}

// ── Helpers ──

function ChangePct({ pct, direction, favorable }: { pct: number; direction: string; favorable: boolean | null }) {
  if (direction === 'flat' || favorable === null) {
    return <span className="text-[var(--text-faint)]">—</span>;
  }
  const isGood = favorable;
  const arrow = direction === 'up' ? '▲' : '▼';
  const color = isGood ? 'text-[var(--success)]' : 'text-[var(--danger)]';
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-xs', color)}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── Main component ──

export default function ProfitLossPage() {
  const router = useRouter();
  const fy = useFiscalYear();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Period state
  type PresetKey = 'this_month' | 'this_quarter' | 'ytd' | 'last_fiscal_year' | 'custom';
  const [preset, setPreset] = useState<PresetKey>('ytd');
  const [startDate, setStartDate] = useState(fy.fiscalYearStart || `${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(fy.fiscalYearEnd || today);
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);

  // Comparison
  const [compareMode, setCompareMode] = useState<CompareMode>('none');

  // Display toggles
  const [hideZeroBalances, setHideZeroBalances] = useState(false);

  // Data
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dropdowns
  const periodDd = useDropdown();
  const compareDd = useDropdown();
  const exportDd = useDropdown();

  // Init from fiscal year
  useEffect(() => {
    if (fy.loaded && preset === 'ytd') {
      setStartDate(fy.fiscalYearStart || `${now.getFullYear()}-01-01`);
      setEndDate(fy.fiscalYearEnd || today);
    }
  }, [fy.loaded, fy.fiscalYearStart, fy.fiscalYearEnd]);

  // Apply preset
  function applyPreset(key: PresetKey) {
    setPreset(key);
    periodDd.setOpen(false);
    let s: string, e: string;
    switch (key) {
      case 'this_month':
        s = format(startOfMonth(now), 'yyyy-MM-dd');
        e = today;
        break;
      case 'this_quarter':
        s = format(startOfQuarter(now), 'yyyy-MM-dd');
        e = today;
        break;
      case 'ytd':
        s = fy.fiscalYearStart || `${now.getFullYear()}-01-01`;
        e = fy.fiscalYearEnd || today;
        break;
      case 'last_fiscal_year':
        if (fy.fiscalYearStart) {
          const fyStart = new Date(fy.fiscalYearStart);
          fyStart.setFullYear(fyStart.getFullYear() - 1);
          const fyEnd = new Date(fy.fiscalYearEnd || fy.fiscalYearStart);
          fyEnd.setFullYear(fyEnd.getFullYear() - 1);
          // Adjust end: FY end = start + 1 year - 1 day
          const adjEnd = new Date(fyStart);
          adjEnd.setFullYear(adjEnd.getFullYear() + 1);
          adjEnd.setDate(adjEnd.getDate() - 1);
          s = fyStart.toISOString().slice(0, 10);
          e = adjEnd.toISOString().slice(0, 10);
        } else {
          s = `${now.getFullYear() - 1}-01-01`;
          e = `${now.getFullYear() - 1}-12-31`;
        }
        break;
      case 'custom':
        s = customStart;
        e = customEnd;
        break;
      default:
        s = startDate;
        e = endDate;
    }
    setStartDate(s);
    setEndDate(e);
  }

  // Apply comparison
  function applyCompare(mode: CompareMode) {
    setCompareMode(mode);
    compareDd.setOpen(false);
  }

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate, compare: compareMode });
      const res = await fetch(`/api/reports/profit-loss?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, compareMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Helpers for rendering ──

  const hasComparison = compareMode !== 'none' && !!data?.comparisonLabel;
  const showCol = (col: 1 | 2 | 3) => {
    // col 1 = current period, col 2 = comparison, col 3 = % change
    if (col === 1) return true;
    return hasComparison;
  };

  const periodLabel = data?.period?.label || `${startDate} – ${endDate}`;
  const currency = data?.currency || 'USD';
  const generatedAt = data?.generatedAt
    ? format(new Date(data.generatedAt), 'MMM d, yyyy')
    : format(now, 'MMM d, yyyy');

  return (
    <AppShell>
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/reports')}
            className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)]">Profit &amp; Loss</strong>
          </span>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap print:hidden">
        {/* Period dropdown */}
        <div className="relative" ref={periodDd.ref}>
          <button
            onClick={() => periodDd.setOpen(!periodDd.open)}
            className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors"
          >
            <span className="text-[var(--text-muted)]">
              {preset === 'this_month' ? 'This month' :
               preset === 'this_quarter' ? 'This quarter' :
               preset === 'ytd' ? 'Year to date' :
               preset === 'last_fiscal_year' ? 'Last fiscal year' : 'Custom range'}
            </span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {periodDd.open && (
            <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
              {([
                ['this_month', 'This month'],
                ['this_quarter', 'This quarter'],
                ['ytd', 'Year to date'],
                ['last_fiscal_year', 'Last fiscal year'],
                ['custom', 'Custom range…'],
              ] as [PresetKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] transition-colors flex items-center gap-2',
                    preset === key ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]'
                  )}
                >
                  {preset === key && '✓'} {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom date inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date" value={customStart}
              onChange={e => { setCustomStart(e.target.value); setStartDate(e.target.value); }}
              className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]"
            />
            <span className="text-xs text-[var(--text-faint)]">to</span>
            <input
              type="date" value={customEnd}
              onChange={e => { setCustomEnd(e.target.value); setEndDate(e.target.value); }}
              className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]"
            />
            <button
              onClick={() => { setStartDate(customStart); setEndDate(customEnd); }}
              className="text-xs bg-[var(--primary)] text-white px-3 py-1.5 rounded-full font-medium"
            >
              Apply
            </button>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Comparison dropdown */}
        <div className="relative" ref={compareDd.ref}>
          <button
            onClick={() => compareDd.setOpen(!compareDd.open)}
            className="flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors"
          >
            <span className="text-[var(--text-muted)]">
              {compareMode === 'prior_period' ? 'vs. Prior period' :
               compareMode === 'prior_year' ? 'vs. Prior year' : 'No comparison'}
            </span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {compareDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
              {([
                ['prior_period', 'Prior period'],
                ['prior_year', 'Prior year'],
                ['none', 'No comparison'],
              ] as [CompareMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => applyCompare(mode)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] transition-colors flex items-center gap-2',
                    compareMode === mode ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text)]'
                  )}
                >
                  {compareMode === mode && '✓'} {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Export dropdown */}
        <div className="relative" ref={exportDd.ref}>
          <button
            onClick={() => exportDd.setOpen(!exportDd.open)}
            className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors"
          >
            <Download size={14} className="text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">Export</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {exportDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[180px] z-20 overflow-hidden">
              {[
                ['pdf', 'Export as PDF'],
                ['excel', 'Export as Excel'],
                ['csv', 'Export as CSV'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    exportDd.setOpen(false);
                    if (key === 'pdf') {
                      window.print();
                    } else if (key === 'csv' && data) {
                      exportPandL(data);
                    } else if (key === 'excel' && data) {
                      exportPandL(data, 'xls');
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] transition-colors text-[var(--text)]"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Print button */}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors"
        >
          <Printer size={14} className="text-[var(--text-muted)]" /> Print
        </button>

        {/* Hide zero balances */}
        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] ml-1">
          <input type="checkbox" checked={hideZeroBalances} onChange={e => setHideZeroBalances(e.target.checked)} />
          Hide zero
        </label>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="py-20 text-center text-[var(--text-muted)]">{error}</div>
      ) : data ? (
        <div className="max-w-[900px] mx-auto">
          {/* Statement card */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-10 py-10 shadow-[var(--shadow-sm)] print:shadow-none print:border-none print:px-0 print:py-0">
            {/* ── Document Header ── */}
            <div className="text-center pb-4 border-b-2 border-[var(--text-strong)] print:border-gray-800">
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2">
                LedgerPro
              </div>
              <div className="text-[22px] font-bold text-[var(--text-strong)]">
                {data.companyName}
              </div>
              <div className="text-base font-semibold text-[var(--text)] mt-1">
                Profit &amp; Loss Statement
              </div>
              <div className="font-mono text-[13px] text-[var(--text-muted)] mt-2.5">
                For the period {periodLabel}
              </div>
              <div className="font-mono text-xs text-[var(--text-faint)] mt-0.5">
                Accrual basis · {currency} · Generated {generatedAt}
              </div>
            </div>

            {/* ── Statement Table ── */}
            <table className="w-full mt-4">
              <thead>
                <tr>
                  <th className="text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono">
                    Account
                  </th>
                  <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[140px]">
                    {periodLabel.length > 30
                      ? `${format(new Date(data.period.startDate), 'MMM d')} – ${format(new Date(data.period.endDate), 'MMM d, yyyy')}`
                      : periodLabel}
                  </th>
                  {hasComparison && (
                    <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[130px]">
                      {data.comparisonLabel.length > 30
                        ? 'Prior period'
                        : data.comparisonLabel}
                    </th>
                  )}
                  {hasComparison && (
                    <th className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 border-b border-[var(--border)] font-mono w-[80px]">
                      % Change
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* ── INCOME ── */}
                <tr>
                  <td colSpan={hasComparison ? 4 : 2} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">
                    Income
                  </td>
                </tr>
                {(hideZeroBalances ? data.sections.income.rows.filter(r => r.amount !== 0) : data.sections.income.rows).map(row => (
                  <tr key={row.code} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${row.code}&name=${encodeURIComponent(row.name)}&start=${data.period.startDate}&end=${data.period.endDate}`)}>
                    <td className="py-1.5 text-sm text-[var(--text)] pl-2">{row.name}</td>
                    <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(row.amount)}</td>
                    {hasComparison && <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(row.priorAmount)}</td>}
                    {hasComparison && <td className="py-1.5 text-right"><ChangePct pct={row.changePct} direction={row.direction} favorable={row.favorable} /></td>}
                  </tr>
                ))}
                {/* Total Income */}
                <tr className="border-t border-[var(--border)]">
                  <td className="py-2.5 text-sm font-bold text-[var(--text-strong)] pl-2">Total income</td>
                  <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.income.total)}</td>
                  {hasComparison && <td className="py-2.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(data.sections.income.priorTotal)}</td>}
                  {hasComparison && <td className="py-2.5 text-right"><ChangePct pct={data.sections.income.changePct} direction={data.sections.income.direction} favorable={data.sections.income.favorable} /></td>}
                </tr>

                {/* ── COGS ── */}
                {data.sections.cogs.rows.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={hasComparison ? 4 : 2} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">
                        Cost of Goods Sold
                      </td>
                    </tr>
                    {(hideZeroBalances ? data.sections.cogs.rows.filter(r => r.amount !== 0) : data.sections.cogs.rows).map(row => (
                      <tr key={row.code} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${row.code}&name=${encodeURIComponent(row.name)}&start=${data.period.startDate}&end=${data.period.endDate}`)}>
                        <td className="py-1.5 text-sm text-[var(--text)] pl-2">{row.name}</td>
                        <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(row.amount)}</td>
                        {hasComparison && <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(row.priorAmount)}</td>}
                        {hasComparison && <td className="py-1.5 text-right"><ChangePct pct={row.changePct} direction={row.direction} favorable={row.favorable} /></td>}
                      </tr>
                    ))}
                    {/* Total COGS */}
                    <tr className="border-t border-[var(--border)]">
                      <td className="py-2.5 text-sm font-bold text-[var(--text-strong)] pl-2">Total COGS</td>
                      <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.cogs.total)}</td>
                      {hasComparison && <td className="py-2.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(data.sections.cogs.priorTotal)}</td>}
                      {hasComparison && <td className="py-2.5 text-right"><ChangePct pct={data.sections.cogs.changePct} direction={data.sections.cogs.direction} favorable={data.sections.cogs.favorable} /></td>}
                    </tr>
                  </>
                )}

                {/* ── GROSS PROFIT ── */}
                <tr className="border-t-2 border-b-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50">
                  <td className="py-3.5 text-base font-bold text-[var(--text-strong)] pl-2">
                    Gross profit
                    <span className="block text-[11px] font-normal text-[var(--text-muted)] mt-0.5">
                      {data.sections.grossProfit.marginPct.toFixed(1)}% margin
                    </span>
                  </td>
                  <td className="py-3.5 text-base font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.grossProfit.amount)}</td>
                  {hasComparison && <td className="py-3.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(data.sections.grossProfit.priorAmount)}</td>}
                  {hasComparison && <td className="py-3.5 text-right"><ChangePct pct={data.sections.grossProfit.changePct} direction={data.sections.grossProfit.direction} favorable={data.sections.grossProfit.favorable} /></td>}
                </tr>

                {/* ── OPERATING EXPENSES ── */}
                <tr>
                  <td colSpan={hasComparison ? 4 : 2} className="pt-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] font-mono">
                    Operating Expenses
                  </td>
                </tr>
                {(hideZeroBalances ? data.sections.operatingExpenses.rows.filter(r => r.amount !== 0) : data.sections.operatingExpenses.rows).map(row => (
                  <tr key={row.code} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={() => router.push(`/reports/general-ledger?code=${row.code}&name=${encodeURIComponent(row.name)}&start=${data.period.startDate}&end=${data.period.endDate}`)}>
                    <td className="py-1.5 text-sm text-[var(--text)] pl-2">{row.name}</td>
                    <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text)]">{money(row.amount)}</td>
                    {hasComparison && <td className="py-1.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(row.priorAmount)}</td>}
                    {hasComparison && <td className="py-1.5 text-right"><ChangePct pct={row.changePct} direction={row.direction} favorable={row.favorable} /></td>}
                  </tr>
                ))}
                {/* Total Operating Expenses */}
                <tr className="border-t border-[var(--border)]">
                  <td className="py-2.5 text-sm font-bold text-[var(--text-strong)] pl-2">Total operating expenses</td>
                  <td className="py-2.5 text-sm font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.operatingExpenses.total)}</td>
                  {hasComparison && <td className="py-2.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(data.sections.operatingExpenses.priorTotal)}</td>}
                  {hasComparison && <td className="py-2.5 text-right"><ChangePct pct={data.sections.operatingExpenses.changePct} direction={data.sections.operatingExpenses.direction} favorable={data.sections.operatingExpenses.favorable} /></td>}
                </tr>

                {/* ── NET INCOME ── */}
                <tr className="border-t-2 border-b-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50">
                  <td className="py-3.5 text-base font-bold text-[var(--text-strong)] pl-2">
                    Net income
                    <span className="block text-[11px] font-normal text-[var(--text-muted)] mt-0.5">
                      {data.sections.netIncome.marginPct.toFixed(1)}% net margin
                    </span>
                  </td>
                  <td className="py-3.5 text-base font-mono font-bold tabular-nums text-right text-[var(--text-strong)]">{money(data.sections.netIncome.amount)}</td>
                  {hasComparison && <td className="py-3.5 text-sm font-mono tabular-nums text-right text-[var(--text-faint)]">{money(data.sections.netIncome.priorAmount)}</td>}
                  {hasComparison && <td className="py-3.5 text-right"><ChangePct pct={data.sections.netIncome.changePct} direction={data.sections.netIncome.direction} favorable={data.sections.netIncome.favorable} /></td>}
                </tr>
              </tbody>
            </table>

            {/* ── Footer ── */}
            <div className="flex justify-between font-mono text-[11px] text-[var(--text-faint)] mt-6 pt-3 border-t border-[var(--border)] print:block">
              <span>{data.companyName} · Profit &amp; Loss</span>
              <span>Page 1 of 1 · Confidential</span>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
