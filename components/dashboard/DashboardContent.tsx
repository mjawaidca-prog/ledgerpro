'use client'

import { Moon, Sun, Wallet, TrendingUp, TrendingDown, PiggyBank, ArrowUpRight } from 'lucide-react'
import { useTheme, useDensity } from '@/components/providers/ThemeProvider'
import { StatCard } from '@/components/dashboard/StatCard'
import { CashflowChart } from '@/components/charts/CashflowChart'
import { IncomeExpenseChart } from '@/components/charts/IncomeExpenseChart'
import { RecentTransactions } from '@/components/dashboard/RecentTransactions'
import { InvoicesAttention } from '@/components/dashboard/InvoicesAttention'

interface Stats {
  cashOnHand: number
  incomeThisMonth: number
  expensesThisMonth: number
  netProfit: number
  kpiDeltas: {
    cashOnHandPct: number
    cashOnHandDir: 'up' | 'down'
    incomePct: number
    incomeDir: 'up' | 'down'
    expensesPct: number
    expensesDir: 'up' | 'down'
    netProfitPct: number
    netProfitDir: 'up' | 'down'
    netProfitMargin: number
  }
}

interface TxnRow {
  id: string
  date: string
  dateLabel: string
  description: string
  category: string
  categoryColor: string
  account: string
  amount: number
  amountDisplay: string
}

interface AttentionInvoice {
  id: string
  clientName: string
  clientInitials: string
  clientColor: string
  invoiceId: string
  dueLabel: string
  amount: string
  badgeClass: 'badge-overdue' | 'badge-pending'
  badgeText: string
}

interface DashboardContentProps {
  stats: Stats
  cashflowData: { m: string; v: number }[]
  incomeExpenseData: { m: string; inc: number; exp: number }[]
  txnRows: TxnRow[]
  attentionInvoices: AttentionInvoice[]
}

const fmt = (v: number) =>
  '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function DashboardContent({
  stats,
  cashflowData,
  incomeExpenseData,
  txnRows,
  attentionInvoices,
}: DashboardContentProps) {
  const { theme, toggleTheme } = useTheme()
  const { density, setDensity } = useDensity()

  return (
    <>
      {/* Page header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Good morning, Rosa</h1>
          <div className="sub">
            Here&apos;s where Northwind Trading stands · <span className="t-num">May 2026</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="Density">
          <button
            aria-pressed={density === 'comfortable'}
            onClick={() => setDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            aria-pressed={density === 'compact'}
            onClick={() => setDensity('compact')}
          >
            Compact
          </button>
        </div>
        <button
          className="icon-toggle"
          aria-label="Toggle theme"
          title="Toggle theme"
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
      </div>

      {/* KPI row */}
      <div className="kpi-row">
        <StatCard
          label="Cash on hand"
          value={fmt(stats.cashOnHand)}
          delta={`${stats.kpiDeltas.cashOnHandPct}%`}
          deltaDir={stats.kpiDeltas.cashOnHandDir}
          deltaLabel=" vs last month"
          icon={<Wallet />}
          iconColor="blue"
        />
        <StatCard
          label="Income this month"
          value={fmt(stats.incomeThisMonth)}
          delta={`${stats.kpiDeltas.incomePct}%`}
          deltaDir={stats.kpiDeltas.incomeDir}
          deltaLabel=" vs last month"
          icon={<TrendingUp />}
          iconColor="green"
        />
        <StatCard
          label="Expenses this month"
          value={fmt(stats.expensesThisMonth)}
          delta={`${stats.kpiDeltas.expensesPct}%`}
          deltaDir={stats.kpiDeltas.expensesDir}
          deltaLabel=" vs last month"
          icon={<TrendingDown />}
          iconColor="red"
        />
        <StatCard
          label="Net profit"
          value={fmt(stats.netProfit)}
          delta={`${stats.kpiDeltas.netProfitPct}%`}
          deltaDir={stats.kpiDeltas.netProfitDir}
          deltaLabel={` margin ${stats.kpiDeltas.netProfitMargin}%`}
          icon={<PiggyBank />}
          iconColor="blue"
          valueClass="pos"
        />
      </div>

      {/* Charts row */}
      <div className="charts-row">
        {/* Cash-on-hand chart */}
        <div className="card">
          <div className="panel-head">
            <h3 className="t-h3">Cash on hand</h3>
            <div className="spacer" />
            <span className="t-label">Last 8 months</span>
          </div>
          <div className="chart-figure">
            <span className="big">{fmt(stats.cashOnHand)}</span>
            <span className="delta up">
              <ArrowUpRight />+$11,180
            </span>
          </div>
          <div className="chart-body">
            <CashflowChart data={cashflowData} />
          </div>
        </div>

        {/* Income vs expenses chart */}
        <div className="card">
          <div className="panel-head">
            <h3 className="t-h3">Income vs. expenses</h3>
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
          </div>
          <div className="chart-figure">
            <span className="big pos">{fmt(stats.netProfit)}</span>
            <span className="delta up">net this month</span>
          </div>
          <div className="chart-body">
            <IncomeExpenseChart data={incomeExpenseData} />
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="bottom-row">
        <RecentTransactions transactions={txnRows} />
        <InvoicesAttention invoices={attentionInvoices} />
      </div>
    </>
  )
}
