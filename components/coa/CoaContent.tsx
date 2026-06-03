'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  Plus,
  Upload,
  Printer,
  Search,
  ChevronDown,
  Ellipsis,
  Pencil,
  BookOpen,
  Copy,
  EyeOff,
  Trash2,
} from 'lucide-react'

// ── Data ──────────────────────────────────────────────────────────────────────

const TYPES = [
  {
    key: 'asset', label: 'Assets', single: 'Asset', color: 'var(--blue-500)',
    accounts: [
      { code: '1000', name: 'Bank Accounts', detail: '—', desc: 'Operating cash accounts', parent: true, children: [
        { code: '1010', name: 'Chase Business Checking', detail: 'Bank', desc: 'Primary operating account', bal: 142580.00, active: true },
        { code: '1020', name: 'Stripe Clearing', detail: 'Bank', desc: 'Payment processor clearing', bal: 6961.55, active: true },
      ]},
      { code: '1200', name: 'Accounts Receivable', detail: 'Accounts receivable', desc: 'Money owed by customers', bal: 58430.00, active: true },
      { code: '1400', name: 'Undeposited Funds', detail: 'Other current asset', desc: 'Received, not yet deposited', bal: 2140.55, active: true },
      { code: '1500', name: 'Inventory', detail: 'Inventory asset', desc: 'Goods held for resale', bal: 38900.00, active: true },
      { code: '1700', name: 'Fixed Assets', detail: '—', desc: 'Property & equipment', parent: true, children: [
        { code: '1710', name: 'Equipment', detail: 'Machinery & equipment', desc: 'Owned equipment at cost', bal: 42000.00, active: true },
        { code: '1720', name: 'Accumulated Depreciation', detail: 'Accumulated depreciation', desc: 'Contra-asset account', bal: -12500.00, active: true },
      ]},
    ],
  },
  {
    key: 'liability', label: 'Liabilities', single: 'Liability', color: 'var(--amber-500)',
    accounts: [
      { code: '2000', name: 'Accounts Payable', detail: 'Accounts payable', desc: 'Money owed to vendors', bal: 21840.00, active: true },
      { code: '2100', name: 'Credit Cards', detail: '—', desc: 'Business credit cards', parent: true, children: [
        { code: '2110', name: 'Amex Business', detail: 'Credit card', desc: 'Corporate charge card', bal: 8420.55, active: true },
      ]},
      { code: '2200', name: 'Sales Tax Payable', detail: 'Other current liability', desc: 'Sales tax collected', bal: 6310.20, active: true },
      { code: '2400', name: 'Payroll Liabilities', detail: 'Payroll liability', desc: 'Withholdings owed', bal: 9180.00, active: true },
      { code: '2700', name: 'SBA Term Loan', detail: 'Long-term liability', desc: '7-year term loan', bal: 60000.00, active: true },
    ],
  },
  {
    key: 'equity', label: 'Equity', single: 'Equity', color: '#7c5cff',
    accounts: [
      { code: '3000', name: "Owner's Capital", detail: "Owner's equity", desc: 'Contributed capital', bal: 120000.00, active: true },
      { code: '3100', name: 'Retained Earnings', detail: 'Retained earnings', desc: 'Accumulated profits', bal: 95420.00, active: true },
      { code: '3900', name: "Owner's Draw", detail: "Owner's equity", desc: 'Distributions to owner', bal: -18000.00, active: true },
    ],
  },
  {
    key: 'income', label: 'Income', single: 'Income', color: 'var(--green-500)',
    accounts: [
      { code: '4000', name: 'Product Sales', detail: 'Income', desc: 'Revenue from goods sold', bal: 248900.00, active: true },
      { code: '4100', name: 'Service Revenue', detail: 'Income', desc: 'Revenue from services', bal: 162400.00, active: true },
      { code: '4900', name: 'Other Income', detail: 'Other income', desc: 'Miscellaneous income', bal: 8150.00, active: true },
    ],
  },
  {
    key: 'expense', label: 'Expenses', single: 'Expense', color: 'var(--red-500)',
    accounts: [
      { code: '5000', name: 'Cost of Goods Sold', detail: '—', desc: 'Direct costs of sales', parent: true, children: [
        { code: '5010', name: 'Materials & Supplies', detail: 'Supplies & materials', desc: 'Raw materials', bal: 78200.00, active: true },
        { code: '5020', name: 'Subcontractors', detail: 'Subcontractor', desc: 'Outsourced labor', bal: 41600.00, active: true },
      ]},
      { code: '6000', name: 'Payroll & Wages', detail: 'Payroll expense', desc: 'Salaries and wages', bal: 138400.00, active: true },
      { code: '6100', name: 'Rent & Lease', detail: 'Rent or lease', desc: 'Office lease', bal: 42500.00, active: true },
      { code: '6200', name: 'Software & Subscriptions', detail: 'Dues & subscriptions', desc: 'SaaS tools', bal: 18900.00, active: true },
      { code: '6300', name: 'Advertising & Marketing', detail: 'Advertising', desc: 'Campaigns & ads', bal: 24600.00, active: true },
      { code: '6400', name: 'Travel & Meals', detail: 'Travel', desc: 'Business travel', bal: 9840.00, active: true },
      { code: '6900', name: 'Utilities', detail: 'Utilities', desc: 'Power, internet, phone', bal: 6420.00, active: true },
      { code: '6950', name: 'Bank Charges', detail: 'Bank charges', desc: 'Legacy fees account', bal: 0.00, active: false },
    ],
  },
]

