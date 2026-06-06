'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import {
  Upload,
  Plus,
  RefreshCw,
  Ellipsis,
  Check,
  CheckCheck,
  EyeOff,
  Sparkles,
  ChevronDown,
  Link as LinkIcon,
  CheckCircle2,
  Undo2,
  Lock,
  ArrowLeft,
  ArrowRight,
  X,
  UploadCloud,
  Info,
  Inbox,
  CopyCheck,
} from 'lucide-react'

// ─── Data types ──────────────────────────────────────────────────────────────
type TxStatus = 'review' | 'cat' | 'excl'

interface Transaction {
  id: number
  dbId?: string
  st: TxStatus
  date: string
  m: string
  acct: string
  spent?: number
  recv?: number
  sug?: string
  cat?: string
  match?: string
  reason?: string
}

interface Account {
  id: string
  name: string
  mask: string
  logo: string
  logoColor: string
  balance: number
  balanceLabel: string
  syncStatus: 'ok' | 'warn'
  syncLabel: string
}

// ─── Static data ─────────────────────────────────────────────────────────────
const CATS: Record<string, string> = {
  'Sales income':    '#16a063',
  'Software':        '#1f6feb',
  'Rent & lease':    '#d6961f',
  'Travel & meals':  '#0ea5b5',
  'Office supplies': '#7c5cff',
  'Utilities':       '#5b8bf8',
  'Payroll':         '#4b5666',
  'Bank fees':       '#9aa6b8',
  'Advertising':     '#f0883e',
}

const MAV: Record<string, { i: string; c: string }> = {
  'Stripe payout':             { i: 'S',  c: '#635bff' },
  'AWS':                       { i: 'AW', c: '#ec912d' },
  'WeWork':                    { i: 'WE', c: '#1f6feb' },
  'Delta Air Lines':           { i: 'DL', c: '#9b1b30' },
  'Gusto':                     { i: 'G',  c: '#f45d48' },
  'Shopify payout':            { i: 'SH', c: '#16a063' },
  'Staples':                   { i: 'ST', c: '#cf353c' },
  'Comcast Business':          { i: 'CB', c: '#4b5666' },
  'Payment — Vertex Partners': { i: 'VP', c: '#4b5666' },
  'Adobe':                     { i: 'A',  c: '#e0484e' },
  'Verizon':                   { i: 'VZ', c: '#cf353c' },
  'Payroll run':               { i: 'PR', c: '#4b5666' },
  'Deposit — Summit Health':   { i: 'SH', c: '#3074ef' },
  'Uber':                      { i: 'U',  c: '#1f2733' },
  'Notion':                    { i: 'N',  c: '#1f2733' },
  'Owner transfer → savings':  { i: '↔',  c: '#697587' },
  'Stripe payout (dup)':       { i: 'S',  c: '#635bff' },
}

const ACCOUNTS: Account[] = [
  { id: 'chase',  name: 'Chase Business Checking', mask: '•••• 4021', logo: 'CB', logoColor: '#117aca', balance: 142580.00,  balanceLabel: 'Current balance', syncStatus: 'ok',   syncLabel: 'Synced 2 min ago' },
  { id: 'amex',   name: 'Amex Business',           mask: '•••• 6700', logo: 'AX', logoColor: '#1b3a5b', balance: -8420.55,   balanceLabel: 'Current balance', syncStatus: 'ok',   syncLabel: 'Synced 11 min ago' },
  { id: 'stripe', name: 'Stripe Payouts',          mask: '•••• 9930', logo: 'ST', logoColor: '#635bff', balance: 6961.55,    balanceLabel: 'Pending payout',  syncStatus: 'warn', syncLabel: 'Syncs daily · 6h ago' },
]

