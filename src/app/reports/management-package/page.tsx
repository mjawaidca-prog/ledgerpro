'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { Printer, Loader2, Download, ArrowRight } from 'lucide-react';

export default function ManagementPackagePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const asOf = new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/reports/management-package?asOf=${asOf}`);
        if (!res.ok) throw new Error('Failed to load');
        setData((await res.json()).data);
      } catch (err: any) {
        setError(err.message);
      } finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const d = data;

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Management Report Package</h1>
          <p className="sub">Combined financial statements as of {d.asOf ? format(new Date(d.asOf), 'MMMM d, yyyy') : 'today'}.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} /> Print Package
        </Button>
      </div>

      {/* print-only header */}
      <div className="hidden print:block mb-6 text-center">
        <h1 className="text-2xl font-bold">Management Report Package</h1>
        <p className="text-sm text-gray-500">As of {format(new Date(d.asOf), 'MMMM d, yyyy')}</p>
      </div>

      {error && <p className="text-[var(--danger)]">{error}</p>}

      {d && (
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
