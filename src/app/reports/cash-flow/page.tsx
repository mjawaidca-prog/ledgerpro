'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { ArrowLeft, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

interface CashFlowData {
  period: { year: string };
  summary: {
    cashFromCustomers: number;
    cashPaidToVendors: number;
    operatingInflows: number;
    operatingOutflows: number;
    netOperatingCash: number;
    netCashFlow: number;
  };
  monthly: { month: string; inflow: number; outflow: number; net: number }[];
}

export default function CashFlowPage() {
  const router = useRouter();
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState('2026');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/cash-flow?year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch cash flow');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-[var(--text-muted)]" size={28} />
        </div>
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

  const maxAbs = Math.max(
    ...data.monthly.map((m) => Math.max(m.inflow, m.outflow, 0)),
    1000
  );

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Cash Flow Statement</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Fiscal year {year}</p>
          </div>
        </div>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]">
          {['2026', '2025'].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card><CardBody className="p-4"><div className="text-xs text-[var(--text-muted)]">Cash from Customers</div><div className="text-lg font-mono font-bold text-[var(--success)] mt-1">{money(data.summary.cashFromCustomers)}</div></CardBody></Card>
        <Card><CardBody className="p-4"><div className="text-xs text-[var(--text-muted)]">Paid to Vendors</div><div className="text-lg font-mono font-bold text-[var(--danger)] mt-1">{money(data.summary.cashPaidToVendors)}</div></CardBody></Card>
        <Card><CardBody className="p-4"><div className="text-xs text-[var(--text-muted)]">Operating Inflows</div><div className="text-lg font-mono font-bold text-[var(--success)] mt-1">{money(data.summary.operatingInflows)}</div></CardBody></Card>
        <Card><CardBody className="p-4"><div className="text-xs text-[var(--text-muted)]">Net Cash Flow</div><div className={cn('text-lg font-mono font-bold mt-1', data.summary.netCashFlow >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(data.summary.netCashFlow, true)}</div></CardBody></Card>
      </div>

      {/* Monthly bar chart */}
      <Card>
        <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Monthly Cash Flow</h2></CardHeader>
        <CardBody>
          <div className="space-y-2">
            {data.monthly.map((m) => (
              <div key={m.month} onClick={() => router.push(`/reports/general-ledger?start=${m.month}-01&end=${m.month}-28`)} className="flex items-center gap-3 cursor-pointer hover:bg-[var(--primary-soft)] rounded px-1 py-0.5 transition-colors group">
                <div className="w-10 text-xs text-[var(--text-muted)] text-right shrink-0">{new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short' })}</div>
                <div className="flex-1 flex gap-0.5 h-6">
                  <div className="bg-[var(--success)] rounded-l-sm h-full transition-all" style={{ width: `${(m.inflow / maxAbs) * 100}%`, minWidth: m.inflow > 0 ? '2px' : '0' }} title={`Inflow: ${money(m.inflow)}`} />
                  <div className="bg-[var(--danger)] rounded-r-sm h-full transition-all" style={{ width: `${(m.outflow / maxAbs) * 100}%`, minWidth: m.outflow > 0 ? '2px' : '0' }} title={`Outflow: ${money(m.outflow)}`} />
                </div>
                <div className={cn('w-24 text-xs font-mono text-right', m.net >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{money(m.net, true)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-4 text-xs text-[var(--text-muted)] justify-center">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--success)]" /> Inflow</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[var(--danger)]" /> Outflow</span>
          </div>
        </CardBody>
      </Card>
    </AppShell>
  );
}
