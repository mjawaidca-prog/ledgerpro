'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, FileText, Plus,
  ArrowUpRight, Loader2, Receipt, Building2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

// ─── Types ───

interface DashboardData {
  kpis: {
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    outstanding: number;
    revenueChange: number;
    expenseChange: number;
    incomeChange: number;
    outstandingCount: number;
  };
  cashFlow: { month: string; income: number; expenses: number }[];
  topExpenses: { category: string; amount: number; pct: number }[];
  invoicesAttention: {
    id: string; customer: string; total: number;
    dueDate: string; status: string;
  }[];
}

// ─── Custom chart tooltip ───

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] px-3 py-2 text-sm">
      <div className="font-medium text-[var(--text-strong)] mb-1">{label}</div>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2 text-xs">
          <span
            className="w-[8px] h-[8px] rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-[var(--text-muted)]">{entry.name}:</span>
          <span className="font-mono tabular-nums font-medium text-[var(--text-strong)]">
            {money(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Sample data (replaced by API once auth is live) ───

const cashFlowData = [
  { month: 'Jan', income: 28400, expenses: 22100 },
  { month: 'Feb', income: 31200, expenses: 25400 },
  { month: 'Mar', income: 35800, expenses: 28900 },
  { month: 'Apr', income: 33900, expenses: 30100 },
  { month: 'May', income: 37400, expenses: 31200 },
  { month: 'Jun', income: 35800, expenses: 33800 },
  { month: 'Jul', income: 0, expenses: 0 },
  { month: 'Aug', income: 0, expenses: 0 },
  { month: 'Sep', income: 0, expenses: 0 },
  { month: 'Oct', income: 0, expenses: 0 },
  { month: 'Nov', income: 0, expenses: 0 },
  { month: 'Dec', income: 0, expenses: 0 },
];

const topExpenses = [
  { category: 'Software & subscriptions', amount: 48200, pct: 38 },
  { category: 'Professional fees', amount: 28400, pct: 22 },
  { category: 'Rent & lease', amount: 19200, pct: 15 },
  { category: 'Marketing', amount: 15800, pct: 12 },
  { category: 'Travel', amount: 8600, pct: 7 },
];

const invoicesAttention = [
  { id: 'INV-1048', customer: 'Acme Corp', total: 24500, dueDate: '2026-06-15', status: 'pending' },
  { id: 'INV-1047', customer: 'Nexus Labs', total: 18200, dueDate: '2026-06-08', status: 'overdue' },
  { id: 'INV-1045', customer: 'Orbit Media', total: 12100, dueDate: '2026-06-22', status: 'pending' },
  { id: 'INV-1044', customer: 'Blue Ridge Inc', total: 9420.55, dueDate: '2026-06-01', status: 'paid' },
];

export default function DashboardPage() {
  const router = useRouter();

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      {/* Header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Dashboard</h1>
          <p className="sub">Welcome back, Rosa. Here&apos;s your financial overview for 2026.</p>
        </div>
        <div className="spacer" />
        <Button onClick={() => router.push('/invoices/new')}>
          <Plus size={16} />
          New Invoice
        </Button>
      </div>

      {/* KPI row */}
      <div className="kpi-row">
        <StatCard
          title="Total Revenue"
          value={419450}
          delta="+12.4%"
          deltaDirection="up"
          deltaMuted="vs last year"
          icon={<TrendingUp size={16} />}
          color="blue"
        />
        <StatCard
          title="Expenses"
          value={360460}
          delta="+8.1%"
          deltaDirection="down"
          deltaMuted="vs last year"
          icon={<TrendingDown size={16} />}
          color="red"
        />
        <StatCard
          title="Net Income"
          value={58990}
          delta="+24.3%"
          deltaDirection="up"
          deltaMuted="vs last year"
          icon={<DollarSign size={16} />}
          color="green"
        />
        <StatCard
          title="Outstanding"
          value={78220}
          delta="12 invoices"
          deltaDirection="down"
          deltaMuted="awaiting payment"
          icon={<FileText size={16} />}
          color="gray"
        />
      </div>

      {/* Charts row */}
      <div className="charts-row">
        {/* Cash Flow — Area Chart */}
        <Card>
          <CardHeader>
            <h3 className="t-h3">Cash Flow</h3>
            <div className="spacer" />
            <div className="legend">
              <span className="legend-item">
                <span className="sw" style={{ background: 'var(--success)' }} />
                Income
              </span>
              <span className="legend-item">
                <span className="sw" style={{ background: 'var(--danger)' }} />
                Expenses
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex items-baseline gap-3 mb-2">
              <span className="font-mono tabular-nums text-2xl font-semibold text-[var(--text-strong)] tracking-tighter">
                $419,450
              </span>
              <span className="font-mono text-xs font-semibold inline-flex items-center gap-[3px] text-[var(--success)]">
                <ArrowUpRight size={13} />
                +12.4%
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cashFlowData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--success)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--text-faint)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: 'var(--text-faint)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v === 0 ? '0' : `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="income"
                  name="Income"
                  stroke="var(--success)"
                  strokeWidth={2}
                  fill="url(#incomeGrad)"
                  dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--success)' }}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  fill="url(#expenseGrad)"
                  dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: 'var(--danger)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Top Expenses — Horizontal Bar Chart */}
        <Card>
          <CardHeader>
            <h3 className="t-h3">Top Expenses</h3>
            <div className="spacer" />
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={topExpenses}
                layout="vertical"
                margin={{ top: 0, right: 20, left: 120, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  horizontal={true}
                  vertical={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'var(--text-faint)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 12, fontFamily: 'Inter', fill: 'var(--text)' }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="amount"
                  name="Amount"
                  fill="var(--primary)"
                  radius={[0, 4, 4, 0]}
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="bottom-row">
        {/* Recent invoices */}
        <Card>
          <CardHeader>
            <h3 className="t-h3">Invoices Needing Attention</h3>
            <div className="spacer" />
            <Button variant="ghost" size="sm" onClick={() => router.push('/invoices')}>
              View All
            </Button>
          </CardHeader>
          <div className="inv-list">
            {invoicesAttention.map((inv) => {
              const statusVariant =
                inv.status === 'paid' ? 'paid' as const :
                inv.status === 'overdue' ? 'overdue' as const :
                'pending' as const;
              return (
                <div
                  key={inv.id}
                  className="inv-item cursor-pointer"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                >
                  <div
                    className="av"
                    style={{
                      background: inv.status === 'overdue'
                        ? 'var(--red-600)'
                        : inv.status === 'paid'
                        ? 'var(--green-600)'
                        : 'var(--blue-400)',
                    }}
                  >
                    {inv.customer.charAt(0)}
                  </div>
                  <div className="inv-meta">
                    <div className="inv-client">{inv.customer}</div>
                    <div className="inv-sub">
                      {inv.id} · Due {inv.dueDate}
                    </div>
                  </div>
                  <div className="inv-right">
                    <span className="inv-amt">${inv.total.toLocaleString()}</span>
                    <Badge variant={statusVariant} dot>
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <h3 className="t-h3">Quick Actions</h3>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => router.push('/invoices/new')}
              >
                <FileText size={16} />
                Create Invoice
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => router.push('/expenses/new?kind=bill')}
              >
                <Receipt size={16} />
                Enter Bill
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => router.push('/banking')}
              >
                <Building2 size={16} />
                Review Transactions
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