type FlatAccount = {
  code: string
  name: string
  detail: string
  desc: string
  bal: number
  active: boolean
  isParent: boolean
  isSub: boolean
  typeKey: string
  typeLabel: string
  typeSingle: string
  typeColor: string
}

function flattenAll(): FlatAccount[] {
  const out: FlatAccount[] = []
  for (const t of TYPES) {
    for (const a of t.accounts) {
      if ('parent' in a && a.parent) {
        const children = (a as { children: { code: string; name: string; detail: string; desc: string; bal: number; active: boolean }[] }).children
        const total = children.reduce((s, c) => s + c.bal, 0)
        out.push({ code: a.code, name: a.name, detail: a.detail, desc: a.desc, bal: total, active: true, isParent: true, isSub: false, typeKey: t.key, typeLabel: t.label, typeSingle: t.single, typeColor: t.color })
        for (const c of children) {
          out.push({ code: c.code, name: c.name, detail: c.detail, desc: c.desc, bal: c.bal, active: c.active, isParent: false, isSub: true, typeKey: t.key, typeLabel: t.label, typeSingle: t.single, typeColor: t.color })
        }
      } else {
        const leaf = a as { code: string; name: string; detail: string; desc: string; bal: number; active: boolean }
        out.push({ code: leaf.code, name: leaf.name, detail: leaf.detail, desc: leaf.desc, bal: leaf.bal, active: leaf.active, isParent: false, isSub: false, typeKey: t.key, typeLabel: t.label, typeSingle: t.single, typeColor: t.color })
      }
    }
  }
  return out
}

function typeStats(typeKey: string) {
  const rows = flattenAll().filter((r) => r.typeKey === typeKey)
  const leafRows = rows.filter((r) => !r.isParent)
  return {
    count: rows.length,
    total: leafRows.reduce((s, r) => s + r.bal, 0),
  }
}

