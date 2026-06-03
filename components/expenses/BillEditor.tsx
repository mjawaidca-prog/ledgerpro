'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ChevronRight,
  ChevronsUpDown,
  Tag,
  Package,
  PackageOpen,
  Plus,
  X,
  Paperclip,
  FileText,
  Save,
  Check,
  FileEdit,
  Banknote,
} from 'lucide-react'
import type { BillData, BillLine } from '@/app/expenses/bills/[id]/page'

const CATS: Record<string, string> = {
  'Software & subscriptions': '#1f6feb',
  'Rent & lease':             '#d6961f',
  'Utilities':                '#5b8bf8',
  'Office supplies':          '#7c5cff',
  'Advertising & marketing':  '#f0883e',
  'Travel & meals':           '#0ea5b5',
  'Insurance':                '#16a063',
  'Professional fees':        '#4b5666',
  'Repairs & maintenance':    '#697587',
}

const TAX_RATES: Record<string, number> = { none: 0, '8.5': 0.085, '10': 0.10 }

const VENDORS = [
  { name: 'AWS',               initials: 'AW', color: '#ec912d', email: 'accounts@amazon-aws.com',    terms: 'Net 30' },
  { name: 'WeWork',            initials: 'WE', color: '#1f6feb', email: 'billing@wework.com',          terms: 'Net 15' },
  { name: 'Adobe',             initials: 'A',  color: '#e0484e', email: 'billing@adobe.com',           terms: 'Net 30' },
  { name: 'City Power & Light',initials: 'CP', color: '#0ea5b5', email: 'billing@citypowerlight.com',  terms: 'Due on receipt' },
]

