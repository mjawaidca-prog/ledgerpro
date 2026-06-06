'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import {
  Plus,
  Download,
  Search,
  SlidersHorizontal,
  Check,
  Trash2,
  ChevronsUpDown,
  Pencil,
  CheckCircle2,
  Copy,
  Ellipsis,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  FileText,
  TrendingDown,
  Tag,
  CreditCard,
  Paperclip,
} from 'lucide-react'
import type { ExpenseRow, ExpenseStats } from '@/app/expenses/page'

const VENDOR_MAP: Record<string, { i: string; c: string }> = {
  'AWS':                 { i: 'AW', c: '#ec912d' },
  'WeWork':              { i: 'WE', c: '#1f6feb' },
  'Gusto':               { i: 'G',  c: '#f45d48' },
  'Staples':             { i: 'ST', c: '#cf353c' },
  'Comcast Business':    { i: 'CB', c: '#4b5666' },
  'Adobe':               { i: 'A',  c: '#e0484e' },
  'Delta Air Lines':     { i: 'DL', c: '#9b1b30' },
  'State Farm':          { i: 'SF', c: '#cf353c' },
  'Uber':                { i: 'U',  c: '#1f2733' },
  'City Power & Light':  { i: 'CP', c: '#0ea5b5' },
}

const CAT_COLORS: Record<string, string> = {
  'Software':         '#1f6feb',
  'Rent & lease':     '#d6961f',
  'Payroll':          '#4b5666',
  'Office supplies':  '#7c5cff',
  'Utilities':        '#5b8bf8',
  'Travel & meals':   '#0ea5b5',
  'Insurance':        '#16a063',
}

const BADGE_MAP: Record<string, { cls: string; label: string }> = {
  Paid:    { cls: 'badge-paid',    label: 'Paid' },
  Open:    { cls: 'badge-open',    label: 'Open' },
  Overdue: { cls: 'badge-overdue', label: 'Overdue' },
  Draft:   { cls: 'badge-draft',   label: 'Draft' },
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 })
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

type SortKey = 'id' | 'date' | 'vendor' | 'amt'
type SortDir = 'asc' | 'desc'

interface RowMenuState {
  expenseId: string
  x: number
  y: number
}

