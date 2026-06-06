'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import {
  ArrowLeft,
  ChevronRight,
  Plus,
  X,
  Save,
  Send,
  FileEdit,
  Eye,
  ChevronsUpDown,
  Check,
} from 'lucide-react'

const TAX_RATES: Record<string, number> = {
  none: 0,
  '8.5': 0.085,
  '10': 0.10,
  '20': 0.20,
}

const CUSTOMERS = [
  { id: 'bs', name: 'Brightline Studio', email: 'billing@brightline.studio', color: '#b97c12', initials: 'BS' },
  { id: 'al', name: 'Atlas Logistics',   email: 'accounts@atlaslogistics.com', color: '#0f8a53', initials: 'AL' },
  { id: 'sh', name: 'Summit Health',     email: 'billing@summithealth.org',   color: '#3074ef', initials: 'SH' },
  { id: 'vp', name: 'Vertex Partners',   email: 'finance@vertexpartners.co',  color: '#4b5666', initials: 'VP' },
  { id: 'cc', name: 'Cedar & Co.',       email: 'billing@cedarandco.com',     color: '#cf353c', initials: 'CC' },
  { id: 'md', name: 'Meridian Design',   email: 'hello@meridiandesign.io',    color: '#1857c4', initials: 'MD' },
]

type LineItem = {
  id: string
  desc: string
  sub: string
  qty: number | string
  rate: number | string
  tax: string
}

type InvoiceData = {
  id: string
  customerId: string
  customerName: string
  customerEmail: string
  issueDate: string
  dueDate: string
  amount: number
  status: string
  lines: Array<{
    id: string
    description: string
    qty: number
    rate: number
    taxRate: number
    amount: number
  }>
} | null