function money(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function addDays(iso: string, days: number) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const TERMS_DAYS: Record<string, number> = { receipt: 0, net15: 15, net30: 30, net60: 60 }

export function BillEditor({ bill, isNew }: { bill: BillData; isNew: boolean }) {
  const router = useRouter()

  const [vendorName, setVendorName]     = useState(bill.vendorName)
  const [vendorMenuOpen, setVendorMenuOpen] = useState(false)
  const [billNumber, setBillNumber]     = useState(bill.billNumber)
  const [paymentTerms, setPaymentTerms] = useState(bill.paymentTerms)
  const [billDate, setBillDate]         = useState(bill.billDate)
  const [dueDate, setDueDate]           = useState(bill.dueDate)
  const [memo, setMemo]                 = useState(bill.memo)
  const [taxRate, setTaxRate]           = useState(String(bill.taxRate === 8.5 ? '8.5' : bill.taxRate === 10 ? '10' : 'none'))
  const [lines, setLines]               = useState<BillLine[]>(bill.lines)
  const [activeTab, setActiveTab]       = useState<'categories' | 'items'>('categories')
  const [receiptAttached, setReceiptAttached] = useState(false)

  const selectedVendor = VENDORS.find((v) => v.name === vendorName) ?? VENDORS[0]

  function handleTermsChange(terms: string) {
    setPaymentTerms(terms)
    const days = TERMS_DAYS[terms]
    if (days != null && billDate) {
      setDueDate(addDays(billDate, days))
    }
  }

  function handleBillDateChange(date: string) {
    setBillDate(date)
    const days = TERMS_DAYS[paymentTerms]
    if (days != null && date) {
      setDueDate(addDays(date, days))
    }
  }

  function updateLine(idx: number, field: keyof BillLine, value: string | number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function addLine() {
    setLines((prev) => [...prev, { category: 'Software & subscriptions', description: '', amount: 0 }])
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const tax      = subtotal * (TAX_RATES[taxRate] ?? 0)
  const total    = subtotal + tax

  const handleCancel = useCallback(() => {
    router.push('/expenses')
  }, [router])

  return (
    <>
      {/* BREADCRUMB */}
      <div className="breadcrumb">
        <Link href="/expenses" className="breadcrumb-back">
          <ArrowLeft />Expenses
        </Link>
        <ChevronRight />
        <span className="cur">Enter bill</span>
      </div>

      {/* PAGE HEADER */}
      <div className="page-head">
        <h1 className="greet">
          Enter bill{' '}
          <span className="badge badge-draft"><span className="dot" />Draft</span>
        </h1>
        <div className="spacer" />
      </div>

      {/* EDITOR GRID */}
      <div className="editor-grid">

        {/* LEFT COLUMN */}
        <div className="editor-main">

          {/* Vendor & Bill Details */}
          <div className="card card-pad">
            <div className="section-title">Vendor</div>
            <div className="field-grid">
              <div className="field span-2">
                <label>Vendor / payee</label>
                <div className="dd" style={{ position: 'relative' }}>
                  <button
                    className="cust-select"
                    onClick={() => setVendorMenuOpen(!vendorMenuOpen)}
                    type="button"
                  >
                    <span className="av" style={{ background: selectedVendor.color }}>
                      {selectedVendor.initials}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="cs-name">{selectedVendor.name}</span>
                      <div className="cs-sub">{selectedVendor.email} · {selectedVendor.terms}</div>
                    </span>
                    <span className="chev"><ChevronsUpDown /></span>
                  </button>
                  {vendorMenuOpen && (
                    <div
                      className="menu left open"
                      style={{ minWidth: '300px', position: 'absolute', top: '100%', left: 0, zIndex: 50 }}
                    >
                      <div className="menu-label">Select vendor</div>
                      {VENDORS.map((v) => (
                        <div
                          key={v.name}
                          className="menu-org"
                          onClick={() => {
                            setVendorName(v.name)
                            setVendorMenuOpen(false)
                          }}
                        >
                          <span className="mo-tile" style={{ background: v.color }}>{v.initials}</span>
                          <span className="mo-name">{v.name}</span>
                          {v.name === vendorName && (
                            <span className="mo-check"><Check /></span>
                          )}
                        </div>
                      ))}
                      <div className="menu-sep" />
                      <div className="menu-item"><Plus />New vendor</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="section-title" style={{ marginTop: '22px' }}>Bill details</div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="f-num">Bill / reference no.</label>
                <div className="input-group">
                  <span className="lead-sym" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}>#</span>
                  <input
                    className="input has-sym"
                    id="f-num"
                    type="text"
                    value={billNumber}
                    onChange={(e) => setBillNumber(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-terms">Payment terms</label>
                <select
                  className="select"
                  id="f-terms"
                  value={paymentTerms}
                  onChange={(e) => handleTermsChange(e.target.value)}
                >
                  <option value="receipt">Due on receipt</option>
                  <option value="net15">Net 15</option>
                  <option value="net30">Net 30</option>
                  <option value="net60">Net 60</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-issue">Bill date</label>
                <input
                  className="input"
                  id="f-issue"
                  type="date"
                  value={billDate}
                  onChange={(e) => handleBillDateChange(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="f-due">Due date</label>
                <input
                  className="input"
                  id="f-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="card card-pad">
            <div className="bl-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={activeTab === 'categories' ? 'true' : 'false'}
                aria-controls="bl-cat-panel"
                onClick={() => setActiveTab('categories')}
                type="button"
              >
                <Tag />Category details
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'items' ? 'true' : 'false'}
                aria-controls="bl-item-panel"
                onClick={() => setActiveTab('items')}
                type="button"
              >
                <Package />Item details
              </button>
            </div>

            <div className="bl-panel" id="bl-cat-panel" hidden={activeTab !== 'categories'}>
              <table className="bl-table">
                <thead>
                  <tr>
                    <th className="bl-col-cat">Category</th>
                    <th className="bl-col-desc">Description</th>
                    <th className="bl-col-amt num">Amount</th>
                    <th className="bl-col-del" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const dotColor = CATS[line.category] ?? '#9aa6b8'
                    return (
                      <tr key={idx} className="bl-row">
                        <td className="bl-col-cat">
                          <span className="bl-cat-wrap">
                            <span
                              className="bl-dot"
                              style={{ background: dotColor }}
                            />
                            <select
                              className="li-input li-select bl-cat"
                              value={line.category}
                              onChange={(e) => updateLine(idx, 'category', e.target.value)}
                            >
                              {Object.keys(CATS).map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td className="bl-col-desc">
                          <input
                            className="li-input bl-desc"
                            placeholder="Description"
                            value={line.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          />
                        </td>
                        <td className="bl-col-amt">
                          <input
                            className="li-input li-num bl-amt-in"
                            type="text"
                            inputMode="decimal"
                            value={line.amount === 0 ? '' : String(line.amount)}
                            placeholder="0.00"
                            onChange={(e) => updateLine(idx, 'amount', parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="bl-col-del">
                          <button
                            className="li-del"
                            aria-label="Remove line"
                            type="button"
                            onClick={() => removeLine(idx)}
                          >
                            <X />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <button
                className="btn btn-secondary btn-sm add-line"
                type="button"
                onClick={addLine}
              >
                <Plus />Add line
              </button>
            </div>

            <div className="bl-panel" id="bl-item-panel" hidden={activeTab !== 'items'}>
              <div className="bl-items-empty">
                <div className="bie-ico"><PackageOpen /></div>
                <div className="bie-title">No product or service items yet</div>
                <div className="t-caption" style={{ marginTop: '4px' }}>
                  Add items to track inventory and quantities on this bill.
                </div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: '14px' }} type="button">
                  <Plus />Add item
                </button>
              </div>
            </div>
          </div>

          {/* Attachment + Memo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
            <div className="card card-pad">
              <div className="section-title">Attachment</div>
              {!receiptAttached ? (
                <div
                  className="receipt-drop"
                  onClick={() => setReceiptAttached(true)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setReceiptAttached(true)}
                >
                  <span className="rd-ico"><Paperclip /></span>
                  <div className="rd-title">Drop receipt here or <span className="link">browse</span></div>
                  <div className="rd-sub">PDF, PNG, or JPG · up to 10 MB</div>
                </div>
              ) : (
                <div className="receipt-thumb">
                  <span className="rt-ico"><FileText /></span>
                  <div>
                    <div className="rt-name">aws-invoice-may.pdf</div>
                    <div className="rt-meta">218 KB · attached</div>
                  </div>
                  <button
                    className="rt-del"
                    aria-label="Remove"
                    type="button"
                    onClick={() => setReceiptAttached(false)}
                  >
                    <X />
                  </button>
                </div>
              )}
            </div>
            <div className="card card-pad">
              <div className="section-title">Memo</div>
              <div className="field">
                <textarea
                  className="textarea"
                  id="f-memo"
                  placeholder="Add an internal note for this bill…"
                  style={{ minHeight: '104px' }}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: TOTALS */}
        <aside className="totals-panel">
          <div className="card totals-card">
            <div className="section-title">Bill total</div>
            <div className="tot-row">
              <span className="lbl">Subtotal</span>
              <span className="val">{money(subtotal)}</span>
            </div>
            <div className="tot-row">
              <span className="lbl">
                Tax{' '}
                <select
                  className="select"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  style={{ height: '30px', width: 'auto', padding: '0 26px 0 9px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}
                >
                  <option value="none">No tax</option>
                  <option value="8.5">8.5%</option>
                  <option value="10">10%</option>
                </select>
              </span>
              <span className="val">{money(tax)}</span>
            </div>
            <div className="tot-total">
              <span className="lbl">Total</span>
              <span className="val">{money(total)}</span>
            </div>
            <div className="tot-meta">
              <span>Currency</span>
              <span className="tot-due">USD · $</span>
            </div>
            <div className="tot-meta" style={{ marginTop: 0, borderTop: 0, paddingTop: '6px' }}>
              <span>Due date</span>
              <span className="tot-due">{fmtDate(dueDate) || '—'}</span>
            </div>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
            <div className="section-title" style={{ margin: 0 }}>Payment</div>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                Pay from account
              </label>
              <select className="select">
                <option>Chase Business Checking ••4021</option>
                <option>Amex Business ••6700</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" />
              <span className="box"><Check /></span>
              Pay this bill now
            </label>
            <label className="check">
              <input type="checkbox" defaultChecked />
              <span className="box"><Check /></span>
              Set a payment reminder
            </label>
          </div>
        </aside>
      </div>

      {/* FOOTER */}
      <footer className="editor-footer">
        <span className="ef-note">
          <Save />Draft auto-saved · total{' '}
          <span className="t-num" style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
            {money(total)}
          </span>
        </span>
        <div className="spacer" />
        <button className="btn btn-ghost" type="button" onClick={handleCancel}>
          Cancel
        </button>
        <button className="btn btn-secondary" type="button">
          <FileEdit />Save as draft
        </button>
        <button className="btn btn-secondary" type="button">
          <Banknote />Save &amp; pay
        </button>
        <button className="btn btn-primary" type="button">
          <Check />Save bill
        </button>
      </footer>
    </>
  )
}
