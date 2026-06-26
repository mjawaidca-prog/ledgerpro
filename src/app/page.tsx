'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, formatDistanceToNow } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart, Cell,
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, FileText, Plus, CreditCard,
  ArrowUpRight, Loader2, Building2, Scale, Receipt, Upload, BookOpen,
  Clock, AlertTriangle, CheckCircle2, ArrowRight, Sparkles,
  Landmark, Banknote, Wallet, Zap, BarChart3,
} from 'lucide-react';

type DateRange = 'month' | 'quarter' | 'year';

interface DashboardData {
  kpis: {
    totalRevenue: number; totalExpenses: number; netIncome: number;
    outstanding: number; totalCash: number;
    revenueChange: number | null; expenseChange: number | null;
    incomeChange: number | null; outstandingCount: number; invoiceCount: number;
  };
  cashFlow: { month: string; income: number; expenses: number }[];
  topExpenses: { category: string; amount: number; pct: number }[];
  invoicesAttention: { id: string; customer: string; total: number; dueDate: string; status: 'pending' | 'overdue'; daysOverdue: number }[];
  bankAccounts: { id: string; name: string; balance: number; kind: string; mask: string; syncStatus: string; unreconciledCount: number }[];
  recentActivity: { id: string; sourceType: string; sourceId: string | null; description: string; amount: number; date: string; createdAt: string }[];
}

