'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, startOfMonth, subMonths, endOfMonth, startOfQuarter } from 'date-fns';
import { ArrowLeft, TrendingUp, TrendingDown, Loader2, Calendar } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { formatReportPeriod } from '@/lib/reporting';

interface PnLSummary {
  totalRevenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: number;
  netIncome: number;
  netMargin: number;
}

interface PnLData {
  companyName: string;
  period: { year: string; startDate: string; endDate: string };
  summary: PnLSummary;
  revenue: { code: string; name: string; amount: number }[];
  expenses: { code: string; name: string; isCOGS: boolean; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  prior: ({ year: string; summary: PnLSummary; revenue: { code: string; amount: number }[]; expenses: { code: string; amount: number }[] }) | null;
}

export default function ProfitLossPage() {
  const router = useRouter();
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fy = useFiscalYear();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fyLabel = fy.fiscalYearStart ? `FY ${new Date(fy.fiscalYearStart).getFullYear()}` : 'FY';
  const lastFYLabel = fy.fiscalYearStart ? `FY ${new Date(fy.fiscalYearStart).getFullYear() - 1}` : 'Last FY';

  const [startDate, setStartDate] = useState(fy.fiscalYearStart || `${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(fy.fiscalYearEnd || today);
  const [activePreset, setActivePreset] = useState(fyLabel);
  const [compare, setCompare] = useState(false);
  const [companyNameFallback, setCompanyNameFallback] = useState('');

  useEffect(() => {
    fetch('/api/companies').then(r => r.json()).then(json => setCompanyNameFallback(json.data?.[0]?.name || '')).catch(() => {});
  }, []);

  useEffect(() => {
    if (fy.loaded && activePreset === fyLabel) {
      setStartDate(fy.fiscalYearStart);
      setEndDate(fy.fiscalYearEnd || today);
    }
  }, [fy.loaded, fy.fiscalYearStart, fy.fiscalYearEnd]);

  const datePresets = [
    { label: 'This month', get: () => ({ start: format(startOfMonth(now), 'yyyy-MM-dd'), end: today }) },
    { label: 'Last month', get: () => ({ start: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'), end: format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd') }) },
    { label: 'This quarter', get: () => ({ start: format(startOfQuarter(now), 'yyyy-MM-dd'), end: today }) },
    { label: fyLabel, get: () => ({ start: fy.fiscalYearStart || `${now.getFullYear()}-01-01`, end: fy.fiscalYearEnd || today }) },
    { label: lastFYLabel, get: () => {
      const s = fy.fiscalYearStart ? new Date(fy.fiscalYearStart) : new Date(now.getFullYear() - 1, 0, 1);
      s.setFullYear(s.getFullYear() - 1);
      const e = fy.fiscalYearEnd ? new Date(fy.fiscalYearEnd) : new Date(now.getFullYear() - 1, 11, 31);
      e.setFullYear(e.getFullYear() - 1);
      return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
    }},
    { label: 'Custom', get: () => ({ start: startDate, end: endDate }) },
  ];

  function applyPreset(preset: typeof datePresets[0]) {
    const { start, end } = preset.get();
    setStartDate(start);
    setEndDate(end);
    setActivePreset(preset.label);
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate, compare: String(compare) });
      const res = await fetch(`/api/reports/profit-loss?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, compare]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/reports')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <ReportHeader
            companyName={data?.companyName || companyNameFallback || ''}
            statementName="Profit & Loss"
            periodLabel={formatReportPeriod('period-range', endDate, startDate)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] mr-2">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare to prior period
        </label>
      </div>

      {/* Date presets */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Calendar size={14} className="text-[var(--text-muted)]" />
        {datePresets.map((preset) => (
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
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActivePreset('Custom'); }} className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
            <span className="text-xs text-[var(--text-faint)]">to</span>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActivePreset('Custom'); }} className="text-xs border border-[var(--border)] rounded px-2 py-1.5 bg-[var(--surface)]" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="py-20 text-center text-[var(--text-muted)]">{error}</div>
      ) : data ? (
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Summary card */}
          <Card>
            <CardBody>
              <div className="flex items-center gap-6 mb-6">
                <div className="flex-1 text-center p-4 rounded-xl bg-[var(--success-soft)]">
                  <div className="text-micro uppercase tracking-[0.08em] text-[var(--text-muted)]">Revenue</div>
                  <div className="font-mono tabular-nums text-2xl font-bold text-[var(--success)] mt-1">
                    {money(data.summary.totalRevenue)}
                  </div>
                </div>
                <span className="text-2xl text-[var(--text-faint)] font-light">−</span>
                <div className="flex-1 text-center p-4 rounded-xl bg-[var(--danger-soft)]">
                  <div className="text-micro uppercase tracking-[0.08em] text-[var(--text-muted)]">Expenses</div>
                  <div className="font-mono tabular-nums text-2xl font-bold text-[var(--danger)] mt-1">
                    {money(data.summary.operatingExpenses + data.summary.costOfGoodsSold)}
                  </div>
                </div>
                <span className="text-2xl text-[var(--text-faint)] font-light">=</span>
                <div className="flex-1 text-center p-4 rounded-xl bg-[var(--primary-soft)]">
                  <div className="text-micro uppercase tracking-[0.08em] text-[var(--text-muted)]">Net Income</div>
                  <div className={cn(
                    'font-mono tabular-nums text-2xl font-bold mt-1',
                    data.summary.netIncome >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                  )}>
                    {money(data.summary.netIncome)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6 text-sm">
                <span className="text-[var(--text-muted)]">Gross Profit: <strong className="text-[var(--text-strong)]">{money(data.summary.grossProfit)}</strong></span>
                <span className="text-[var(--text-muted)]">Margin: <strong className={cn(data.summary.netMargin >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{data.summary.netMargin.toFixed(1)}%</strong></span>
                {data.prior && (
                  <span className="text-[var(--text-muted)]">FY{data.prior.year} Net Income: <strong className={cn(data.prior.summary.netIncome >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(data.prior.summary.netIncome)}</strong></span>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Revenue breakdown */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Revenue</h3>
              <div className="spacer" />
              {data.prior && (
                <span className="font-mono tabular-nums text-xs text-[var(--text-muted)] mr-3">FY{data.prior.year}: {money(data.prior.summary.totalRevenue)}</span>
              )}
              <span className="font-mono tabular-nums text-lg font-semibold text-[var(--success)]">
                {money(data.summary.totalRevenue)}
              </span>
            </CardHeader>
            <div className="divide-y divide-[var(--border)]">
              {data.revenue.map((item) => {
                const priorAmount = data.prior?.revenue.find((p) => p.code === item.code)?.amount;
                return (
                  <div key={item.code} onClick={() => router.push(`/reports/general-ledger?code=${item.code}&name=${encodeURIComponent(item.name)}&start=${startDate}&end=${endDate}`)} className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group">
                    <span className="font-mono text-xs text-[var(--text-muted)] w-[50px]">{item.code}</span>
                    <span className="text-sm text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">{item.name}</span>
                    {data.prior && (
                      <span className="font-mono tabular-nums text-xs text-[var(--text-faint)] w-[100px] text-right">{money(priorAmount ?? 0)}</span>
                    )}
                    <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-strong)] w-[100px] text-right">
                      {money(item.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* COGS */}
          {data.summary.costOfGoodsSold > 0 && (
            <div className="flex items-center gap-4 px-2">
              <span className="text-sm font-semibold text-[var(--text-strong)]">Cost of Goods Sold</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="font-mono tabular-nums text-sm font-semibold text-[var(--danger)]">
                ({money(data.summary.costOfGoodsSold)})
              </span>
            </div>
          )}

          {/* Gross profit line */}
          <div className="flex items-center gap-4 px-2 py-2 bg-[var(--surface-2)] rounded-lg">
            <span className="text-sm font-bold text-[var(--text-strong)]">Gross Profit</span>
            <div className="flex-1" />
            <span className="font-mono tabular-nums text-base font-bold text-[var(--success)]">
              {money(data.summary.grossProfit)}
            </span>
          </div>

          {/* Expenses breakdown */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Operating Expenses</h3>
              <div className="spacer" />
              <span className="font-mono tabular-nums text-lg font-semibold text-[var(--danger)]">
                {money(data.summary.operatingExpenses)}
              </span>
            </CardHeader>
            <div className="divide-y divide-[var(--border)]">
              {data.expenses
                .filter((e) => !e.isCOGS)
                .map((item) => {
                  const priorAmount = data.prior?.expenses.find((p) => p.code === item.code)?.amount;
                  return (
                    <div key={item.code} onClick={() => router.push(`/reports/general-ledger?code=${item.code}&name=${encodeURIComponent(item.name)}&start=${startDate}&end=${endDate}`)} className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group">
                      <span className="font-mono text-xs text-[var(--text-muted)] w-[50px]">{item.code}</span>
                      <span className="text-sm text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">
                        {item.name}
                        {!item.amount && <span className="text-[var(--text-faint)] ml-2">— no activity</span>}
                      </span>
                      {data.prior && (
                        <span className="font-mono tabular-nums text-xs text-[var(--text-faint)] w-[100px] text-right">{money(priorAmount ?? 0)}</span>
                      )}
                      <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-strong)] w-[100px] text-right">
                        {money(item.amount)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </Card>

          {/* Net Income footer */}
          <div className="flex items-center gap-4 px-2 py-4 bg-[var(--surface)] border-2 border-[var(--border-strong)] rounded-xl">
            <span className="text-base font-bold text-[var(--text-strong)]">Net Income</span>
            <div className="flex-1" />
            <span className={cn(
              'font-mono tabular-nums text-xl font-bold',
              data.summary.netIncome >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'
            )}>
              {money(data.summary.netIncome)}
            </span>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
