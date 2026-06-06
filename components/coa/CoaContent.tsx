'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
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

// ── Presentation metadata (data comes from the DB via props) ───────────────────

import type { CoaAccount } from '@/lib/trpc/routers/coa'

const TYPE_META = [
  { key: 'asset', label: 'Assets', single: 'Asset', color: 'var(--blue-500)' },
  { key: 'liability', label: 'Liabilities', single: 'Liability', color: 'var(--amber-500)' },
  { key: 'equity', label: 'Equity', single: 'Equity', color: '#7c5cff' },
  { key: 'income', label: 'Income', single: 'Income', color: 'var(--green-500)' },
  { key: 'expense', label: 'Expenses', single: 'Expense', color: 'var(--red-500)' },
]

const META_BY_KEY: Record<string, (typeof TYPE_META)[number]> = Object.fromEntries(
  TYPE_META.map((t) => [t.key, t]),
)

type FlatAccount = CoaAccount & {
  typeLabel: string
  typeSingle: string
  typeColor: string
}

function decorate(accounts: CoaAccount[]): FlatAccount[] {
  return accounts.map((a) => {
    const meta = META_BY_KEY[a.typeKey] ?? { label: a.typeKey, single: a.typeKey, color: 'var(--text-muted)' }
    return { ...a, typeLabel: meta.label, typeSingle: meta.single, typeColor: meta.color }
  })
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

export function CoaContent({
  initialStats,
  accounts,
}: {
  initialStats: Record<string, { count: number; total: number }>
  accounts: CoaAccount[]
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const [showForm, setShowForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<FlatAccount | null>(null)

  const setActiveMut = trpc.coa.setActive.useMutation()
  const deleteMut = trpc.coa.delete.useMutation()
  const createMut = trpc.coa.create.useMutation()
  const updateMut = trpc.coa.update.useMutation()

  async function handleToggleActive(currentActive: boolean) {
    if (!rowMenu) return
    const code = rowMenu.code
    setRowMenu(null)
    await setActiveMut.mutateAsync({ code, active: !currentActive })
    router.refresh()
  }

  async function handleDelete() {
    if (!rowMenu) return
    const code = rowMenu.code
    setRowMenu(null)
    const res = await deleteMut.mutateAsync({ code })
    if (!res.success) {
      alert(
        res.reason === 'in_use'
          ? 'This account has posted activity and cannot be deleted. Make it inactive instead.'
          : 'Could not delete this account.',
      )
      return
    }
    router.refresh()
  }

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

  const allRows = useMemo(() => decorate(accounts), [accounts])
  const totalAccounts = useMemo(() => allRows.filter((r) => !r.isParent).length, [allRows])

  // Per-type stats derived from the DB-backed rows (falls back to server stats)
  function typeStats(typeKey: string) {
    const fromStats = initialStats[typeKey]
    if (fromStats) return fromStats
    const rows = allRows.filter((r) => r.typeKey === typeKey)
    return {
      count: rows.length,
      total: rows.filter((r) => !r.isParent).reduce((s, r) => s + r.bal, 0),
    }
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
    return TYPE_META.filter((t) => {
      if (typeFilter !== 'all' && typeFilter !== t.key) return false
      const rows = getTypeRows(t.key)
      return rows.length > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, activeFilter, search, allRows])

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
          <button className="btn btn-primary" onClick={() => { setEditingAccount(null); setShowForm(true) }}><Plus />New account</button>
        </div>
      </div>

      {/* SUMMARY TILES */}
      <div className="coa-tiles">
        {TYPE_META.map((t) => {
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
              TYPE_META.map((t) => {
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

      {/* ACCOUNT FORM MODAL */}
      {showForm && <AccountFormModal
        account={editingAccount}
        onClose={() => setShowForm(false)}
        onSave={async (data) => {
          if (editingAccount) {
            await updateMut.mutateAsync({
              code: editingAccount.code,
              name: data.name,
              detailType: data.detailType,
              description: data.description,
              active: data.active,
            })
          } else {
            await createMut.mutateAsync({
              code: data.code,
              name: data.name,
              type: data.type as 'asset' | 'liability' | 'equity' | 'income' | 'expense',
              detailType: data.detailType,
              description: data.description || undefined,
              balance: data.balance,
            })
          }
          setShowForm(false)
          router.refresh()
        }}
      />}

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
          {(() => {
            const row = allRows.find((r) => r.code === rowMenu.code)
            const isActive = row?.active ?? true
            return (
              <>
                <div className="menu-item" onClick={() => { const acct = allRows.find((r) => r.code === rowMenu!.code); if (acct) { setEditingAccount(acct); setShowForm(true) } setRowMenu(null) }}><Pencil />Edit account</div>
                <div className="menu-item" onClick={() => setRowMenu(null)}><BookOpen />View register</div>
                <div className="menu-item" onClick={() => setRowMenu(null)}><Copy />Duplicate</div>
                <div className="menu-sep" />
                <div className="menu-item" onClick={() => handleToggleActive(isActive)}>
                  <EyeOff />{isActive ? 'Make inactive' : 'Make active'}
                </div>
                <div className="menu-item" style={{ color: 'var(--danger)' }} onClick={handleDelete}>
                  <Trash2 style={{ color: 'var(--danger)' }} />Delete
                </div>
              </>
            )
          })()}
        </div>
      )}
    </>
  )
}

// ── Account Form Modal ───────────────────────────────────────────────────────

interface AccountFormData {
  code: string
  name: string
  type: string
  detailType: string
  description: string
  balance: number
  active: boolean
}

function AccountFormModal({
  account,
  onClose,
  onSave,
}: {
  account: FlatAccount | null
  onClose: () => void
  onSave: (data: AccountFormData) => Promise<void>
}) {
  const isEdit = account !== null
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<AccountFormData>({
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: account?.typeKey ?? 'asset',
    detailType: account?.detail ?? '',
    description: account?.desc ?? '',
    balance: account?.bal ?? 0,
    active: account?.active ?? true,
  })

  function set<K extends keyof AccountFormData>(key: K, value: AccountFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(form)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 120,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '6vh 20px 40px',
    background: 'rgba(11, 15, 23, 0.55)',
    backdropFilter: 'blur(3px)',
  }

  const modalStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    width: '100%',
    maxWidth: 520,
    boxShadow: '0 20px 60px rgba(0,0,0,.4)',
  }

  const headStyle: React.CSSProperties = {
    padding: '20px 24px 0',
    fontSize: '1.1rem',
    fontWeight: 600,
    color: 'var(--text)',
  }

  const bodyStyle: React.CSSProperties = {
    padding: '16px 24px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  }

  const fgStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
  }

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 8,
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headStyle}>{isEdit ? 'Edit account' : 'New account'}</div>
        <form onSubmit={handleSubmit} style={bodyStyle}>
          {/* Code */}
          <div style={fgStyle}>
            <label style={labelStyle}>Code</label>
            <input
              className="input"
              type="text"
              required
              readOnly={isEdit}
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              style={isEdit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
            />
          </div>

          {/* Name */}
          <div style={fgStyle}>
            <label style={labelStyle}>Name</label>
            <input
              className="input"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Type */}
          <div style={fgStyle}>
            <label style={labelStyle}>Type</label>
            <select
              className="select"
              value={form.type}
              disabled={isEdit}
              onChange={(e) => set('type', e.target.value)}
              style={isEdit ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
            >
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          {/* Detail type */}
          <div style={fgStyle}>
            <label style={labelStyle}>Detail type</label>
            <input
              className="input"
              type="text"
              required
              value={form.detailType}
              onChange={(e) => set('detailType', e.target.value)}
            />
          </div>

          {/* Description */}
          <div style={fgStyle}>
            <label style={labelStyle}>Description</label>
            <textarea
              className="textarea"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          {/* Balance — only for new accounts */}
          {!isEdit && (
            <div style={fgStyle}>
              <label style={labelStyle}>Opening balance</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.balance}
                onChange={(e) => set('balance', parseFloat(e.target.value) || 0)}
              />
            </div>
          )}

          {/* Footer */}
          <div style={footerStyle}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