// ─── Helpers ───

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-[var(--shadow-lg)] px-4 py-3 text-sm">
      <div className="font-semibold text-[var(--text-strong)] mb-2">{label}</div>
      {payload.map((entry: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2 text-xs mb-1 last:mb-0">
          <span className="w-[10px] h-[10px] rounded-sm" style={{ background: entry.color }} />
          <span className="text-[var(--text-muted)]">{entry.name}:</span>
          <span className="font-mono tabular-nums font-semibold text-[var(--text-strong)]">{money(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function deltaText(change: number | null): string {
  if (change === null) return '—';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change}%`;
}

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-[var(--surface-3)] rounded-lg', className)} />;
}

const accountKindIcons: Record<string, React.ElementType> = {
  checking: Landmark,
  savings: Wallet,
  creditcard: CreditCard,
  payoutclearing: Scale,
};

const accountKindColors: Record<string, string> = {
  checking: '#1f6feb',
  savings: '#7c3aed',
  creditcard: '#e0484e',
  payoutclearing: '#d6961f',
};

const COLORS = ['#1f6feb', '#7c3aed', '#16a063', '#d6961f', '#e0484e', '#0891b2', '#db2777', '#ea580c'];

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('year');

  const fetchData = useCallback(async (range: DateRange) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?range=${range}`);
      if (!res.ok) throw new Error(res.status === 401 ? 'Please sign in.' : 'Failed to load dashboard.');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(dateRange); }, [dateRange, fetchData]);

  const d = data;
  const rangeLabel = dateRange === 'month' ? 'this month' : dateRange === 'quarter' ? 'this quarter' : 'this year';
  const totalUnreconciled = d?.bankAccounts?.reduce((s, a) => s + a.unreconciledCount, 0) || 0;

  return (
    <AppShell>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--text-strong)] tracking-tight flex items-center gap-2">
            <span className="w-1.5 h-6 rounded-full bg-gradient-to-b from-[var(--primary)] to-[var(--primary-hover)]" />
            {greeting()}, Rosa 👋
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Here's your financial overview for <span className="font-medium text-[var(--text-strong)]">{rangeLabel}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date range — colorful toggle */}
          <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 shadow-[var(--shadow-xs)]">
            {([
              { key: 'month' as DateRange, label: 'Month', color: '#7c3aed' },
              { key: 'quarter' as DateRange, label: 'Quarter', color: '#d6961f' },
              { key: 'year' as DateRange, label: 'Year', color: '#1f6feb' },
            ]).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setDateRange(key)}
                className={cn(
                  'px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5',
                  dateRange === key
                    ? 'text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-3)]'
                )}
                style={dateRange === key ? { background: color } : undefined}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  dateRange === key ? 'bg-white/60' : ''
                )}
                style={dateRange !== key ? { background: color } : undefined} />
                {label}
              </button>
            ))}
          </div>
          <Button onClick={() => router.push('/invoices/new')} className="shadow-[var(--shadow-xs)]">
            <Plus size={16} /> New Invoice
          </Button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-5 bg-[var(--danger-soft)] border border-[var(--danger)]/20 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[var(--danger)]/10 grid place-items-center flex-none">
            <AlertTriangle size={20} className="text-[var(--danger)]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--danger)]">Could not load dashboard</p>
            <p className="text-xs text-[var(--text-muted)]">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => fetchData(dateRange)}>Retry</Button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)]">
                <SkeletonPulse className="h-3 w-20 mb-3" />
                <SkeletonPulse className="h-7 w-32 mb-2" />
                <SkeletonPulse className="h-3 w-14" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] h-[260px]">
              <SkeletonPulse className="h-4 w-24 mb-6" />
              <SkeletonPulse className="h-[180px] w-full" />
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)]">
              <SkeletonPulse className="h-4 w-24 mb-6" />
              <SkeletonPulse className="h-3 w-full mb-2" /><SkeletonPulse className="h-3 w-full mb-2" /><SkeletonPulse className="h-3 w-full mb-2" /><SkeletonPulse className="h-3 w-3/4" />
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && !error && d && (
        <>
          {/* Quick Actions bar */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)] mr-1">Quick Actions</span>
            {[
              { label: 'Invoice', icon: FileText, href: '/invoices/new', color: 'border-l-[#1f6feb]' },
              { label: 'Expense', icon: Receipt, href: '/expenses/new', color: 'border-l-[#e0484e]' },
              { label: 'Import', icon: Upload, href: '/banking', color: 'border-l-[#7c3aed]' },
              { label: 'Journal', icon: BookOpen, href: '/journal/new', color: 'border-l-[#16a063]' },
              { label: 'Reconcile', icon: Scale, href: '/banking', color: 'border-l-[#d6961f]' },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => router.push(a.href)}
                className={cn(
                  'flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-lg text-xs font-semibold',
                  'bg-[var(--surface)] border border-[var(--border)] border-l-[3px]',
                  'text-[var(--text)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-xs)]',
                  'transition-all',
                  a.color
                )}
              >
                <a.icon size={13} />
                {a.label}
              </button>
            ))}
          </div>

          {/* ── KPI Row — 5 colorful stat cards ── */}
          <div className="grid grid-cols-5 gap-4 mb-5">
            {/* Revenue */}
            <button onClick={() => router.push('/reports/profit-loss')}
              className="group text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:border-[#1f6feb]/30 transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#1f6feb] to-[#5b8bf8]" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1f6feb]/15 to-[#1f6feb]/5 grid place-items-center">
                  <TrendingUp size={15} className="text-[#1f6feb]" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Revenue</span>
              </div>
              <div className="font-mono tabular-nums text-2xl font-bold text-[var(--text-strong)] tracking-tight">{money(d.kpis.totalRevenue)}</div>
              <div className={cn('flex items-center gap-1 mt-2 text-xs font-semibold', d.kpis.revenueChange !== null && d.kpis.revenueChange >= 0 ? 'text-[#16a063]' : 'text-[var(--danger)]')}>
                {deltaText(d.kpis.revenueChange)}
                <span className="text-[var(--text-faint)] font-normal">vs prior</span>
              </div>
            </button>

            {/* Expenses */}
            <button onClick={() => router.push('/reports/expense-breakdown')}
              className="group text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:border-[#e0484e]/30 transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#e0484e] to-[#f87171]" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#e0484e]/15 to-[#e0484e]/5 grid place-items-center">
                  <TrendingDown size={15} className="text-[#e0484e]" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Expenses</span>
              </div>
              <div className="font-mono tabular-nums text-2xl font-bold text-[var(--text-strong)] tracking-tight">{money(d.kpis.totalExpenses)}</div>
              <div className={cn('flex items-center gap-1 mt-2 text-xs font-semibold', d.kpis.expenseChange !== null && d.kpis.expenseChange <= 0 ? 'text-[#16a063]' : 'text-[var(--danger)]')}>
                {deltaText(d.kpis.expenseChange)}
                <span className="text-[var(--text-faint)] font-normal">vs prior</span>
              </div>
            </button>

            {/* Net Income */}
            <button onClick={() => router.push('/reports/profit-loss')}
              className="group text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:border-[#16a063]/30 transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#16a063] to-[#4ade80]" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#16a063]/15 to-[#16a063]/5 grid place-items-center">
                  <DollarSign size={15} className="text-[#16a063]" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Net Income</span>
              </div>
              <div className={cn('font-mono tabular-nums text-2xl font-bold tracking-tight', d.kpis.netIncome >= 0 ? 'text-[#16a063]' : 'text-[var(--danger)]')}>{money(d.kpis.netIncome)}</div>
              <div className={cn('flex items-center gap-1 mt-2 text-xs font-semibold', d.kpis.incomeChange !== null && d.kpis.incomeChange >= 0 ? 'text-[#16a063]' : 'text-[var(--danger)]')}>
                {deltaText(d.kpis.incomeChange)}
                <span className="text-[var(--text-faint)] font-normal">vs prior</span>
              </div>
            </button>

            {/* Cash Position */}
            <button onClick={() => router.push('/banking')}
              className="group text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:border-[#7c3aed]/30 transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#7c3aed] to-[#a78bfa]" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7c3aed]/15 to-[#7c3aed]/5 grid place-items-center">
                  <Wallet size={15} className="text-[#7c3aed]" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Cash</span>
              </div>
              <div className="font-mono tabular-nums text-2xl font-bold text-[var(--text-strong)] tracking-tight">{money(d.kpis.totalCash)}</div>
              <div className="flex items-center gap-1 mt-2 text-xs font-medium text-[var(--text-muted)]">
                <span>{d.bankAccounts.length} account{d.bankAccounts.length !== 1 ? 's' : ''}</span>
                {totalUnreconciled > 0 && (
                  <Badge variant="pending" className="ml-1">{totalUnreconciled} to review</Badge>
                )}
              </div>
            </button>

            {/* Outstanding */}
            <button onClick={() => router.push('/invoices?status=overdue')}
              className="group text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:border-[#d6961f]/30 transition-all relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#d6961f] to-[#fbbf24]" />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#d6961f]/15 to-[#d6961f]/5 grid place-items-center">
                  <Clock size={15} className="text-[#d6961f]" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-muted)]">Outstanding</span>
              </div>
              <div className="font-mono tabular-nums text-2xl font-bold text-[var(--text-strong)] tracking-tight">{money(d.kpis.outstanding)}</div>
              <div className="flex items-center gap-1 mt-2 text-xs font-medium text-[var(--text-muted)]">
                <span>{d.kpis.outstandingCount} invoice{d.kpis.outstandingCount !== 1 ? 's' : ''}</span>
                {d.kpis.outstandingCount > 0 && <span className="text-[var(--danger)]">due</span>}
              </div>
            </button>
          </div>

          {/* ── Main Grid: Charts + Side Panel ── */}
          <div className="grid grid-cols-3 gap-5 mb-5">
            {/* Cash Flow Chart */}
            <div className="col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-strong)]">Cash Flow</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Income vs expenses over time</p>
                </div>
                <button onClick={() => router.push('/reports/cash-flow')}
                  className="text-xs font-semibold text-[#1f6feb] hover:text-[#1857c4] flex items-center gap-1 transition-colors">
                  Full report <ArrowUpRight size={12} />
                </button>
              </div>
              {d.cashFlow.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[200px] text-[var(--text-muted)]">
                  <BarChart3 size={32} className="mb-2 opacity-30" />
                  <p className="text-sm">No transaction data yet.</p>
                  <p className="text-xs mt-1">Import bank transactions to see cash flow.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={d.cashFlow}>
                    <defs>
                      <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1f6feb" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#1f6feb" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e0484e" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#e0484e" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
                      tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="income" stroke="#1f6feb" fill="url(#incomeGrad)" strokeWidth={2.5} name="Income" dot={false} activeDot={{ r: 4, fill: '#1f6feb' }} />
                    <Area type="monotone" dataKey="expenses" stroke="#e0484e" fill="url(#expenseGrad)" strokeWidth={2.5} name="Expenses" dot={false} activeDot={{ r: 4, fill: '#e0484e' }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Recent Activity */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-[var(--shadow-sm)] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-strong)]">Recent Activity</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Latest journal entries</p>
                </div>
                <button onClick={() => router.push('/journal')}
                  className="text-xs font-semibold text-[#1f6feb] hover:text-[#1857c4] flex items-center gap-1 transition-colors">
                  Journal <ArrowUpRight size={12} />
                </button>
              </div>
              {d.recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 text-[var(--text-muted)]">
                  <BookOpen size={28} className="mb-2 opacity-30" />
                  <p className="text-sm">No journal entries yet.</p>
                  <p className="text-xs mt-1">Create invoices or record expenses to see activity.</p>
                </div>
              ) : (
                <div className="space-y-0.5 flex-1 overflow-y-auto -mx-2 px-2">
                  {d.recentActivity.slice(0, 8).map((entry) => {
                    const Icon = entry.sourceType === 'invoice' ? FileText
                      : entry.sourceType === 'bill' ? Receipt
                      : entry.sourceType === 'payment' ? DollarSign
                      : entry.sourceType === 'transfer' ? ArrowRight
                      : BookOpen;
                    const colorMap: Record<string, string> = {
                      invoice: '#d6961f', bill: '#e0484e', payment: '#16a063',
                      transfer: '#7c3aed', manual: '#697587',
                    };
                    const dotColor = colorMap[entry.sourceType] || '#697587';

                    return (
                      <button
                        key={entry.id}
                        onClick={() => {
                          if (entry.sourceId) {
                            if (entry.sourceType === 'invoice') router.push(`/invoices/${entry.sourceId}`);
                            else if (entry.sourceType === 'bill') router.push(`/expenses/${entry.sourceId}`);
                            else router.push(`/journal/${entry.id}`);
                          } else router.push(`/journal/${entry.id}`);
                        }}
                        className="w-full flex items-center gap-3 py-2 px-2.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors text-left group"
                      >
                        <div className="w-7 h-7 rounded-lg grid place-items-center flex-none" style={{ background: `${dotColor}12` }}>
                          <Icon size={13} style={{ color: dotColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] text-[var(--text-strong)] truncate group-hover:text-[#1f6feb] transition-colors font-medium">
                            {entry.description}
                          </div>
                          <div className="text-[10px] text-[var(--text-faint)]">
                            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] tabular-nums font-semibold text-[var(--text-muted)] shrink-0">
                          {money(entry.amount)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Bottom Row: Bank Accounts + Overdue Invoices ── */}
          <div className="grid grid-cols-2 gap-5">
            {/* Bank Accounts */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-strong)]">Bank Accounts</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Connected accounts & balances</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => router.push('/banking')}>
                  <Plus size={13} /> Connect
                </Button>
              </div>
              {d.bankAccounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
                  <Building2 size={36} className="mb-3 opacity-25" />
                  <p className="text-sm font-medium">No bank accounts connected</p>
                  <p className="text-xs mt-1">Connect your checking, savings, or credit card accounts.</p>
                  <Button size="sm" className="mt-4" onClick={() => router.push('/banking')}>
                    <Plus size={13} /> Add Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {d.bankAccounts.map((acct) => {
                    const Icon = accountKindIcons[acct.kind] || Building2;
                    const accentColor = accountKindColors[acct.kind] || '#697587';
                    return (
                      <button
                        key={acct.id}
                        onClick={() => router.push(`/banking/reconcile?accountId=${acct.id}`)}
                        className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-all group text-left"
                      >
                        <div className="w-10 h-10 rounded-xl grid place-items-center flex-none" style={{ background: `${accentColor}14` }}>
                          <Icon size={18} style={{ color: accentColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-strong)] group-hover:text-[#1f6feb] transition-colors">
                            {acct.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-faint)]">
                            {acct.kind} {acct.mask ? `••${acct.mask}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={cn('font-mono text-sm font-bold tabular-nums', acct.balance >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]')}>
                            {money(acct.balance)}
                          </div>
                          <div className="flex items-center gap-1.5 justify-end mt-0.5">
                            {acct.unreconciledCount > 0 ? (
                              <Badge variant="pending">{acct.unreconciledCount} to reconcile</Badge>
                            ) : (
                              <span className="text-[10px] text-[var(--text-faint)] flex items-center gap-0.5">
                                <CheckCircle2 size={10} className="text-[#16a063]" /> Reconciled
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Invoices Needing Attention */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-strong)]">Invoices Needing Attention</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {d.invoicesAttention.length > 0
                      ? `${d.invoicesAttention.length} overdue or pending`
                      : 'All caught up!'}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => router.push('/invoices?status=overdue')}>
                  View all <ArrowRight size={12} />
                </Button>
              </div>
              {d.invoicesAttention.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)]">
                  <div className="w-16 h-16 rounded-2xl bg-[#16a063]/10 grid place-items-center mb-3">
                    <CheckCircle2 size={28} className="text-[#16a063]" />
                  </div>
                  <p className="text-sm font-medium text-[#16a063]">All clear</p>
                  <p className="text-xs mt-1">No overdue or pending invoices.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {d.invoicesAttention.slice(0, 6).map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                      className="w-full flex items-center justify-between py-3 px-3.5 rounded-xl hover:bg-[var(--surface-3)] transition-colors group text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          'w-9 h-9 rounded-xl grid place-items-center flex-none font-bold text-[11px]',
                          inv.status === 'overdue'
                            ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                            : 'bg-[var(--warning-soft)] text-[var(--warning)]'
                        )}>
                          {inv.customer.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--text-strong)] truncate group-hover:text-[#1f6feb] transition-colors">
                            {inv.customer}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">{inv.id} · Due {format(new Date(inv.dueDate), 'MMM d')}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant={inv.status === 'overdue' ? 'overdue' : 'pending'}>
                          {inv.status === 'overdue' ? `${inv.daysOverdue}d overdue` : 'Pending'}
                        </Badge>
                        <span className="font-mono text-[13px] font-bold text-[var(--text-strong)] w-24 text-right tabular-nums">
                          {money(inv.total)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Metrics Footer ── */}
          <div className="grid grid-cols-4 gap-4 mt-5">
            {[
              { label: 'Total Invoices', value: String(d.kpis.invoiceCount), icon: FileText, color: '#1f6feb' },
              { label: 'Bank Accounts', value: String(d.bankAccounts.length), icon: Building2, color: '#7c3aed' },
              { label: 'Cash Flow', value: d.kpis.totalRevenue > d.kpis.totalExpenses ? 'Positive' : 'Negative',
                color: d.kpis.totalRevenue > d.kpis.totalExpenses ? '#16a063' : '#e0484e' },
              { label: 'Period', value: rangeLabel, icon: Clock, color: '#d6961f' },
            ].map((m) => (
              <div key={m.label}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 shadow-[var(--shadow-xs)] flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg grid place-items-center flex-none" style={{ background: `${m.color}12` }}>
                  {m.icon ? <m.icon size={16} style={{ color: m.color }} /> : <Zap size={16} style={{ color: m.color }} />}
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)]">{m.label}</div>
                  <div className="text-sm font-bold text-[var(--text-strong)]">{m.value}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
