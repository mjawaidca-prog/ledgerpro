'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, startOfMonth, subMonths, endOfMonth, startOfQuarter } from 'date-fns';
import { Printer, Loader2, Download, ArrowRight, Calendar } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';

export default function ManagementPackagePage() {
  const fy = useFiscalYear();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ startDate, endDate });
        const res = await fetch(`/api/reports/management-package?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load');
        setData((await res.json()).data);
      } catch (err: any) {
        setError(err.message);
      } finally { setLoading(false); }
    }
    load();
  }, [startDate, endDate]);

  const d = data;

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Management Report Package</h1>
          <p className="sub">
            Combined financial statements for {format(new Date(startDate), 'MMM d, yyyy')} – {format(new Date(endDate), 'MMM d, yyyy')}
            {d?.asOf ? <> — as of {format(new Date(d.asOf), 'MMMM d, yyyy')}</> : ''}.
          </p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> Print Package
        </Button>
      </div>

      {/* Date presets */}
      <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
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

      {/* print-only header */}
      {d && (
        <div className="hidden print:block mb-6 text-center">
          <h1 className="text-2xl font-bold">Management Report Package</h1>
          <p className="text-sm text-gray-500">{format(new Date(startDate), 'MMM d, yyyy')} – {format(new Date(endDate), 'MMM d, yyyy')} — as of {format(new Date(d.asOf), 'MMMM d, yyyy')}</p>
        </div>
      )}

      {error && <p className="text-[var(--danger)]">{error}</p>}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-[var(--text-muted)]" />
        </div>
      )}

      {!loading && d && (
        <div className="space-y-6 report-package">
          {/* ─── P&L ─── */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Profit &amp; Loss Statement</h3>
              <p className="text-xs text-[var(--text-muted)]">Year to date as of {format(new Date(d.asOf), 'MMM d, yyyy')}</p>
            </CardHeader>
            <CardBody>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[var(--success)] uppercase tracking-[0.06em]">Revenue</h4>
                {d.profitLoss.revenue.map((r: any) => (
                  <div key={r.code} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{r.code} — {r.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(r.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                  <span>Total Revenue</span>
                  <span className="font-mono tabular-nums text-[var(--success)]">{money(d.profitLoss.totalRevenue)}</span>
                </div>

                <h4 className="text-xs font-semibold text-[var(--danger)] uppercase tracking-[0.06em] mt-4">Expenses</h4>
                {d.profitLoss.expenses.map((e: any) => (
                  <div key={e.code} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{e.code} — {e.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                  <span>Total Expenses</span>
                  <span className="font-mono tabular-nums text-[var(--danger)]">{money(d.profitLoss.totalExpenses)}</span>
                </div>

                <div className="flex justify-between text-base font-bold border-t-2 border-[var(--border)] pt-2 mt-2">
                  <span>Net Income</span>
                  <span className={cn('font-mono tabular-nums', d.profitLoss.netIncome >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                    {money(d.profitLoss.netIncome)}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* ─── Balance Sheet ─── */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Balance Sheet</h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--primary)]">Assets</h4>
                {d.balanceSheet.assets.map((a: any) => (
                  <div key={a.code} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{a.code} — {a.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(a.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                  <span>Total Assets</span>
                  <span className="font-mono tabular-nums">{money(d.balanceSheet.totalAssets)}</span>
                </div>

                <h4 className="text-xs font-semibold uppercase tracking-[0.06em] mt-4 text-[var(--warning)]">Liabilities</h4>
                {d.balanceSheet.liabilities.map((l: any) => (
                  <div key={l.code} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{l.code} — {l.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(l.amount)}</span>
                  </div>
                ))}
                <h4 className="text-xs font-semibold uppercase tracking-[0.06em] mt-4 text-[var(--success)]">Equity</h4>
                {d.balanceSheet.equity.map((e: any) => (
                  <div key={e.code} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{e.code} — {e.name}</span>
                    <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm pl-4">
                  <span className="text-[var(--text-muted)]">Retained Earnings</span>
                  <span className="font-mono tabular-nums">{money(d.balanceSheet.retainedEarnings)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                  <span>Total Liabilities + Equity</span>
                  <span className="font-mono tabular-nums">{money(d.balanceSheet.totalEquity)}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* ─── Cash Flow ─── */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Cash Flow Statement</h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-1 mb-4">
                {d.cashFlow.months.map((m: any) => (
                  <div key={m.month} className="flex justify-between text-sm pl-4">
                    <span className="text-[var(--text-muted)]">{m.month}</span>
                    <div className="flex gap-4">
                      <span className="font-mono tabular-nums text-[var(--success)]">{money(m.inflow)}</span>
                      <span className="font-mono tabular-nums text-[var(--danger)]">{money(m.outflow)}</span>
                      <span className={cn('font-mono tabular-nums font-semibold w-20 text-right', m.netFlow >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(m.netFlow)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                <span>Net Cash Flow</span>
                <span className="font-mono tabular-nums">{money(d.cashFlow.netCashFlow)}</span>
              </div>
            </CardBody>
          </Card>

          {/* ─── Trial Balance ─── */}
          <Card>
            <CardHeader>
              <h3 className="t-h3">Trial Balance</h3>
            </CardHeader>
            <CardBody>
              <div className="space-y-1">
                {d.trialBalance.rows.map((r: any) => (
                  <div key={r.code} className="flex justify-between text-sm pl-4 py-0.5">
                    <span className="text-[var(--text-muted)]">{r.code} — {r.name}</span>
                    <div className="flex gap-4">
                      <span className="font-mono tabular-nums w-24 text-right">{r.debit > 0 ? money(r.debit) : ''}</span>
                      <span className="font-mono tabular-nums w-24 text-right">{r.credit > 0 ? money(r.credit) : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-[var(--border)] pt-2">
                <span>Totals</span>
                <div className="flex gap-4">
                  <span className="font-mono tabular-nums w-24 text-right">{money(d.trialBalance.totalDebits)}</span>
                  <span className="font-mono tabular-nums w-24 text-right">{money(d.trialBalance.totalCredits)}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Print styles */}
          <style jsx global>{`
            @media print {
              body { background: white !important; color: black !important; }
              .rail, .topbar, .content-head button, .report-package + * { display: none !important; }
              .content { padding: 0 !important; }
              .card { box-shadow: none !important; border: 1px solid #ddd !important; break-inside: avoid; }
            }
          `}</style>
        </div>
      )}
    </AppShell>
  );
}