export function ExpenseListContent({
  expenses,
  stats,
}: {
  expenses: ExpenseRow[]
  stats: ExpenseStats
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('All')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)

  const deleteExpense = trpc.expenses.delete.useMutation()
  const updateExpense = trpc.expenses.update.useMutation()

  const handleMarkPaid = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      try {
        await Promise.all(ids.map((id) => updateExpense.mutateAsync({ id, status: 'Paid' })))
        setSelected(new Set())
        setRowMenu(null)
        router.refresh()
      } catch {
        alert('Could not update status. Please try again.')
      }
    },
    [updateExpense, router],
  )

  const handleDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const label = ids.length === 1 ? ids[0] : `${ids.length} items`
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
      try {
        await Promise.all(ids.map((id) => deleteExpense.mutateAsync({ id })))
        setSelected(new Set())
        setRowMenu(null)
        router.refresh()
      } catch {
        alert('Could not delete. Please try again.')
      }
    },
    [deleteExpense, router],
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) {
        setRowMenu(null)
      }
    }
    if (rowMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [rowMenu])

  const counts = useMemo(() => ({
    All:           expenses.length,
    'Unpaid bills': expenses.filter((d) => d.kind === 'bill' && (d.status === 'Open' || d.status === 'Overdue')).length,
    Overdue:       expenses.filter((d) => d.status === 'Overdue').length,
    Paid:          expenses.filter((d) => d.status === 'Paid').length,
    Expenses:      expenses.filter((d) => d.kind === 'expense').length,
  }), [expenses])

  const filtered = useMemo(() => {
    let rows = expenses

    if (activeTab !== 'All') {
      if (activeTab === 'Unpaid bills') {
        rows = rows.filter((r) => r.kind === 'bill' && (r.status === 'Open' || r.status === 'Overdue'))
      } else if (activeTab === 'Overdue') {
        rows = rows.filter((r) => r.status === 'Overdue')
      } else if (activeTab === 'Paid') {
        rows = rows.filter((r) => r.status === 'Paid')
      } else if (activeTab === 'Expenses') {
        rows = rows.filter((r) => r.kind === 'expense')
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          r.vendorName.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q),
      )
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'id')     cmp = a.id.localeCompare(b.id)
      else if (sortKey === 'date')   cmp = a.date.localeCompare(b.date)
      else if (sortKey === 'vendor') cmp = a.vendorName.localeCompare(b.vendorName)
      else if (sortKey === 'amt')    cmp = a.amount - b.amount
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [expenses, activeTab, search, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id))

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((r) => r.id)))
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tabs = ['All', 'Unpaid bills', 'Overdue', 'Paid', 'Expenses']

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <h1 className="greet">Expenses</h1>
          <div className="sub">
            Track bills and spending across Northwind Trading ·{' '}
            <span className="t-num">{expenses.length} this period</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="head-tools">
          <Link href="/expenses/bills/new" className="btn btn-secondary">
            <FileText />Enter bill
          </Link>
          <Link href="/expenses/new" className="btn btn-primary">
            <Plus />New expense
          </Link>
        </div>
      </div>

      {/* KPI STATS */}
      <div className="kpi-row">
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico blue"><FileText /></span>
            <span className="stat-label">Unpaid bills</span>
          </div>
          <div className="stat-value">{fmtMoney(stats.unpaidBills)}</div>
          <div className="stat-delta">
            <span className="muted">{counts['Unpaid bills']} bills awaiting payment</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico red"><AlertCircle /></span>
            <span className="stat-label">Overdue</span>
          </div>
          <div className="stat-value neg">{fmtMoney(stats.overdue)}</div>
          <div className="stat-delta down">
            <ArrowUpRight />{counts.Overdue} bills <span className="muted">past due</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico green"><CheckCircle2 /></span>
            <span className="stat-label">Paid this month</span>
          </div>
          <div className="stat-value">{fmtMoney(stats.paidThisMonth)}</div>
          <div className="stat-delta up">
            <ArrowUpRight />{counts.Paid} paid <span className="muted">this period</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico gray"><TrendingDown /></span>
            <span className="stat-label">Total expenses (MTD)</span>
          </div>
          <div className="stat-value">{fmtMoney(stats.totalExpenses)}</div>
          <div className="stat-delta down">
            <ArrowDownRight />3.3% <span className="muted">vs last month</span>
          </div>
        </div>
      </div>

      {/* FILTER TABS */}
      <div className="filterbar">
        <div className="ftabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab ? 'true' : 'false'}
              onClick={() => setActiveTab(tab)}
            >
              {tab}{' '}
              <span className="cnt">{counts[tab as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* SEARCH ROW */}
      <div className="search-row">
        <div className="input-group">
          <span className="lead-icon"><Search /></span>
          <input
            className="input"
            type="text"
            placeholder="Search by vendor, category, or reference…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grow" />
        <button className="btn btn-secondary"><SlidersHorizontal />Filters</button>
        <button className="btn btn-secondary"><Download />Export</button>
      </div>

      {/* TABLE */}
      <div className="table-wrap">
        {/* Bulk action bar */}
        <div className={`bulkbar${selected.size > 0 ? ' show' : ''}`}>
          <span className="bcount"><span>{selected.size}</span> selected</span>
          <div className="spacer" />
          <button className="btn btn-secondary btn-sm" onClick={() => handleMarkPaid([...selected])}><Check />Mark paid</button>
          <button className="btn btn-secondary btn-sm"><Tag />Categorize</button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)' }}
            onClick={() => handleDelete([...selected])}
          >
            <Trash2 />Delete
          </button>
        </div>

        <table className="data" id="exp-table">
          <thead>
            <tr>
              <th className="col-check">
                <span
                  className={`tcheck${allVisibleSelected ? ' on' : ''}`}
                  role="checkbox"
                  aria-checked={allVisibleSelected}
                  onClick={toggleSelectAll}
                >
                  <Check />
                </span>
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('date')}
              >
                <span className="th-inner">
                  Date <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('vendor')}
              >
                <span className="th-inner">
                  Vendor / payee <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th>Category</th>
              <th>Account</th>
              <th>Reference</th>
              <th
                className="sortable num"
                onClick={() => handleSort('amt')}
              >
                <span className="th-inner">
                  Amount <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th>Status</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const av = VENDOR_MAP[row.vendorName] ?? {
                i: getInitials(row.vendorName),
                c: '#697587',
              }
              const badge = BADGE_MAP[row.status] ?? { cls: 'badge-draft', label: row.status }
              const catColor = CAT_COLORS[row.category] ?? '#9aa6b8'
              const isSelected = selected.has(row.id)
              const isBill = row.kind === 'bill'
              return (
                <tr key={row.id} data-status={row.status} data-kind={row.kind}>
                  <td className="col-check">
                    <span
                      className={`tcheck row-check${isSelected ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={isSelected}
                      onClick={() => toggleRow(row.id)}
                    >
                      <Check />
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{fmtDate(row.date)}</td>
                  <td className="cust">
                    <span className="cust-wrap">
                      <span className="av" style={{ background: av.c }}>{av.i}</span>
                      <span>{row.vendorName}</span>
                    </span>
                  </td>
                  <td>
                    <span className="cat-cell">
                      <span className="cat-dot" style={{ background: catColor }} />
                      {row.category}
                    </span>
                  </td>
                  <td>
                    <span className="pay-chip">
                      {isBill ? <FileText /> : <CreditCard />}
                      {row.payAccount}
                    </span>
                  </td>
                  <td>
                    <span
                      className="ref-num"
                      onClick={() => isBill && router.push(`/expenses/bills/${row.id}`)}
                    >
                      {row.id}
                    </span>
                  </td>
                  <td className="amt-expense">{fmtMoney(row.amount)}</td>
                  <td>
                    <span className={`badge ${badge.cls}`}>
                      <span className="dot" />
                      {badge.label}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      className="row-action"
                      aria-label="Row actions"
                      onClick={(e) => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setRowMenu(
                          rowMenu?.expenseId === row.id
                            ? null
                            : {
                                expenseId: row.id,
                                x: Math.min(r.left, window.innerWidth - 220),
                                y: r.bottom + 6,
                              },
                        )
                      }}
                    >
                      <Ellipsis />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {filtered.length === 0 && (
            <tbody>
              <tr className="empty-row">
                <td colSpan={9}>No expenses match this filter.</td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      {/* ROW ACTIONS MENU */}
      {rowMenu && (
        <div
          ref={rowMenuRef}
          className="menu open"
          style={{
            position: 'fixed',
            minWidth: '200px',
            top: rowMenu.y,
            left: rowMenu.x,
          }}
        >
          <div
            className="menu-item"
            onClick={() => {
              router.push(`/expenses/bills/${rowMenu.expenseId}`)
              setRowMenu(null)
            }}
          >
            <Pencil />Edit
          </div>
          <div className="menu-item" onClick={() => handleMarkPaid([rowMenu.expenseId])}>
            <CheckCircle2 />Mark as paid
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <Paperclip />View receipt
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <Copy />Duplicate
          </div>
          <div className="menu-sep" />
          <div
            className="menu-item"
            style={{ color: 'var(--danger)' }}
            onClick={() => handleDelete([rowMenu.expenseId])}
          >
            <Trash2 style={{ color: 'var(--danger)' }} />Delete
          </div>
        </div>
      )}
    </>
  )
}
