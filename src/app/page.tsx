'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, FileText, Plus,
  ArrowUpRight, Loader2, Building2, ArrowRight, CreditCard, Scale,
} from 'lucide-react';

interface DashboardData {
  kpis: {
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    outstanding: number;
    totalCash: number;
    revenueChange: number;
    expenseChange: number;
    incomeChange: number;
    outstandingCount: number;
  };
  cashFlow: { month: string; income: number; expenses: number }[];
  topExpenses: { category: string; amount: number; pct: number }[];
  invoicesAttention: {
    id: string; customer: string; total: number;
    dueDate: string; status: 'pending' | 'overdue'; daysOverdue: number;
  }[];
  bankAccounts: { id: string; name: string; balance: number; kind: string; mask: string }[];
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] px-3 py-2 text-sm">
      <div className="font-medium text-[var(--text-strong)] mb-1">{label}</div>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <span className="w-[8px] h-[8px] rounded-full" style={{ background: entry.color }} />
          <span className="text-[var(--text-muted)]">{entry.name}:</span>
          <span className="font-mono tabular-nums font-medium text-[var(--text-strong)]">{money(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        setData(json.data);
      } catch {
        // Will use fallback below
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Fallback data when API unavailable
  const d = data || {
    kpis: { totalRevenue: 419450, totalExpenses: 360460, netIncome: 58990, outstanding: 78220, totalCash: 278512, revenueChange: 12.4, expenseChange: 8.1, incomeChange: 24.3, outstandingCount: 12 },
    cashFlow: [
      { month: 'Jan', income: 28400, expenses: 22100 }, { month: 'Feb', income: 31200, expenses: 25400 },
      { month: 'Mar', income: 35800, expenses: 28900 }, { month: 'Apr', income: 33900, expenses: 30100 },
      { month: 'May', income: 37400, expenses: 31200 }, { month: 'Jun', income: 35800, expenses: 33800 },
    ],
    topExpenses: [
      { category: 'Software & subscriptions', amount: 48200, pct: 38 }, { category: 'Professional fees', amount: 28400, pct: 22 },
      { category: 'Rent & lease', amount: 19200, pct: 15 }, { category: 'Marketing', amount: 15800, pct: 12 },
    ],
    invoicesAttention: [
      { id: 'INV-1048', customer: 'Acme Corp', total: 24500, dueDate: '2026-06-15', status: 'pending' as const, daysOverdue: 0 },
      { id: 'INV-1047', customer: 'Nexus Labs', total: 18200, dueDate: '2026-06-08', status: 'overdue' as const, daysOverdue: 17 },
    ],
    bankAccounts: [],
  };

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      {loading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="animate-spin text-[var(--text-muted)]" size={24} />
        </div>
      )}

      {/* Header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Dashboard</h1>
          <p className="sub">Welcome back. Here&apos;s your financial overview.</p>
        </div>
        <div className="spacer" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/reports/trial-balance')}>
            <Scale size={16} /> Trial Balance
          </Button>
          <Button onClick={() => router.push('/invoices/new')}>
            <Plus size={16} /> New Invoice
          </Button>
        </div>
      </div>

      {/* KPI row — every card clickable */}
      <div className="kpi-row">
        <button onClick={() => router.push('/reports/profit-loss')} className="text-left w-full">
          <StatCard title="Total Revenue" value={d.kpis.totalRevenue} delta={`+${d.kpis.revenueChange}%`} deltaDirection="up" deltaMuted="vs last year" icon={<TrendingUp size={16} />} color="blue" />
        </button>
        <button onClick={() => router.push('/reports/expense-breakdown')} className="text-left w-full">
          <StatCard title="Expenses" value={d.kpis.totalExpenses} delta={`+${d.kpis.expenseChange}%`} deltaDirection="down" deltaMuted="vs last year" icon={<TrendingDown size={16} />} color="red" />
        </button>
        <button onClick={() => router.push('/reports/profit-loss')} className="text-left w-full">
          <StatCard title="Net Income" value={d.kpis.netIncome} delta={`+${d.kpis.incomeChange}%`} deltaDirection="up" deltaMuted="vs last year" icon={<DollarSign size={16} />} color="green" />
        </button>
        <button onClick={() => router.push('/invoices?status=overdue')} className="text-left w-full">
          <StatCard title="Outstanding" value={d.kpis.outstanding} delta={`${d.kpis.outstandingCount} invoices`} deltaDirection="down" deltaMuted="awaiting payment" icon={<FileText size={16} />} color="gray" />
        </button>
      </div>

      {/* Second KPI row — bank accounts */}
      {d.bankAccounts.length > 0 && (
        <div className="kpi-row mt-4">
          {d.bankAccounts.map((acct) => (
            <button key={acct.id} onClick={() => router.push(`/banking?account=${acct.id}`)} className="text-left w-full">
              <StatCard
                title={acct.name}
                value={acct.balance}
                delta={`••${acct.mask}`}
                deltaDirection={acct.balance >= 0 ? 'up' : 'down'}
                deltaMuted={acct.kind}
                icon={<Building2 size={16} />}
                color={acct.balance >= 0 ? 'blue' : 'red'}
              />
            </button>
          ))}
          <button onClick={() => router.push('/reports/trial-balance')} className="text-left w-full">
            <StatCard title="Total Cash" value={d.kpis.totalCash} delta="All accounts" deltaDirection="up" deltaMuted="combined balance" icon={<CreditCard size={16} />} color="green" />
          </button>
        </div>
      )}

      {/* Charts row */}
      <div className="charts-row mt-6">
        {/* Cash Flow — Area Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h3 className="t-h3">Cash Flow</h3>
              <button onClick={() => router.push('/reports/cash-flow')} className="text-xs text-[var(--accent)] hover:text-[var(--primary)] flex items-center gap-1 font-medium">
                Full report <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.cashFlow}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--success)" stopOpacity={0.18} /><stop offset="100%" stopColor="var(--success)" stopOpacity={0} /></linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--danger)" stopOpacity={0.10} /><stop offset="100%" stopColor="var(--danger)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="income" stroke="var(--success)" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                <Area type="monotone" dataKey="expenses" stroke="var(--danger)" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Top Expenses — Bar Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h3 className="t-h3">Top Expenses</h3>
              <button onClick={() => router.push('/reports/expense-breakdown')} className="text-xs text-[var(--accent)] hover:text-[var(--primary)] flex items-center gap-1 font-medium">
                View all <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.topExpenses} layout="vertical" margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" fill="var(--danger)" radius={[0, 4, 4, 0]} maxBarSize={24} name="Amount" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Bottom section: invoices needing attention */}
      <div className="mt-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h3 className="t-h3">Invoices Needing Attention</h3>
              <button onClick={() => router.push('/invoices?status=overdue')} className="text-xs text-[var(--accent)] hover:text-[var(--primary)] flex items-center gap-1 font-medium">
                View all <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>
          <CardBody>
            {d.invoicesAttention.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-6">All caught up — no invoices need attention.</p>
            ) : (
              <div className="space-y-1">
                {d.invoicesAttention.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className="w-full flex items-center justify-between py-3 px-3 rounded-lg hover:bg-[var(--surface-3)] transition-colors text-left group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        'w-9 h-9 rounded-lg grid place-items-center flex-none font-bold text-xs',
                        inv.status === 'overdue' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]'
                      )}>
                        {inv.customer.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-strong)] truncate group-hover:text-[var(--primary)] transition-colors">
                          {inv.customer}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {inv.id} · Due {format(new Date(inv.dueDate), 'MMM d')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={inv.status === 'overdue' ? 'overdue' : 'pending'}>
                        {inv.status === 'overdue' ? `${inv.daysOverdue}d overdue` : 'Pending'}
                      </Badge>
                      <span className="font-mono text-sm font-medium text-[var(--text-strong)] w-24 text-right">
                        {money(inv.total)}
                      </span>
                      <ArrowUpRight size={14} className="text-[var(--text-faint)] group-hover:text-[var(--primary)] transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