const INITIAL_TRANSACTIONS: Transaction[] = [
  // To review
  { id: 1,  st: 'review', date: '2026-05-18', m: 'Stripe payout',            acct: 'Stripe Payouts', recv: 4820.00,  sug: 'Sales income',  match: '2 invoices' },
  { id: 2,  st: 'review', date: '2026-05-17', m: 'AWS',                       acct: 'Amex ••6700',   spent: 1284.30, sug: 'Software' },
  { id: 3,  st: 'review', date: '2026-05-16', m: 'WeWork',                    acct: 'Chase ••4021',  spent: 3500.00, sug: 'Rent & lease' },
  { id: 4,  st: 'review', date: '2026-05-15', m: 'Delta Air Lines',           acct: 'Amex ••6700',   spent: 642.40,  sug: 'Travel & meals' },
  { id: 5,  st: 'review', date: '2026-05-14', m: 'Gusto',                     acct: 'Chase ••4021',  spent: 89.00,   sug: 'Bank fees' },
  { id: 6,  st: 'review', date: '2026-05-13', m: 'Shopify payout',            acct: 'Stripe Payouts',recv: 2140.55,  sug: 'Sales income' },
  { id: 7,  st: 'review', date: '2026-05-12', m: 'Staples',                   acct: 'Amex ••6700',   spent: 142.18,  sug: 'Office supplies' },
  { id: 8,  st: 'review', date: '2026-05-11', m: 'Comcast Business',          acct: 'Chase ••4021',  spent: 219.99,  sug: 'Utilities' },
  { id: 9,  st: 'review', date: '2026-05-10', m: 'Payment — Vertex Partners', acct: 'Chase ••4021',  recv: 23110.00, sug: 'Sales income',  match: 'INV-1044' },
  { id: 10, st: 'review', date: '2026-05-09', m: 'Adobe',                     acct: 'Amex ••6700',   spent: 599.88,  sug: 'Software' },
  // Categorized
  { id: 11, st: 'cat', date: '2026-05-08', m: 'Verizon',              acct: 'Amex ••6700',   spent: 180.00,   cat: 'Utilities' },
  { id: 12, st: 'cat', date: '2026-05-07', m: 'Payroll run',          acct: 'Chase ••4021',  spent: 18400.00, cat: 'Payroll' },
  { id: 13, st: 'cat', date: '2026-05-06', m: 'Deposit — Summit Health', acct: 'Chase ••4021', recv: 18200.00, cat: 'Sales income', match: 'INV-1045' },
  { id: 14, st: 'cat', date: '2026-05-05', m: 'Uber',                 acct: 'Amex ••6700',   spent: 47.20,    cat: 'Travel & meals' },
  { id: 15, st: 'cat', date: '2026-05-04', m: 'Notion',               acct: 'Amex ••6700',   spent: 96.00,    cat: 'Software' },
  // Excluded
  { id: 16, st: 'excl', date: '2026-05-03', m: 'Owner transfer → savings', acct: 'Chase ••4021',  spent: 5000.00, reason: 'Transfer' },
  { id: 17, st: 'excl', date: '2026-05-02', m: 'Stripe payout (dup)',      acct: 'Stripe Payouts',recv: 4820.00,  reason: 'Duplicate' },
]

const BANK_BALANCE = 142580.00

// Import wizard sample data
const IMPORT_SAMPLES: Record<string, {
  file: { name: string; size: string }
  headers: string[]
  maps: string[]
  samplesRow: string[]
  rows: { date: string; raw: string; m: string; amt: number; sug: string; match?: string; dup?: boolean }[]
}> = {
  chase: {
    file: { name: 'chase-business-checking-2026-05.csv', size: '18 KB' },
    headers: ['Posting Date', 'Description', 'Amount', 'Running Balance'],
    maps: ['date', 'desc', 'amount', 'balance'],
    samplesRow: ['05/18/2026', 'STRIPE TRANSFER ST-2271', '4820.00', '142,580.00'],
    rows: [
      { date: '2026-05-18', raw: 'STRIPE TRANSFER ST-2271',   m: 'Stripe payout',             amt:  4820.00, sug: 'Sales income' },
      { date: '2026-05-17', raw: 'AWS EMEA AMAZON WEB SVC',    m: 'AWS',                       amt: -1284.30, sug: 'Software' },
      { date: '2026-05-16', raw: 'WEWORK 205 HUDSON ST',       m: 'WeWork',                    amt: -3500.00, sug: 'Rent & lease' },
      { date: '2026-05-15', raw: 'DELTA AIR 0061234567',       m: 'Delta Air Lines',           amt:  -642.40, sug: 'Travel & meals' },
      { date: '2026-05-14', raw: 'GUSTO PAYROLL FEE',          m: 'Gusto',                     amt:   -89.00, sug: 'Bank fees' },
      { date: '2026-05-13', raw: 'SHOPIFY TRANSFER PAYOUT',    m: 'Shopify payout',            amt:  2140.55, sug: 'Sales income' },
      { date: '2026-05-12', raw: 'COMCAST BUSINESS 89421',     m: 'Comcast Business',          amt:  -219.99, sug: 'Utilities' },
      { date: '2026-05-10', raw: 'ACH CREDIT VERTEX PARTNERS', m: 'Payment — Vertex Partners', amt: 23110.00, sug: 'Sales income', match: 'INV-1044' },
      { date: '2026-05-09', raw: 'STRIPE TRANSFER ST-2270',    m: 'Stripe payout',             amt:  4820.00, sug: 'Sales income', dup: true },
      { date: '2026-05-08', raw: 'VERIZON WIRELESS PMT',       m: 'Verizon',                   amt:  -180.00, sug: 'Utilities' },
      { date: '2026-05-07', raw: 'ADP PAYROLL RUN 05/07',      m: 'Payroll run',               amt:-18400.00, sug: 'Payroll', dup: true },
      { date: '2026-05-06', raw: 'STAPLES STORE 00114',        m: 'Staples',                   amt:  -142.18, sug: 'Office supplies' },
      { date: '2026-05-04', raw: 'GOOGLE ADS 8829411',         m: 'Google Ads',                amt:  -560.00, sug: 'Advertising' },
      { date: '2026-05-03', raw: 'CITY POWER & LIGHT',         m: 'City Power & Light',        amt:  -410.55, sug: 'Utilities' },
    ],
  },
  amex: {
    file: { name: 'amex-business-2026-05.csv', size: '12 KB' },
    headers: ['Date', 'Description', 'Charges', 'Payments / Credits'],
    maps: ['date', 'desc', 'debit', 'credit'],
    samplesRow: ['05/17/2026', 'AWS EMEA', '1,284.30', ''],
    rows: [
      { date: '2026-05-17', raw: 'AWS EMEA',                 m: 'AWS',           amt: -1284.30, sug: 'Software' },
      { date: '2026-05-15', raw: 'DELTA AIR LINES 0061',     m: 'Delta Air Lines', amt: -642.40, sug: 'Travel & meals' },
      { date: '2026-05-12', raw: 'STAPLES 00114',            m: 'Staples',       amt:  -142.18, sug: 'Office supplies' },
      { date: '2026-05-11', raw: 'ADOBE INC 408-536',        m: 'Adobe',         amt:  -599.88, sug: 'Software', dup: true },
      { date: '2026-05-10', raw: 'UBER TRIP HELP.UBER.COM',  m: 'Uber',          amt:   -47.20, sug: 'Travel & meals' },
      { date: '2026-05-09', raw: 'NOTION LABS INC',          m: 'Notion',        amt:   -96.00, sug: 'Software' },
      { date: '2026-05-08', raw: 'GITHUB INC',               m: 'GitHub',        amt:   -84.00, sug: 'Software' },
    ],
  },
  stripe: {
    file: { name: 'stripe-payouts-2026-05.csv', size: '9 KB' },
    headers: ['Date', 'Description', 'Amount'],
    maps: ['date', 'desc', 'amount'],
    samplesRow: ['05/18/2026', 'Payout to ••9930', '4,820.00'],
    rows: [
      { date: '2026-05-18', raw: 'po_1NxQ payout', m: 'Stripe payout', amt: 4820.00, sug: 'Sales income' },
      { date: '2026-05-15', raw: 'po_1NwB payout', m: 'Stripe payout', amt: 1980.40, sug: 'Sales income' },
      { date: '2026-05-13', raw: 'po_1Nv2 payout', m: 'Stripe payout', amt: 2140.55, sug: 'Sales income' },
    ],
  },
  new: {
    file: { name: 'capital-one-spark-2026-05.csv', size: '11 KB' },
    headers: ['Trans Date', 'Merchant', 'Debit', 'Credit'],
    maps: ['date', 'desc', 'debit', 'credit'],
    samplesRow: ['05/16/2026', 'FEDEX OFFICE 2241', '64.80', ''],
    rows: [
      { date: '2026-05-16', raw: 'FEDEX OFFICE 2241',   m: 'FedEx Office',     amt:  -64.80, sug: 'Office supplies' },
      { date: '2026-05-14', raw: 'DROPBOX BUSINESS',    m: 'Dropbox',          amt: -120.00, sug: 'Software' },
      { date: '2026-05-12', raw: 'AMERICAN AIR 0012245',m: 'American Airlines', amt: -512.20, sug: 'Travel & meals' },
    ],
  },
}