function money(n: number) {
  return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Component ─────────────────────────────────────────────────────────────────

interface RowMenuState {
  code: string
  x: number
  y: number
}

export function CoaContent({ initialStats }: { initialStats: Record<string, { count: number; total: number }> }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)

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

  const allRows = useMemo(() => flattenAll(), [])
  const totalAccounts = useMemo(() => allRows.filter((r) => !r.isParent).length, [allRows])

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const typeStats2 = useMemo(() => {
    return TYPES.map((t) => ({ key: t.key, label: t.label, ...typeStats(t.key) }))
  }, [])

  // Filtered rows per type
  function getTypeRows(typeKey: string): FlatAccount[] {
    return allRows.filter((r) => {
      if (r.typeKey !== typeKey) return false
      if (typeFilter !== 'all' && typeFilter !== typeKey) return false
      if (activeFilter === 'active' && !r.active) return false
      if (activeFilter === 'inactive' && r.active) return false
      if (search) {
        const q = search.toLowerCase()
        const haystack = (r.code + ' ' + r.name + ' ' + r.detail + ' ' + r.desc).toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }

  const visibleTypes = useMemo(() => {
    return TYPES.filter((t) => {
      if (typeFilter !== 'all' && typeFilter !== t.key) return false
      const rows = getTypeRows(t.key)
      return rows.length > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, activeFilter, search])

  const anyVisible = visibleTypes.length > 0

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <h1 className="greet">Chart of Accounts</h1>
          <div className="sub">
            The complete ledger structure for Northwind Trading ·{' '}
            <span className="t-num">{totalAccounts} accounts</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="head-tools">
          <button className="btn btn-secondary"><Upload />Import</button>
          <button className="btn btn-secondary"><Printer />Export</button>
          <button className="btn btn-primary"><Plus />New account</button>
        </div>
      </div>

      {/* SUMMARY TILES */}
      <div className="coa-tiles">
        {TYPES.map((t) => {
          const { count, total } = typeStats(t.key)
          return (
            <div key={t.key} className={`coa-tile tile-${t.key}`}>
              <div className="ct-top">
                <span className="ct-dot" />
                <span className="ct-name">{t.label}</span>
                <span className="ct-count">{count}</span>
              </div>
              <div className={`ct-balance${total < 0 ? ' neg' : ''}`}>{money(total)}</div>
            </div>
          )
        })}
      </div>

      {/* SEARCH / FILTER */}
      <div className="coa-filter">
        <div className="input-group">
          <span className="lead-icon"><Search /></span>
          <input
            className="input"
            type="text"
            placeholder="Search by name, number, or detail type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grow" />
        <select
          className="select"
          style={{ width: 'auto', minWidth: 150 }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="asset">Assets</option>
          <option value="liability">Liabilities</option>
          <option value="equity">Equity</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
        <select
          className="select"
          style={{ width: 'auto', minWidth: 140 }}
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
        >
          <option value="all">Active &amp; inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {/* TABLE */}
      <div className="coa-wrap">
        <table className="coa">
          <colgroup>
            <col className="c-code" />
            <col />
            <col className="c-type" />
            <col className="c-detail" />
            <col />
            <col className="c-bal" />
            <col className="c-act" />
          </colgroup>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account name</th>
              <th>Type</th>
              <th>Detail type</th>
              <th>Description</th>
              <th className="num">Balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {anyVisible ? (
              TYPES.map((t) => {
                if (typeFilter !== 'all' && typeFilter !== t.key) return null
                const typeRows = getTypeRows(t.key)
                if (typeRows.length === 0) return null
                const isCollapsed = collapsed.has(t.key) && !search
                const { total } = typeStats(t.key)
                return (
                  <React.Fragment key={t.key}>
                    {/* Section header */}
                    <tr
                      className={`coa-sec${isCollapsed ? ' collapsed' : ''}`}
                      data-sec={t.key}
                    >
                      <td colSpan={7}>
                        <div
                          className="coa-sec-inner"
                          onClick={() => toggleCollapse(t.key)}
                        >
                          <span className="chev"><ChevronDown /></span>
                          <span className="sec-dot" style={{ background: t.color }} />
                          <span className="sec-name">{t.label}</span>
                          <span className="sec-count">{typeRows.length} accounts</span>
                          <span className="sec-total">{money(total)}</span>
                        </div>
                      </td>
                    </tr>
                    {/* Account rows */}
                    {!isCollapsed && typeRows.map((a) => (
                      <tr
                        key={`row-${a.code}`}
                        className={`coa-row${a.isSub ? ' acct-row-sub' : ''}${!a.active ? ' inactive' : ''}`}
                      >
                        <td className="acct-code">{a.code}</td>
                        <td>
                          <div className="acct-name">
                            <span className={`st-dot${a.active ? '' : ' off'}`} />
                            <span className={`nm${a.isParent ? ' parent' : ''}`}>{a.name}</span>
                            {!a.active && <span className="badge-inactive">Inactive</span>}
                          </div>
                        </td>
                        <td><span className="type-pill">{a.typeSingle}</span></td>
                        <td><span className="detail-txt">{a.detail}</span></td>
                        <td><span className="desc-txt">{a.desc}</span></td>
                        <td className={`acct-bal${a.bal < 0 ? ' neg' : ''}${a.bal === 0 ? ' muted' : ''}`}>
                          {money(a.bal)}
                        </td>
                        <td className="col-act">
                          <button
                            className="row-action"
                            aria-label="Account actions"
                            onClick={(e) => {
                              e.stopPropagation()
                              const r = e.currentTarget.getBoundingClientRect()
                              setRowMenu(
                                rowMenu?.code === a.code
                                  ? null
                                  : {
                                      code: a.code,
                                      x: Math.min(r.left - 150, window.innerWidth - 210),
                                      y: r.bottom + 6,
                                    }
                              )
                            }}
                          >
                            <Ellipsis />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* Subtotal row — only show when not collapsed and no search/filter */}
                    {!isCollapsed && !search && activeFilter === 'all' && (
                      <tr key={`sub-${t.key}`} className="coa-subtotal">
                        <td />
                        <td className="lbl">Total {t.label.toLowerCase()}</td>
                        <td /><td /><td />
                        <td className="acct-bal">{money(total)}</td>
                        <td />
                      </tr>
                    )}
                  </React.Fragment>
                )
              })
            ) : null}
          </tbody>
        </table>
        {!anyVisible && (
          <div className="coa-empty" style={{ display: 'block' }}>
            <div className="ce-title">No accounts match your filters</div>
            <div className="t-caption">Try clearing the search or changing the type filter.</div>
          </div>
        )}
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
          <div className="menu-item" onClick={() => setRowMenu(null)}><Pencil />Edit account</div>
          <div className="menu-item" onClick={() => setRowMenu(null)}><BookOpen />View register</div>
          <div className="menu-item" onClick={() => setRowMenu(null)}><Copy />Duplicate</div>
          <div className="menu-sep" />
          <div className="menu-item" onClick={() => setRowMenu(null)}><EyeOff />Make inactive</div>
          <div className="menu-item" style={{ color: 'var(--danger)' }} onClick={() => setRowMenu(null)}>
            <Trash2 style={{ color: 'var(--danger)' }} />Delete
          </div>
        </div>
      )}
    </>
  )
}
