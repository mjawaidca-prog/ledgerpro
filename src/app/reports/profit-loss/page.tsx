'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Download, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';

interface PnLData {
  period: { year: string; startDate: string; endDate: string };
  summary: {
    totalRevenue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    operatingExpenses: number;
    netIncome: number;
    netMargin: number;
  };
  revenue: { code: string; name: string; amount: number }[];
  expenses: { code: string; name: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
}

export default function ProfitLossPage() {
  const router = useRouter();
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fy = useFiscalYear();
  const [year, setYear] = useState(fy.defaultYear);
  const [period, setPeriod] = useState('year');

  useEffect(() => { if (fy.loaded) setYear(fy.defaultYear); }, [fy.loaded, fy.defaultYear]);

  // Generate year options: 4 years centered on current FY
  const yearOptions = Array.from({ length: 4 }, (_, i) => {
    const y = String(Number(fy.defaultYear || new Date().getFullYear()) - 1 + i);
    return { value: y, label: y };
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year, period });
      const res = await fetch(`/api/reports/profit-loss?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load report');
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [year, period]);

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
          <h1 className="t-h1">Profit & Loss</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Northwind Trading · Fiscal Year {year}
          </p>
        </div>
        <Segmented
          options={yearOptions}
          value={year}
          onChange={setYear}
        />
        <Button variant="secondary"><Download size={16} /> Export PDF</Button>
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
              </div>
            </CardBody>
          </Card>

          {/* Revenue breakdown */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Revenue</h3>
              <div className="spacer" />
              <span className="font-mono tabular-nums text-lg font-semibold text-[var(--success)]">
                {money(data.summary.totalRevenue)}
              </span>
            </CardHeader>
            <div className="divide-y divide-[var(--border)]">
              {data.revenue.map((item) => (
                <div key={item.code} onClick={() => router.push(`/reports/general-ledger?code=${item.code}&name=${encodeURIComponent(item.name)}`)} className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group">
                  <span className="font-mono text-xs text-[var(--text-muted)] w-[50px]">{item.code}</span>
                  <span className="text-sm text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">{item.name}</span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-strong)]">
                    {money(item.amount)}
                  </span>
                </div>
              ))}
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
                .filter((e) => e.code !== '5000') // Exclude COGS
                .map((item) => (
                  <div key={item.code} onClick={() => router.push(`/reports/general-ledger?code=${item.code}&name=${encodeURIComponent(item.name)}`)} className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group">
                    <span className="font-mono text-xs text-[var(--text-muted)] w-[50px]">{item.code}</span>
                    <span className="text-sm text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">
                      {item.name}
                      {!item.amount && <span className="text-[var(--text-faint)] ml-2">— no activity</span>}
                    </span>
                    <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-strong)]">
                      {money(item.amount)}
                    </span>
                  </div>
                ))}
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