const IMPORT_ACCT_NAMES: Record<string, string> = {
  chase: 'Chase Business Checking',
  amex: 'Amex Business',
  stripe: 'Stripe Payouts',
  new: 'New account',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fdate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function getMav(name: string) {
  return MAV[name] ?? { i: name.slice(0, 2).toUpperCase(), c: '#697587' }
}

function avatarFor(name: string) {
  const w = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/)
  const i = ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase()
  let h = 0
  for (let k = 0; k < name.length; k++) h = ((h * 31 + name.charCodeAt(k)) >>> 0)
  const AV_COLORS = ['#1f6feb', '#16a063', '#d6961f', '#0ea5b5', '#7c5cff', '#cf353c', '#4b5666', '#635bff', '#ec912d', '#1f2733']
  return { i, c: AV_COLORS[h % AV_COLORS.length] }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
interface ToastItem { id: number; title: string; sub: string }

function ToastStack({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <CheckCircle2 className="t-ico" style={{ width: 18, height: 18, color: 'var(--success)' }} />
          <div className="t-body">{t.title}<div className="t-sub">{t.sub}</div></div>
        </div>
      ))}
    </div>
  )
}

// ─── Category menu ────────────────────────────────────────────────────────────
interface CatMenuProps {
  anchorEl: HTMLElement | null
  onSelect: (cat: string) => void
  onClose: () => void
}

