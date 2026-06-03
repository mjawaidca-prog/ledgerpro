'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Download,
  Search,
  SlidersHorizontal,
  Calendar,
  Send,
  Check,
  Trash2,
  ChevronsUpDown,
  Pencil,
  CheckCircle2,
  Copy,
  Ellipsis,
  X,
  ArrowUpRight,
  Hourglass,
  AlertCircle,
  FileEdit,
} from 'lucide-react'
import type { InvoiceRow, InvoiceStats } from '@/app/invoices/page'

const AVATAR_MAP: Record<string, { i: string; c: string }> = {
  'Atlas Logistics':   { i: 'AL', c: '#0f8a53' },
  'Brightline Studio': { i: 'BS', c: '#b97c12' },
  'Cedar & Co.':       { i: 'CC', c: '#cf353c' },
  'Summit Health':     { i: 'SH', c: '#3074ef' },
  'Vertex Partners':   { i: 'VP', c: '#4b5666' },
  'Riverside Café':    { i: 'RC', c: '#16a063' },
  'Meridian Design':   { i: 'MD', c: '#1857c4' },
  'Harbor Foods':      { i: 'HF', c: '#697587' },
  'Quill & Co.':       { i: 'QC', c: '#b97c12' },
}

const BADGE_MAP: Record<string, { cls: string; label: string }> = {
  paid:    { cls: 'badge-paid',    label: 'Paid' },
  sent:    { cls: 'badge-info',    label: 'Sent' },
  overdue: { cls: 'badge-overdue', label: 'Overdue' },
  draft:   { cls: 'badge-draft',   label: 'Draft' },
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

type SortKey = 'id' | 'cust' | 'issue' | 'due' | 'amt'
type SortDir = 'asc' | 'desc'

interface RowMenuState {
  invoiceId: string
  x: number
  y: number
}

export function InvoiceListContent({
  invoices,
  stats,
}: {
  invoices: InvoiceRow[]
  stats: InvoiceStats
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('All')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('issue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)

  // Close row menu on outside click
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
    All: invoices.length,
    Draft: invoices.filter((d) => d.status === 'draft').length,
    Sent: invoices.filter((d) => d.status === 'sent').length,
    Unpaid: invoices.filter((d) => d.status === 'sent' || d.status === 'overdue').length,
    Paid: invoices.filter((d) => d.status === 'paid').length,
    Overdue: invoices.filter((d) => d.status === 'overdue').length,
  }), [invoices])

  const filtered = useMemo(() => {
    let rows = invoices

    // Tab filter
    if (activeTab !== 'All') {
      if (activeTab === 'Unpaid') {
        rows = rows.filter((r) => r.status === 'sent' || r.status === 'overdue')
      } else {
        rows = rows.filter((r) => r.status === activeTab.toLowerCase())
      }
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q),
      )
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'id') cmp = a.id.localeCompare(b.id)
      else if (sortKey === 'cust') cmp = a.customerName.localeCompare(b.customerName)
      else if (sortKey === 'issue') cmp = a.issueDate.localeCompare(b.issueDate)
      else if (sortKey === 'due') cmp = a.dueDate.localeCompare(b.dueDate)
      else if (sortKey === 'amt') cmp = a.amount - b.amount
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [invoices, activeTab, search, sortKey, sortDir])

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

  const tabs = ['All', 'Draft', 'Sent', 'Unpaid', 'Paid', 'Overdue']

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <h1 className="greet">Invoices</h1>
          <div className="sub">
            Track, send, and get paid ·{' '}
            <span className="t-num">{invoices.length} invoices</span> this period
          </div>
        </div>
        <div className="spacer" />
        <div className="head-tools">
          <button className="btn btn-secondary">
            <Download />Export
          </button>
          <Link href="/invoices/new" className="btn btn-primary">
            <Plus />New invoice
          </Link>
        </div>
      </div>

      {/* KPI STATS */}
      <div className="kpi-row">
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico blue"><Hourglass /></span>
            <span className="stat-label">Outstanding</span>
          </div>
          <div className="stat-value">{fmtMoney(stats.outstanding)}</div>
          <div className="stat-delta">
            <span className="muted">across {counts.Sent + counts.Overdue} invoices</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico red"><AlertCircle /></span>
            <span className="stat-label">Overdue</span>
          </div>
          <div className="stat-value neg">{fmtMoney(stats.overdue)}</div>
          <div className="stat-delta down">
            <ArrowUpRight />{counts.Overdue} invoices{' '}
            <span className="muted">need attention</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico green"><CheckCircle2 /></span>
            <span className="stat-label">Paid this month</span>
          </div>
          <div className="stat-value pos">{fmtMoney(stats.paidThisMonth)}</div>
          <div className="stat-delta up">
            <ArrowUpRight />{counts.Paid} invoices{' '}
            <span className="muted">collected</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico gray"><FileEdit /></span>
            <span className="stat-label">Draft</span>
          </div>
          <div className="stat-value">{fmtMoney(stats.draft)}</div>
          <div className="stat-delta">
            <span className="muted">{counts.Draft} unsent draft{counts.Draft !== 1 ? 's' : ''}</span>
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
            placeholder="Search by customer or invoice #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grow" />
        <button className="btn btn-secondary"><SlidersHorizontal />Filters</button>
        <button className="btn btn-secondary"><Calendar />Date range</button>
      </div>

      {/* TABLE */}
      <div className="table-wrap">
        {/* Bulk action bar */}
        <div className={`bulkbar${selected.size > 0 ? ' show' : ''}`}>
          <span className="bcount"><span>{selected.size}</span> selected</span>
          <div className="spacer" />
          <button className="btn btn-secondary btn-sm"><Send />Send</button>
          <button className="btn btn-secondary btn-sm"><Check />Mark paid</button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 />Delete
          </button>
        </div>

        <table className="data" id="inv-table">
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
                onClick={() => handleSort('id')}
              >
                <span className="th-inner">
                  Invoice # <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('cust')}
              >
                <span className="th-inner">
                  Customer <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('issue')}
              >
                <span className="th-inner">
                  Issue date <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('due')}
              >
                <span className="th-inner">
                  Due date <ChevronsUpDown className="sort-ico" />
                </span>
              </th>
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
              const av = AVATAR_MAP[row.customerName] ?? {
                i: getInitials(row.customerName),
                c: '#697587',
              }
              const badge = BADGE_MAP[row.status] ?? { cls: 'badge-draft', label: row.status }
              const isSelected = selected.has(row.id)
              return (
                <tr key={row.id} data-status={row.status}>
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
                  <td>
                    <span
                      className="inv-id"
                      onClick={() => router.push(`/invoices/${row.id}`)}
                    >
                      {row.id}
                    </span>
                  </td>
                  <td className="cust">
                    <span className="cust-wrap">
                      <span className="av" style={{ background: av.c }}>{av.i}</span>
                      <span>{row.customerName}</span>
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{fmtDate(row.issueDate)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{fmtDate(row.dueDate)}</td>
                  <td className="num">{fmtMoney(row.amount)}</td>
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
                          rowMenu?.invoiceId === row.id
                            ? null
                            : {
                                invoiceId: row.id,
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
                <td colSpan={8}>No invoices match this filter.</td>
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
              router.push(`/invoices/${rowMenu.invoiceId}`)
              setRowMenu(null)
            }}
          >
            <Pencil />Edit invoice
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <Send />Send / resend
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <CheckCircle2 />Mark as paid
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <Copy />Duplicate
          </div>
          <div className="menu-item" onClick={() => setRowMenu(null)}>
            <Download />Download PDF
          </div>
          <div className="menu-sep" />
          <div
            className="menu-item"
            style={{ color: 'var(--danger)' }}
            onClick={() => setRowMenu(null)}
          >
            <Trash2 style={{ color: 'var(--danger)' }} />Delete
          </div>
        </div>
      )}
    </>
  )
}
