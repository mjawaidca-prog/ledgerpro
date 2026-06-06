'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import {
  Plus,
  Upload,
  Users,
  UserRound,
  Truck,
  Wallet,
  Search,
  ArrowUpDown,
  SlidersHorizontal,
  Check,
  Mail,
  Tag,
  Trash2,
  ChevronsUpDown,
  Pencil,
  FileText,
  Banknote,
  FileBarChart,
  Ellipsis,
  ArrowUpRight,
} from 'lucide-react'
import type { ContactRow, ContactStats } from '@/app/contacts/page'

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type SortKey = 'name' | 'bal'
type SortDir = 'asc' | 'desc'

interface RowMenuState {
  id: string
  x: number
  y: number
}

export function ContactsContent({
  contacts,
  stats,
}: {
  contacts: ContactRow[]
  stats: ContactStats
}) {
  const [activeTab, setActiveTab] = useState<'All' | 'Customer' | 'Supplier'>('All')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null)
  const [formData, setFormData] = useState({ name: '', company: '', type: 'customer' as 'customer' | 'supplier', email: '', phone: '', status: 'active' as 'active' | 'inactive' })
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const deleteContact = trpc.contacts.delete.useMutation()
  const createContact = trpc.contacts.create.useMutation()
  const updateContact = trpc.contacts.update.useMutation()

  const openCreateForm = useCallback(() => {
    setEditingContact(null)
    setFormData({ name: '', company: '', type: 'customer', email: '', phone: '', status: 'active' })
    setShowForm(true)
  }, [])

  const openEditForm = useCallback((contact: ContactRow) => {
    setEditingContact(contact)
    setFormData({
      name: contact.name,
      company: contact.company,
      type: contact.type === 'Customer' ? 'customer' : 'supplier',
      email: contact.email,
      phone: contact.phone,
      status: contact.status === 'Active' ? 'active' : 'inactive',
    })
    setRowMenu(null)
    setShowForm(true)
  }, [])

  const handleFormSave = useCallback(async () => {
    try {
      if (editingContact) {
        await updateContact.mutateAsync({
          id: editingContact.id,
          name: formData.name,
          company: formData.company,
          type: formData.type,
          email: formData.email,
          phone: formData.phone,
          status: formData.status,
        })
      } else {
        await createContact.mutateAsync({
          name: formData.name,
          company: formData.company || undefined,
          type: formData.type,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
        })
      }
      setShowForm(false)
      router.refresh()
    } catch {
      alert('Could not save contact. Please try again.')
    }
  }, [editingContact, formData, createContact, updateContact, router])

  const handleDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const label = ids.length === 1 ? 'this contact' : `${ids.length} contacts`
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
      try {
        const results = await Promise.all(ids.map((id) => deleteContact.mutateAsync({ id })))
        const blocked = results.filter((r) => !r.success && r.reason === 'in_use').length
        setSelected(new Set())
        setRowMenu(null)
        router.refresh()
        if (blocked > 0) {
          alert(
            `${blocked} contact${blocked === 1 ? '' : 's'} could not be deleted because ${blocked === 1 ? 'it has' : 'they have'} invoices or bills. Mark inactive instead.`,
          )
        }
      } catch {
        alert('Could not delete. Please try again.')
      }
    },
    [deleteContact, router],
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setRowMenu(null)
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const counts = useMemo(() => ({
    All: contacts.length,
    Customer: contacts.filter((c) => c.type === 'Customer').length,
    Supplier: contacts.filter((c) => c.type === 'Supplier').length,
  }), [contacts])

  const filtered = useMemo(() => {
    let rows = contacts
    if (activeTab !== 'All') rows = rows.filter((r) => r.type === activeTab)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.company.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q),
      )
    }
    rows = [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'bal') cmp = a.outstandingBalance - b.outstandingBalance
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [contacts, activeTab, search, sortKey, sortDir])

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))

  function toggleSelectAll() {
    if (allVisibleSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map((r) => r.id)))
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tabs = ['All', 'Customer', 'Supplier'] as const

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <h1 className="greet">Contacts</h1>
          <div className="sub">
            Customers and suppliers across Northwind Trading ·{' '}
            <span className="t-num">{contacts.length} contacts</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="head-tools">
          <button className="btn btn-secondary"><Upload />Import</button>
          <button className="btn btn-primary" onClick={openCreateForm}><Plus />New contact</button>
        </div>
      </div>

      {/* SUMMARY STAT CARDS */}
      <div className="kpi-row">
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico blue"><Users /></span>
            <span className="stat-label">Total contacts</span>
          </div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-delta">
            <span className="muted">{stats.customers} customers · {stats.suppliers} suppliers</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico green"><UserRound /></span>
            <span className="stat-label">Customers</span>
          </div>
          <div className="stat-value">{stats.customers}</div>
          <div className="stat-delta up">
            <ArrowUpRight />{fmtMoney(stats.customerBalance)}{' '}
            <span className="muted">owed to you</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico gray"><Truck /></span>
            <span className="stat-label">Suppliers</span>
          </div>
          <div className="stat-value">{stats.suppliers}</div>
          <div className="stat-delta">
            <span className="muted">{fmtMoney(stats.supplierBalance)} payable</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span className="stat-ico blue"><Wallet /></span>
            <span className="stat-label">Outstanding balance</span>
          </div>
          <div className="stat-value pos">{fmtMoney(stats.outstandingBalance)}</div>
          <div className="stat-delta">
            <span className="muted">net receivable</span>
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
              {tab === 'All' ? 'All' : tab === 'Customer' ? 'Customers' : 'Suppliers'}{' '}
              <span className="cnt">{counts[tab]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* SEARCH + FILTER ROW */}
      <div className="search-row">
        <div className="input-group">
          <span className="lead-icon"><Search /></span>
          <input
            className="input"
            type="text"
            placeholder="Search by name, company, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grow" />
        <div className="dd" ref={sortMenuRef}>
          <button
            className="btn btn-secondary"
            onClick={() => setSortMenuOpen((o) => !o)}
          >
            <ArrowUpDown />Sort
          </button>
          {sortMenuOpen && (
            <div className="menu right open" style={{ minWidth: 200 }}>
              <div className="menu-label">Sort by</div>
              <div
                className={`menu-item${sortKey === 'name' && sortDir === 'asc' ? ' active' : ''}`}
                onClick={() => { setSortKey('name'); setSortDir('asc'); setSortMenuOpen(false) }}
              >
                {sortKey === 'name' && sortDir === 'asc' ? <Check /> : <ArrowUpDown />}
                Name (A–Z)
              </div>
              <div
                className={`menu-item${sortKey === 'bal' && sortDir === 'desc' ? ' active' : ''}`}
                onClick={() => { setSortKey('bal'); setSortDir('desc'); setSortMenuOpen(false) }}
              >
                {sortKey === 'bal' && sortDir === 'desc' ? <Check /> : <ArrowUpDown />}
                Balance (high–low)
              </div>
            </div>
          )}
        </div>
        <button className="btn btn-secondary"><SlidersHorizontal />Filters</button>
      </div>

      {/* TABLE */}
      <div className="table-wrap">
        {/* Bulk bar */}
        <div className={`bulkbar${selected.size > 0 ? ' show' : ''}`}>
          <span className="bcount"><span>{selected.size}</span> selected</span>
          <div className="spacer" />
          <button className="btn btn-secondary btn-sm"><Mail />Email</button>
          <button className="btn btn-secondary btn-sm"><Tag />Add tag</button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)' }}
            onClick={() => handleDelete([...selected])}
          >
            <Trash2 />Delete
          </button>
        </div>

        <table className="data" id="ct-table">
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
                onClick={() => { setSortKey('name'); setSortDir((d) => sortKey === 'name' ? (d === 'asc' ? 'desc' : 'asc') : 'asc') }}
              >
                <span className="th-inner">Name <ChevronsUpDown className="sort-ico" /></span>
              </th>
              <th>Type</th>
              <th>Email</th>
              <th>Phone</th>
              <th
                className="sortable num"
                onClick={() => { setSortKey('bal'); setSortDir((d) => sortKey === 'bal' ? (d === 'asc' ? 'desc' : 'asc') : 'desc') }}
              >
                <span className="th-inner">Outstanding balance <ChevronsUpDown className="sort-ico" /></span>
              </th>
              <th>Status</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const isSelected = selected.has(row.id)
              const isZero = row.outstandingBalance === 0
              const tag = row.type === 'Customer' ? 'owed to you' : 'you owe'
              return (
                <tr key={row.id} data-type={row.type} data-status={row.status}>
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
                    <span className="c-name-wrap">
                      <span className="av" style={{ background: row.color }}>{row.initials}</span>
                      <span className="c-name">
                        <span className="nm">{row.name}</span>
                        <span className="co">{row.company}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${row.type === 'Customer' ? 'badge-customer' : 'badge-supplier'}`}>
                      <span className="dot" />{row.type}
                    </span>
                  </td>
                  <td>
                    <a className="c-email" href={`mailto:${row.email}`}>{row.email}</a>
                  </td>
                  <td><span className="c-phone">{row.phone}</span></td>
                  <td className={`c-bal${isZero ? ' zero' : ''}`} data-bal={row.outstandingBalance}>
                    {fmtMoney(row.outstandingBalance)}
                    {!isZero && <span className="bal-tag">{tag}</span>}
                  </td>
                  <td>
                    <span className={`badge ${row.status === 'Active' ? 'badge-active' : 'badge-inactive'}`}>
                      <span className="dot" />{row.status}
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
                          rowMenu?.id === row.id
                            ? null
                            : {
                                id: row.id,
                                x: Math.min(r.left - 150, window.innerWidth - 220),
                                y: r.bottom + 6,
                              }
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
                <td colSpan={8}>No contacts match this filter.</td>
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
          <div className="menu-item" onClick={() => { const c = contacts.find((c) => c.id === rowMenu.id); if (c) openEditForm(c) }}><Pencil />Edit contact</div>
          <div className="menu-item" onClick={() => setRowMenu(null)}><FileText />New invoice</div>
          <div className="menu-item" onClick={() => setRowMenu(null)}><Banknote />Record payment</div>
          <div className="menu-item" onClick={() => setRowMenu(null)}><FileBarChart />View statement</div>
          <div className="menu-sep" />
          <div
            className="menu-item"
            style={{ color: 'var(--danger)' }}
            onClick={() => handleDelete([rowMenu.id])}
          >
            <Trash2 style={{ color: 'var(--danger)' }} />Delete
          </div>
        </div>
      )}

      {/* CONTACT FORM MODAL */}
      {showForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '6vh 20px 40px',
            background: 'rgba(11, 15, 23, 0.55)',
            backdropFilter: 'blur(3px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>
              {editingContact ? 'Edit contact' : 'New contact'}
            </h2>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Name *</span>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Company</span>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData((f) => ({ ...f, company: e.target.value }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Type</span>
              <select
                value={formData.type}
                onChange={(e) => setFormData((f) => ({ ...f, type: e.target.value as 'customer' | 'supplier' }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              >
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Email</span>
              <input
                type="text"
                value={formData.email}
                onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Phone</span>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: 14,
                }}
              />
            </label>

            {editingContact && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status</span>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' }))}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text)',
                    fontSize: 14,
                  }}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!formData.name.trim() || createContact.isPending || updateContact.isPending}
                onClick={handleFormSave}
              >
                {(createContact.isPending || updateContact.isPending) ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