function money(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtDueChip(dateStr: string) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function newLineId() {
  return Math.random().toString(36).slice(2)
}

const SEED_LINES: LineItem[] = [
  { id: newLineId(), desc: 'Brand & website redesign', sub: 'Discovery, UX, and visual design', qty: 1,  rate: 12000, tax: '8.5' },
  { id: newLineId(), desc: 'Front-end development',    sub: 'Responsive build, 8 templates',      qty: 64, rate: 145,   tax: '8.5' },
  { id: newLineId(), desc: 'Monthly hosting & support', sub: 'May 2026 retainer',                qty: 1,  rate: 850,   tax: 'none' },
]

export function InvoiceEditor({
  id,
  isNew,
  initialData,
}: {
  id: string
  isNew: boolean
  initialData: InvoiceData
}) {
  const router = useRouter()

  // Form state
  const [invoiceNum, setInvoiceNum] = useState(() => {
    if (!isNew && initialData) return initialData.id
    return 'INV-1049'
  })
  const [terms, setTerms] = useState('net30')
  const [issueDate, setIssueDate] = useState(() => {
    if (!isNew && initialData) return initialData.issueDate
    return today()
  })
  const [dueDate, setDueDate] = useState(() => {
    if (!isNew && initialData) return initialData.dueDate
    return addDays(today(), 30)
  })
  const [notes, setNotes] = useState(
    'Thank you for your business. Payment via bank transfer or card.'
  )
  const [termsText, setTermsText] = useState(
    'Late payments are subject to a 1.5% monthly service charge.'
  )
  const [discountPct, setDiscountPct] = useState('0')
  const [emailCopy, setEmailCopy] = useState(true)
  const [attachPdf, setAttachPdf] = useState(false)
  const [scheduleReminders, setScheduleReminders] = useState(true)
  const [custMenuOpen, setCustMenuOpen] = useState(false)

  // Customer state — when editing, seed from the invoice's real customer
  const [selectedCust, setSelectedCust] = useState(() => {
    if (!isNew && initialData) {
      const found = CUSTOMERS.find((c) => c.id === initialData.customerId)
      if (found) return found
      const words = initialData.customerName.split(' ').filter(Boolean)
      return {
        id: initialData.customerId,
        name: initialData.customerName,
        email: initialData.customerEmail,
        color: '#4b5666',
        initials: words.slice(0, 2).map((w) => w[0].toUpperCase()).join(''),
      }
    }
    return CUSTOMERS[0]
  })

  // Line items
  const [lines, setLines] = useState<LineItem[]>(() => {
    if (!isNew && initialData && initialData.lines.length > 0) {
      return initialData.lines.map((l) => ({
        id: l.id,
        desc: l.description,
        sub: '',
        qty: l.qty,
        rate: l.rate,
        tax: l.taxRate > 0 ? String(l.taxRate * 100) : 'none',
      }))
    }
    return SEED_LINES
  })

  // Auto-update due date when terms or issue date changes
  function applyTerms(newTerms: string, newIssue: string) {
    const days: Record<string, number> = {
      receipt: 0, net15: 15, net30: 30, net60: 60,
    }
    const d = days[newTerms]
    if (d != null && newIssue) {
      setDueDate(addDays(newIssue, d))
    }
  }

  function handleTermsChange(val: string) {
    setTerms(val)
    applyTerms(val, issueDate)
  }

  function handleIssueDateChange(val: string) {
    setIssueDate(val)
    applyTerms(terms, val)
  }

  // Totals calculation
  const totals = (() => {
    let subtotal = 0
    let taxTotal = 0
    lines.forEach((line) => {
      const qty = parseFloat(String(line.qty)) || 0
      const rate = parseFloat(String(line.rate)) || 0
      const amount = qty * rate
      const lineTax = amount * (TAX_RATES[line.tax] || 0)
      subtotal += amount
      taxTotal += lineTax
    })
    const discPct = parseFloat(discountPct) || 0
    const discount = subtotal * (discPct / 100)
    const total = subtotal - discount + taxTotal
    return { subtotal, discount, taxTotal, total }
  })()

  function lineAmount(line: LineItem) {
    const qty = parseFloat(String(line.qty)) || 0
    const rate = parseFloat(String(line.rate)) || 0
    return qty * rate
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { id: newLineId(), desc: '', sub: '', qty: 1, rate: 0, tax: '8.5' },
    ])
  }

  function removeLine(lineId: string) {
    setLines((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((l) => l.id !== lineId)
    })
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)),
    )
  }

  const isEditing = !isNew && initialData !== null
  const pageTitle = isEditing ? `Edit ${id}` : 'New invoice'

  const createInvoice = trpc.invoices.create.useMutation()
  const updateInvoice = trpc.invoices.update.useMutation()
  const saving = createInvoice.isPending || updateInvoice.isPending

  const handleSave = useCallback(
    async (status: 'draft' | 'sent') => {
      const payloadLines = lines.map((l) => {
        const qty = parseFloat(String(l.qty)) || 0
        const rate = parseFloat(String(l.rate)) || 0
        return {
          description: l.desc || 'Item',
          subDescription: l.sub || undefined,
          qty,
          rate,
          taxRate: l.tax === 'none' ? 0 : (parseFloat(l.tax) || 0) / 100,
          amount: qty * rate,
        }
      })

      const base = {
        issueDate,
        dueDate,
        amount: totals.total,
        status,
        notes,
        terms: termsText,
        lines: payloadLines,
        customerName: selectedCust.name,
      }

      try {
        if (isNew) {
          await createInvoice.mutateAsync({ id: invoiceNum, ...base })
        } else {
          await updateInvoice.mutateAsync({ id: initialData!.id, customerId: selectedCust.id, ...base })
        }
        router.push('/invoices')
        router.refresh()
      } catch {
        alert('Could not save the invoice. Please try again.')
      }
    },
    [
      isNew, invoiceNum, initialData, issueDate, dueDate, totals.total, notes,
      termsText, lines, selectedCust, createInvoice, updateInvoice, router,
    ],
  )
  const statusBadge = initialData?.status ?? 'draft'

  return (
    <>
      {/* BREADCRUMB */}
      <div className="breadcrumb">
        <Link href="/invoices">
          <ArrowLeft />Invoices
        </Link>
        <ChevronRight />
        <span className="cur">{pageTitle}</span>
      </div>

      {/* PAGE HEAD */}
      <div className="editor-page-head">
        <h1 className="greet">
          {pageTitle}{' '}
          <span className={`badge badge-${statusBadge}`}>
            <span className="dot" />
            {statusBadge.charAt(0).toUpperCase() + statusBadge.slice(1)}
          </span>
        </h1>
        <div className="spacer" />
        <div className="head-tools">
          <button className="btn btn-secondary"><Eye />Preview</button>
        </div>
      </div>

      <div className="editor-grid">
        {/* LEFT: FORM */}
        <div className="editor-main">

          {/* Bill to / Invoice details */}
          <div className="card card-pad">
            <div className="section-title">Bill to</div>
            <div className="field-grid">
              <div className="field span-2">
                <label>Customer</label>
                <div className="dd" style={{ position: 'relative' }}>
                  <button
                    className="cust-select"
                    onClick={(e) => { e.stopPropagation(); setCustMenuOpen(!custMenuOpen) }}
                  >
                    <span
                      className="av"
                      style={{ background: selectedCust.color }}
                    >
                      {selectedCust.initials}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="cs-name">{selectedCust.name}</span>
                      <div className="cs-sub">{selectedCust.email}</div>
                    </span>
                    <span className="chev"><ChevronsUpDown /></span>
                  </button>
                  {custMenuOpen && (
                    <div
                      className="menu left open"
                      style={{ minWidth: '300px' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="menu-label">Select customer</div>
                      {CUSTOMERS.map((c) => (
                        <div
                          key={c.id}
                          className="menu-org"
                          onClick={() => {
                            setSelectedCust(c)
                            setCustMenuOpen(false)
                          }}
                        >
                          <span className="mo-tile" style={{ background: c.color }}>
                            {c.initials}
                          </span>
                          <span className="mo-name">{c.name}</span>
                          {selectedCust.id === c.id && (
                            <span className="mo-check"><Check /></span>
                          )}
                        </div>
                      ))}
                      <div className="menu-sep" />
                      <div className="menu-item"><Plus />New customer</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="section-title" style={{ marginTop: '22px' }}>Invoice details</div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="f-num">Invoice number</label>
                <div className="input-group">
                  <span
                    className="lead-sym"
                    style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}
                  >
                    #
                  </span>
                  <input
                    className="input has-sym"
                    id="f-num"
                    type="text"
                    value={invoiceNum}
                    onChange={(e) => setInvoiceNum(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-terms">Payment terms</label>
                <select
                  className="select"
                  id="f-terms"
                  value={terms}
                  onChange={(e) => handleTermsChange(e.target.value)}
                >
                  <option value="receipt">Due on receipt</option>
                  <option value="net15">Net 15</option>
                  <option value="net30">Net 30</option>
                  <option value="net60">Net 60</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-issue">Issue date</label>
                <input
                  className="input"
                  id="f-issue"
                  type="date"
                  value={issueDate}
                  onChange={(e) => handleIssueDateChange(e.target.value)}
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

          {/* Line items */}
          <div className="card card-pad">
            <div className="section-title">Line items</div>
            <table className="li-table">
              <thead>
                <tr>
                  <th className="li-col-desc">Item / description</th>
                  <th className="li-col-qty num">Qty</th>
                  <th className="li-col-rate num">Rate</th>
                  <th className="li-col-tax">Tax</th>
                  <th className="li-col-amt num">Amount</th>
                  <th className="li-col-del" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="li-row">
                    <td className="li-col-desc">
                      <input
                        className="li-input desc-main"
                        placeholder="Item or service"
                        value={line.desc}
                        onChange={(e) => updateLine(line.id, 'desc', e.target.value)}
                      />
                      <textarea
                        className="li-desc-sub"
                        rows={1}
                        placeholder="Description (optional)"
                        value={line.sub}
                        onChange={(e) => updateLine(line.id, 'sub', e.target.value)}
                      />
                    </td>
                    <td className="li-col-qty">
                      <input
                        className="li-input li-num li-qty"
                        type="text"
                        inputMode="decimal"
                        value={line.qty}
                        onChange={(e) => updateLine(line.id, 'qty', e.target.value)}
                      />
                    </td>
                    <td className="li-col-rate">
                      <input
                        className="li-input li-num li-rate"
                        type="text"
                        inputMode="decimal"
                        value={line.rate}
                        onChange={(e) => updateLine(line.id, 'rate', e.target.value)}
                      />
                    </td>
                    <td className="li-col-tax">
                      <select
                        className="li-input li-select li-tax"
                        value={line.tax}
                        onChange={(e) => updateLine(line.id, 'tax', e.target.value)}
                      >
                        <option value="none">No tax</option>
                        <option value="8.5">8.5%</option>
                        <option value="10">10%</option>
                        <option value="20">20%</option>
                      </select>
                    </td>
                    <td className="li-col-amt">
                      <div className="li-amt">{money(lineAmount(line))}</div>
                    </td>
                    <td className="li-col-del">
                      <button
                        className="li-del"
                        aria-label="Remove line"
                        onClick={() => removeLine(line.id)}
                      >
                        <X />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-secondary btn-sm add-line" onClick={addLine}>
              <Plus />Add line
            </button>
          </div>

          {/* Notes & terms */}
          <div className="card card-pad">
            <div className="field-grid">
              <div className="field">
                <label htmlFor="f-notes">Notes to customer</label>
                <textarea
                  className="textarea"
                  id="f-notes"
                  placeholder="Add a note…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="f-tc">Terms &amp; conditions</label>
                <textarea
                  className="textarea"
                  id="f-tc"
                  placeholder="Payment terms…"
                  value={termsText}
                  onChange={(e) => setTermsText(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: TOTALS PANEL */}
        <aside className="totals-panel">
          <div className="card totals-card">
            <div className="section-title">Summary</div>
            <div className="tot-row">
              <span className="lbl">Subtotal</span>
              <span className="val">{money(totals.subtotal)}</span>
            </div>
            <div className="tot-row">
              <span className="lbl">
                Discount{' '}
                <span className="input-group" style={{ display: 'inline-flex' }}>
                  <input
                    className="input disc-input"
                    id="disc-input"
                    type="text"
                    inputMode="decimal"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(e.target.value)}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: '9px',
                      color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                    }}
                  >
                    %
                  </span>
                </span>
              </span>
              <span className="val neg">&minus;{money(totals.discount)}</span>
            </div>
            <div className="tot-row">
              <span className="lbl">Tax</span>
              <span className="val">{money(totals.taxTotal)}</span>
            </div>
            <div className="tot-total">
              <span className="lbl">Total due</span>
              <span className="val">{money(totals.total)}</span>
            </div>
            <div className="tot-meta">
              <span>Currency</span>
              <span className="tot-due">USD · $</span>
            </div>
            <div
              className="tot-meta"
              style={{ marginTop: 0, borderTop: 0, paddingTop: '6px' }}
            >
              <span>Due date</span>
              <span className="tot-due">{fmtDueChip(dueDate)}</span>
            </div>
          </div>

          <div
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}
          >
            <div className="section-title" style={{ margin: 0 }}>Delivery</div>
            <label className="check">
              <input
                type="checkbox"
                checked={emailCopy}
                onChange={(e) => setEmailCopy(e.target.checked)}
              />
              <span className="box"><Check /></span>
              Email a copy to customer
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={(e) => setAttachPdf(e.target.checked)}
              />
              <span className="box"><Check /></span>
              Attach PDF
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={scheduleReminders}
                onChange={(e) => setScheduleReminders(e.target.checked)}
              />
              <span className="box"><Check /></span>
              Schedule payment reminders
            </label>
          </div>
        </aside>
      </div>

      {/* FOOTER BAR */}
      <footer className="editor-footer">
        <span className="ef-note">
          <Save />
          Draft auto-saved · total{' '}
          <span
            className="t-num"
            style={{ color: 'var(--text-strong)', fontWeight: 600 }}
          >
            {money(totals.total)}
          </span>
        </span>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={() => router.push('/invoices')} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-secondary" onClick={() => handleSave('draft')} disabled={saving}>
          <FileEdit />Save as draft
        </button>
        <button className="btn btn-primary" onClick={() => handleSave('sent')} disabled={saving}>
          <Send />{saving ? 'Saving…' : 'Send invoice'}
        </button>
      </footer>
    </>
  )
}
