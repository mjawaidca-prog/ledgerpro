'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, startOfMonth, subMonths, endOfMonth, startOfQuarter } from 'date-fns';
import { ArrowLeft, Loader2, Calendar } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';

interface CategoryData {
  code: string;
  name: string;
  detailType: string | null;
  balance: number;
  billCount: number;
  descriptions: string[];
  percentage: number;
}

interface ExpenseData {
  year: string;
  startDate?: string;
  endDate?: string;
  totalExpenses: number;
  categories: CategoryData[];
  count: number;
}

export default function ExpenseBreakdownPage() {
  const router = useRouter();
  const [data, setData] = useState<ExpenseData | null>(null);
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
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`/api/reports/expense-breakdown?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch expense breakdown');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

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

  const maxBalance = Math.max(...data.categories.map((c) => c.balance), 1);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Expense by Category</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{format(new Date(startDate), 'MMM d, yyyy')} – {format(new Date(endDate), 'MMM d, yyyy')} · {data.count} categories · {money(data.totalExpenses)} total</p>
          </div>
        </div>
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

      {/* Horizontal bar chart + table */}
      <Card>
        <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Spending by GL Account</h2></CardHeader>
        <CardBody>
          <div className="space-y-3">
            {data.categories.map((cat) => (
              <div key={cat.code} onClick={() => router.push(`/reports/general-ledger?code=${cat.code}&name=${encodeURIComponent(cat.name)}&start=${startDate}&end=${endDate}`)} className="cursor-pointer group">
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-[var(--text-strong)] truncate group-hover:text-[var(--primary)] transition-colors">{cat.name}</span>
                    <span className="text-xs text-[var(--text-faint)] shrink-0">{cat.code}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className="text-xs text-[var(--text-muted)]">{cat.percentage}%</span>
                    <span className="font-mono text-sm">{money(cat.balance)}</span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--danger)] rounded-full transition-all"
                    style={{ width: `${(cat.balance / maxBalance) * 100}%` }}
                  />
                </div>
                {cat.descriptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 ml-0">
                    {cat.descriptions.map((desc, i) => (
                      <span key={i} className="text-micro text-[var(--text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">
                        {desc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Summary pie-equivalent: list view */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader><h3 className="text-sm font-semibold text-[var(--text-strong)]">Top Expenses</h3></CardHeader>
          <CardBody>
            {data.categories.slice(0, 5).map((cat) => (
              <div key={cat.code} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <span className="text-[var(--text)]">{cat.name}</span>
                <span className="font-mono text-[var(--danger)]">{money(cat.balance)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><h3 className="text-sm font-semibold text-[var(--text-strong)]">Category Details</h3></CardHeader>
          <CardBody>
            {data.categories.map((cat) => (
              <div key={cat.code} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <div>
                  <span className="text-[var(--text)]">{cat.name}</span>
                  {cat.detailType && <span className="text-xs text-[var(--text-faint)] ml-1">· {cat.detailType}</span>}
                </div>
                <div className="text-right">
                  <div className="font-mono text-[var(--text-strong)]">{money(cat.balance)}</div>
                  <div className="text-xs text-[var(--text-muted)]">{cat.billCount} bill{cat.billCount !== 1 ? 's' : ''} · {cat.percentage}%</div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