function CatMenu({ anchorEl, onSelect, onClose }: CatMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    if (anchorEl) {
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }
  }, [anchorEl, onClose])

  if (!anchorEl) return null

  const rect = anchorEl.getBoundingClientRect()
  const left = Math.min(rect.left, window.innerWidth - 234)

  return (
    <div
      ref={ref}
      className="menu open"
      style={{ position: 'fixed', top: rect.bottom + 6, left, minWidth: 220, zIndex: 200 }}
    >
      <div className="menu-label">Set category</div>
      {Object.entries(CATS).map(([name, color]) => (
        <div key={name} className="menu-item" onClick={() => onSelect(name)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="cat-dot" style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
          {name}
        </div>
      ))}
    </div>
  )
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
interface ImportModalProps {
  open: boolean
  onClose: () => void
  onImport: (count: number, acctName: string) => void
}

function ImportModal({ open, onClose, onImport }: ImportModalProps) {
  const [step, setStep] = useState(1)
  const [acctKey, setAcctKey] = useState('chase')
  const [skipDups, setSkipDups] = useState(true)
  const [fileShown, setFileShown] = useState(false)
  const importMut = trpc.banking.importTransactions.useMutation()

  const sample = IMPORT_SAMPLES[acctKey] ?? IMPORT_SAMPLES.chase
  const totalRows = sample.rows.length
  const dupRows = sample.rows.filter((r) => r.dup).length
  const willImport = skipDups ? totalRows - dupRows : totalRows

  // reset on open
  useEffect(() => {
    if (open) { setStep(1); setAcctKey('chase'); setSkipDups(true); setFileShown(false) }
  }, [open])

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape' && open) onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function doImport() {
    const rowsToImport = skipDups ? sample.rows.filter((r) => !r.dup) : sample.rows
    try {
      await importMut.mutateAsync({
        accountKey: acctKey,
        rows: rowsToImport.map((r) => ({
          date: r.date,
          description: r.raw,
          merchant: r.m,
          amount: r.amt,
        })),
      })
    } catch {
      // fire-and-forget: still show success toast since demo data
    }
    onImport(willImport, IMPORT_ACCT_NAMES[acctKey] ?? 'Account')
    onClose()
  }

  if (!open) return null

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="import-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <header className="im-head">
          <div>
            <h2>Import transactions</h2>
            <p className="im-sub">Upload a bank or credit card statement — CSV, PDF, or OFX/QFX.</p>
          </div>
          <button className="im-close" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        {/* Step indicators */}
        <div className="im-steps">
          {[1, 2, 3].map((n, idx) => (
            <>
              <div key={n} className={`im-step${step === n ? ' active' : step > n ? ' done' : ''}`} data-step={n}>
                <span className="sd">
                  {step > n ? <Check style={{ width: 14, height: 14 }} /> : n}
                </span>
                <span className="sl">{['Account & file', 'Map columns', 'Review & confirm'][idx]}</span>
              </div>
              {idx < 2 && <div key={`line-${n}`} className="im-step-line" />}
            </>
          ))}
        </div>

        {/* Body */}
        <div className="im-body">
          {/* Step 1 */}
          <section className={`im-panel${step === 1 ? ' active' : ''}`} data-step={1}>
            <div className="im-group">
              <label className="im-label">Which account does this statement belong to?</label>
              <select
                className="select"
                value={acctKey}
                onChange={(e) => { setAcctKey(e.target.value); setFileShown(false) }}
                style={{ width: '100%' }}
              >
                <option value="chase">Chase Business Checking · ••4021</option>
                <option value="amex">Amex Business · ••6700</option>
                <option value="stripe">Stripe Payouts · ••9930</option>
                <option value="new">+ Add new account…</option>
              </select>
              {acctKey === 'new' && (
                <div className="newacct show" style={{ marginTop: 14 }}>
                  <div className="field">
                    <label>Account name</label>
                    <input className="input" type="text" defaultValue="Capital One Spark" />
                  </div>
                  <div className="field">
                    <label>Type</label>
                    <select className="select">
                      <option>Credit card</option>
                      <option>Checking</option>
                      <option>Savings</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            <div className="im-group">
              <label className="im-label">Statement file</label>
              {!fileShown ? (
                <div className="dropzone" onClick={() => setFileShown(true)}>
                  <div className="dz-ico"><UploadCloud style={{ width: 22, height: 22 }} /></div>
                  <div className="dz-title">Drop your statement here or <b>browse</b></div>
                  <div className="dz-meta">CSV · PDF · OFX / QFX — up to 10 MB</div>
                </div>
              ) : (
                <div className="file-chip">
                  <span className="fc-ico">CSV</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="fc-name">{sample.file.name}</div>
                    <div className="fc-meta">CSV · {sample.file.size} · {sample.rows.length} rows detected</div>
                  </div>
                  <span className="fc-x" onClick={() => setFileShown(false)} title="Remove"><X style={{ width: 15, height: 15 }} /></span>
                </div>
              )}
              <div className="im-help">
                <Info style={{ width: 13, height: 13 }} />
                <span>CSV and OFX/QFX import most reliably. PDF parsing is best-effort — column detection may need a quick review on the next step.</span>
              </div>
            </div>
          </section>

          {/* Step 2 */}
          <section className={`im-panel${step === 2 ? ' active' : ''}`} data-step={2}>
            <div className="im-group">
              <label className="im-label">Map your file columns to LedgerPro fields</label>
              <div className="map-wrap">
                <table className="map-table">
                  <thead>
                    <tr><th>File column</th><th>Sample value</th><th></th><th>LedgerPro field</th></tr>
                  </thead>
                  <tbody>
                    {sample.headers.map((h, i) => (
                      <tr key={h}>
                        <td className="map-col">{h}</td>
                        <td className="map-sample">{sample.samplesRow[i] || '—'}</td>
                        <td className="map-arrow"><ArrowRight style={{ width: 15, height: 15 }} /></td>
                        <td>
                          <select className="select" defaultValue={sample.maps[i]}>
                            <option value="date">Date</option>
                            <option value="desc">Description</option>
                            <option value="amount">Amount (signed)</option>
                            <option value="debit">Debit / charge</option>
                            <option value="credit">Credit / payment</option>
                            <option value="balance">Balance (optional)</option>
                            <option value="ignore">Ignore column</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="im-group">
              <label className="im-label">Negative amounts represent</label>
              <div className="sign-control">
                <button aria-pressed="true">Money out (default)</button>
                <button aria-pressed="false">Money in</button>
              </div>
            </div>
            <div className="im-group">
              <label className="im-label">Live preview</label>
              <div className="prev-wrap">
                <table className="prev-table">
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Original text</th><th className="num">Amount</th></tr>
                  </thead>
                  <tbody>
                    {sample.rows.slice(0, 4).map((r, i) => {
                      const out = r.amt < 0
                      return (
                        <tr key={i}>
                          <td className="p-date">{fdate(r.date)}</td>
                          <td className="p-desc">{r.m}</td>
                          <td className="p-raw">{r.raw}</td>
                          <td className={`p-amt ${out ? 'out' : 'in'}`}>{out ? '−' : '+'}${fmt(Math.abs(r.amt))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="prev-cap">Showing 4 of {sample.rows.length} parsed rows</div>
            </div>
          </section>

          {/* Step 3 */}
          <section className={`im-panel${step === 3 ? ' active' : ''}`} data-step={3}>
            <div className="rev-summary">
              <div className="rev-stat">
                <div className="rs-num">{totalRows}</div>
                <div className="rs-lbl">Transactions found</div>
              </div>
              <div className={`rev-stat ${dupRows ? 'warn' : 'ok'}`}>
                <div className="rs-num">{dupRows}</div>
                <div className="rs-lbl">Possible duplicates</div>
              </div>
              <div className="rev-stat">
                <div className="rs-num" style={{ fontSize: 'var(--text-sm)', paddingTop: 5 }}>May 1 – May 31, 2026</div>
                <div className="rs-lbl">Date range</div>
              </div>
            </div>

            {dupRows > 0 && (
              <div className="dup-note">
                <span className="dn-ico"><CopyCheck style={{ width: 17, height: 17 }} /></span>
                <div style={{ flex: 1 }}>
                  <div className="dn-title">Possible duplicates detected</div>
                  <div className="dn-text">{dupRows} transaction{dupRows !== 1 ? 's' : ''} closely match entries already in your books (same date, amount, and merchant). They&apos;re flagged below.</div>
                  <label className="check" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, cursor: 'pointer' }} onClick={() => setSkipDups(!skipDups)}>
                    <span className={`tcheck${skipDups ? ' on' : ''}`} role="checkbox" aria-checked={skipDups}>
                      <Check style={{ width: 11, height: 11 }} />
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}>Skip likely duplicates on import</span>
                  </label>
                </div>
              </div>
            )}

            <label className="im-label">
              Detected transactions → <span style={{ color: 'var(--accent)' }}>{IMPORT_ACCT_NAMES[acctKey]}</span>
            </label>
            <div className="rev-list">
              {sample.rows.map((r, i) => {
                const av = avatarFor(r.m)
                const out = r.amt < 0
                return (
                  <div key={i} className={`rev-row${r.dup ? ' dup' : ''}`}>
                    <span className="rr-date">{fdate(r.date)}</span>
                    <span className="rr-av" style={{ background: av.c }}>{av.i}</span>
                    <span className="rr-meta">
                      <span className="rr-name">{r.m}</span>
                      <span className="rr-raw">{r.raw}</span>
                    </span>
                    {r.dup && <span className="badge badge-pending"><span className="dot" />Duplicate</span>}
                    <span className={`rr-amt ${out ? 'out' : 'in'}`}>{out ? '−' : '+'}${fmt(Math.abs(r.amt))}</span>
                  </div>
                )
              })}
            </div>
            <div className="im-help">
              <Inbox style={{ width: 13, height: 13 }} />
              <span>Imported transactions land in your <b>To review</b> queue, ready to categorize and match.</span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="im-foot">
          <button
            className="btn btn-ghost"
            style={{ visibility: step === 1 ? 'hidden' : 'visible' }}
            onClick={() => setStep(Math.max(1, step - 1))}
          >
            <ArrowLeft style={{ width: 15, height: 15 }} />Back
          </button>
          <div className="grow" />
          <span className="step-count">Step {step} of 3</span>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={() => setStep(Math.min(3, step + 1))}>
              Continue <ArrowRight style={{ width: 15, height: 15 }} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={doImport}>
              Import {willImport} transaction{willImport !== 1 ? 's' : ''}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
interface BankingContentProps {
  accounts?: Account[]
  initialTransactions?: Transaction[]
}

export function BankingContent({ accounts, initialTransactions }: BankingContentProps = {}) {
  const router = useRouter()
  // Prefer DB-provided data; fall back to built-in samples when empty/unavailable
  const accountsList = accounts && accounts.length > 0 ? accounts : ACCOUNTS
  const seedTransactions =
    initialTransactions && initialTransactions.length > 0
      ? initialTransactions
      : INITIAL_TRANSACTIONS

  const [data, setData] = useState<Transaction[]>(seedTransactions)
  const [tab, setTab] = useState<TxStatus>('review')
  const [selectedAcct, setSelectedAcct] = useState<string>(accountsList[0]?.id ?? 'chase')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [catAnchor, setCatAnchor] = useState<HTMLElement | null>(null)
  const [catTargetId, setCatTargetId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)

  // Statement inputs (reconciliation)
  const [stmtBalance, setStmtBalance] = useState('142,580.00')
  const [stmtDate, setStmtDate] = useState('2026-05-31')

  // ── Persistence (optimistic UI + fire-and-forget writes) ──────────────────
  const acceptMut = trpc.banking.acceptTransaction.useMutation()
  const excludeMut = trpc.banking.excludeTransaction.useMutation()
  const reopenMut = trpc.banking.reopenTransaction.useMutation()
  const categorizeMut = trpc.banking.categorizeTransaction.useMutation()
  const bulkAcceptMut = trpc.banking.bulkAccept.useMutation()
  const bulkExcludeMut = trpc.banking.bulkExclude.useMutation()

  const dbIdOf = useCallback(
    (numericId: number) => data.find((d) => d.id === numericId)?.dbId,
    [data],
  )
  const dbIdsOf = useCallback(
    (numericIds: number[]) =>
      numericIds
        .map((n) => data.find((d) => d.id === n)?.dbId)
        .filter((x): x is string => Boolean(x)),
    [data],
  )

  const tabData = data.filter((d) => d.st === tab)
  const counts = {
    review: data.filter((d) => d.st === 'review').length,
    cat: data.filter((d) => d.st === 'cat').length,
    excl: data.filter((d) => d.st === 'excl').length,
  }

  const selectedAcctInfo = accountsList.find((a) => a.id === selectedAcct) ?? accountsList[0]

  // Reconciliation — book against the selected account's current balance
  const bankBalance = Math.abs(selectedAcctInfo?.balance ?? BANK_BALANCE)
  const toReview = data.filter((d) => d.st === 'review')
  const remNet = toReview.reduce((s, d) => s + ((d.recv ?? 0) - (d.spent ?? 0)), 0)
  const bookBalance = bankBalance - remNet
  const difference = bankBalance - bookBalance
  const isZero = Math.abs(difference) < 0.005
  const clearedCount = data.filter((d) => d.st === 'cat').length + 132

  function addToast(title: string, sub: string) {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, title, sub }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200)
  }

  function setState(id: number, st: TxStatus) {
    const dbId = dbIdOf(id)
    setData((prev) => prev.map((d) => {
      if (d.id !== id) return d
      const next = { ...d, st }
      if (st === 'cat' && d.sug && !d.cat) next.cat = d.sug
      return next
    }))
    setChecked((prev) => { const s = new Set(prev); s.delete(id); return s })
    if (dbId) {
      if (st === 'cat') acceptMut.mutate({ id: dbId })
      else if (st === 'review') reopenMut.mutate({ id: dbId })
    }
  }

  function setExclude(id: number, reason = 'Manual') {
    const dbId = dbIdOf(id)
    setData((prev) => prev.map((d) => d.id === id ? { ...d, st: 'excl', reason } : d))
    setChecked((prev) => { const s = new Set(prev); s.delete(id); return s })
    if (dbId) excludeMut.mutate({ id: dbId, reason })
  }

  function bulkAccept() {
    const ids = [...checked]
    const dbIds = dbIdsOf(ids.filter((n) => data.find((d) => d.id === n)?.st === 'review'))
    setData((prev) => prev.map((d) => {
      if (!ids.includes(d.id) || d.st !== 'review') return d
      return { ...d, st: 'cat', cat: d.cat || d.sug }
    }))
    setChecked(new Set())
    if (dbIds.length) bulkAcceptMut.mutate({ ids: dbIds })
  }

  function bulkExclude() {
    const ids = [...checked]
    const dbIds = dbIdsOf(ids)
    setData((prev) => prev.map((d) => {
      if (!ids.includes(d.id)) return d
      return { ...d, st: 'excl', reason: 'Manual' }
    }))
    setChecked(new Set())
    if (dbIds.length) bulkExcludeMut.mutate({ ids: dbIds, reason: 'Manual' })
  }

  function toggleCheck(id: number) {
    setChecked((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function selectAll() {
    const visIds = tabData.filter((d) => d.st !== 'excl').map((d) => d.id)
    const allOn = visIds.every((id) => checked.has(id))
    if (allOn) setChecked(new Set())
    else setChecked(new Set(visIds))
  }

  const allChecked = tabData.filter((d) => d.st !== 'excl').length > 0 &&
    tabData.filter((d) => d.st !== 'excl').every((d) => checked.has(d.id))

  const checkedCount = [...checked].filter((id) => tabData.some((d) => d.id === id)).length

  const openCatMenu = useCallback((e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setCatTargetId(id)
    setCatAnchor(e.currentTarget as HTMLElement)
  }, [])

  function handleCatSelect(cat: string) {
    if (catTargetId !== null) {
      const dbId = dbIdOf(catTargetId)
      setData((prev) => prev.map((d) => d.id === catTargetId ? { ...d, cat, sug: cat } : d))
      if (dbId) categorizeMut.mutate({ id: dbId, category: cat })
    }
    setCatAnchor(null)
    setCatTargetId(null)
  }

  function handleImport(count: number, acctName: string) {
    addToast(`Imported ${count} transaction${count !== 1 ? 's' : ''}`, `Added to "To review" from ${acctName}`)
    setTab('review')
    router.refresh()
  }

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <h1 className="greet">Banking</h1>
          <div className="sub">Review and categorize transactions from your connected accounts</div>
        </div>
        <div className="spacer" />
        <div className="head-tools">
          <button className="btn btn-secondary" onClick={() => setImportOpen(true)}>
            <Upload style={{ width: 15, height: 15 }} />Import statement
          </button>
          <button className="btn btn-primary">
            <Plus style={{ width: 15, height: 15 }} />Connect account
          </button>
        </div>
      </div>

      {/* Account cards */}
      <div className="acct-cards">
        {accountsList.map((acct) => (
          <div
            key={acct.id}
            className={`acct-card${selectedAcct === acct.id ? ' selected' : ''}`}
            onClick={() => setSelectedAcct(acct.id)}
          >
            <div className="ac-top">
              <span className="ac-logo" style={{ background: acct.logoColor }}>{acct.logo}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ac-name">{acct.name}</div>
                <div className="ac-mask">{acct.mask}</div>
              </div>
              <span className="ac-menu"><Ellipsis style={{ width: 16, height: 16 }} /></span>
            </div>
            <div className="ac-ballabel">{acct.balanceLabel}</div>
            <div className={`ac-balance${acct.balance < 0 ? ' neg' : ''}`}>
              {acct.balance < 0 ? '−' : ''}${fmt(Math.abs(acct.balance))}
            </div>
            <div className="ac-foot">
              <span className={`sync-dot${acct.syncStatus === 'warn' ? ' warn' : ''}`} />
              {acct.syncLabel}
              <span className="refresh"><RefreshCw style={{ width: 14, height: 14 }} /></span>
            </div>
          </div>
        ))}

        <button className="acct-connect" onClick={() => {}}>
          <span className="ac-plus"><Plus style={{ width: 18, height: 18 }} /></span>
          <span>Connect account</span>
          <span className="ac-orimport" onClick={(e) => { e.stopPropagation(); setImportOpen(true) }}>
            <Upload style={{ width: 13, height: 13 }} />or import a statement
          </span>
        </button>
      </div>

      {/* Main grid */}
      <div className="bank-grid">
        {/* Left: transactions table */}
        <div className="table-wrap">
          {/* Tabs */}
          <div className="ftabs" role="tablist" style={{ padding: '0 6px' }}>
            <button
              className="review"
              role="tab"
              aria-selected={tab === 'review'}
              onClick={() => { setTab('review'); setChecked(new Set()) }}
            >
              To review <span className="cnt">{counts.review}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'cat'}
              onClick={() => { setTab('cat'); setChecked(new Set()) }}
            >
              Categorized <span className="cnt">{counts.cat}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'excl'}
              onClick={() => { setTab('excl'); setChecked(new Set()) }}
            >
              Excluded <span className="cnt">{counts.excl}</span>
            </button>
          </div>

          {/* Bulk toolbar */}
          <div className={`bulk-toolbar${checkedCount > 0 ? ' armed' : ''}`}>
            <span
              className={`tcheck${allChecked ? ' on' : ''}`}
              role="checkbox"
              aria-checked={allChecked}
              onClick={selectAll}
              style={{ cursor: 'pointer' }}
            >
              <Check style={{ width: 11, height: 11 }} />
            </span>
            {checkedCount === 0 ? (
              <span className="bsel" onClick={selectAll} style={{ cursor: 'pointer' }}>Select all</span>
            ) : (
              <span className="bsel" style={{ display: 'flex', gap: 10 }}>
                <span><span className="bcount">{checkedCount}</span> selected</span>
              </span>
            )}
            <div className="spacer" />
            <button className="btn btn-secondary btn-sm" onClick={bulkExclude}>
              <EyeOff style={{ width: 13, height: 13 }} />Exclude
            </button>
            <button className="btn btn-primary btn-sm" onClick={bulkAccept}>
              <CheckCheck style={{ width: 13, height: 13 }} />Accept selected
            </button>
          </div>

          {/* Table */}
          {tabData.length > 0 ? (
            <table className="bank-tbl">
              <thead>
                <tr>
                  <th className="col-check"></th>
                  <th className="col-date">Date</th>
                  <th>Description</th>
                  <th className="col-amt num">Spent</th>
                  <th className="col-amt num">Received</th>
                  <th className="col-cat">Category</th>
                  <th className="col-match">Match</th>
                  <th className="col-act"></th>
                </tr>
              </thead>
              <tbody>
                {tabData.map((d) => {
                  const av = getMav(d.m)
                  const isChecked = checked.has(d.id)
                  return (
                    <tr key={d.id} data-id={d.id} data-st={d.st}>
                      <td className="col-check">
                        {d.st !== 'excl' && (
                          <span
                            className={`tcheck row-check${isChecked ? ' on' : ''}`}
                            role="checkbox"
                            aria-checked={isChecked}
                            onClick={() => toggleCheck(d.id)}
                          >
                            <Check style={{ width: 11, height: 11 }} />
                          </span>
                        )}
                      </td>
                      <td className="col-date">{fdate(d.date)}</td>
                      <td>
                        <div className="merchant">
                          <span className="m-av" style={{ background: av.c }}>{av.i}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="m-name">{d.m}</div>
                            <div className="m-sub">{d.acct}</div>
                          </div>
                        </div>
                      </td>
                      <td className="col-amt spent">
                        {d.spent ? <span>−${fmt(d.spent)}</span> : <span className="zero">—</span>}
                      </td>
                      <td className="col-amt recv">
                        {d.recv ? <span>+${fmt(d.recv)}</span> : <span className="zero">—</span>}
                      </td>
                      <td className="col-cat">
                        {d.st === 'review' && (
                          <button
                            className="cat-pick suggested"
                            onClick={(e) => openCatMenu(e, d.id)}
                          >
                            <Sparkles style={{ width: 13, height: 13 }} className="sug-ico" />
                            <span className="cat-dot" style={{ background: CATS[d.sug ?? ''] ?? '#9aa6b8' }} />
                            <span className="cat-txt">{d.sug}</span>
                            <span className="cat-chev"><ChevronDown style={{ width: 14, height: 14 }} /></span>
                          </button>
                        )}
                        {d.st === 'cat' && (
                          <button
                            className="cat-pick"
                            onClick={(e) => openCatMenu(e, d.id)}
                          >
                            <span className="cat-dot" style={{ background: CATS[d.cat ?? ''] ?? '#9aa6b8' }} />
                            <span className="cat-txt">{d.cat}</span>
                            <span className="cat-chev"><ChevronDown style={{ width: 14, height: 14 }} /></span>
                          </button>
                        )}
                        {d.st === 'excl' && (
                          <span className="tag-excluded">Excluded · {d.reason}</span>
                        )}
                      </td>
                      <td className="col-match">
                        {d.match ? (
                          <span className="match-chip">
                            <LinkIcon style={{ width: 12, height: 12 }} />
                            {d.match}
                          </span>
                        ) : (
                          <span className="match-none">—</span>
                        )}
                      </td>
                      <td className="col-act" style={{ textAlign: 'right' }}>
                        {d.st === 'review' && (
                          <button className="btn-accept" onClick={() => setState(d.id, 'cat')}>
                            <Check style={{ width: 13, height: 13 }} />Add
                          </button>
                        )}
                        {d.st === 'cat' && (
                          <span className="tag-done">
                            <CheckCircle2 style={{ width: 14, height: 14 }} />Added
                          </span>
                        )}
                        {d.st === 'excl' && (
                          <button
                            className="row-action"
                            title="Restore"
                            onClick={() => setState(d.id, 'review')}
                          >
                            <Undo2 style={{ width: 16, height: 16 }} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <div className="es-ico"><CheckCircle2 style={{ width: 40, height: 40 }} /></div>
              <div className="es-title">All caught up</div>
              <div className="es-sub">No transactions in this view.</div>
            </div>
          )}
        </div>

        {/* Right: reconciliation panel */}
        <aside className="recon-panel">
          <div className="card recon-card">
            <div className="recon-acct">
              <span className="ra-logo" style={{ background: selectedAcctInfo.logoColor }}>
                {selectedAcctInfo.logo}
              </span>
              <div>
                <div className="ra-name">{selectedAcctInfo.name}</div>
                <div className="ra-period">Reconciling · May 2026</div>
              </div>
            </div>

            <div className="recon-row">
              <span className="rl">Bank statement balance</span>
              <span className="rv">${fmt(bankBalance)}</span>
            </div>
            <div className="recon-row">
              <span className="rl">LedgerPro book balance</span>
              <span className="rv">${fmt(bookBalance)}</span>
            </div>
            <div className="recon-sep" />
            <div className={`recon-diff ${isZero ? 'zero' : 'nonzero'}`}>
              <span className="dl">{isZero ? 'Ready to reconcile' : 'Difference'}</span>
              <span className="dv">
                {!isZero && difference < 0 ? '−' : ''}{isZero ? '' : ''}${fmt(Math.abs(difference))}
              </span>
            </div>

            <div className="clear-grid">
              <div className="clear-box">
                <div className="cb-num">{clearedCount}</div>
                <div className="cb-lbl">
                  <span className="d" style={{ background: 'var(--success)' }} />Cleared
                </div>
              </div>
              <div className="clear-box">
                <div className="cb-num">{toReview.length}</div>
                <div className="cb-lbl">
                  <span className="d" style={{ background: 'var(--warning)' }} />Uncleared
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 16 }}
              disabled={!isZero}
            >
              {isZero ? (
                <><CheckCircle2 style={{ width: 15, height: 15 }} />Reconcile now</>
              ) : (
                <><Lock style={{ width: 15, height: 15 }} />Review {toReview.length} to reconcile</>
              )}
            </button>
            {!isZero && (
              <div className="t-caption" style={{ textAlign: 'center', marginTop: 10, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                Accept the remaining transactions to balance this account.
              </div>
            )}
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div className="section-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)', color: 'var(--text-muted)' }}>
              Statement
            </div>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>Ending balance</label>
              <div className="input-group">
                <span className="lead-sym" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}>$</span>
                <input
                  className="input has-sym money"
                  type="text"
                  value={stmtBalance}
                  onChange={(e) => setStmtBalance(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>Statement date</label>
              <input
                className="input"
                type="date"
                value={stmtDate}
                onChange={(e) => setStmtDate(e.target.value)}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* Category dropdown */}
      <CatMenu
        anchorEl={catAnchor}
        onSelect={handleCatSelect}
        onClose={() => { setCatAnchor(null); setCatTargetId(null) }}
      />

      {/* Import modal */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      {/* Toasts */}
      <ToastStack toasts={toasts} onRemove={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </>
  )
}
