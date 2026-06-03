'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronRight,
  Calendar,
  ChevronDown,
  GitCompare,
  Download,
  Printer,
  Check,
  Minus,
  CalendarClock,
  SlidersHorizontal,
  Sheet,
  FileSpreadsheet,
  FileText as FileTextIcon,
} from 'lucide-react'

// ── Data ──────────────────────────────────────────────────────────────────────

const MODEL = [
  {
    key: 'income', title: 'Income', income: true,
    rows: [
      ['Product sales',   248900, 214300],
      ['Service revenue', 162400, 138900],
      ['Other income',      8150,   9800],
    ] as [string, number, number][],
    totalLabel: 'Total income',
  },
  {
    key: 'cogs', title: 'Cost of goods sold', income: false,
    rows: [
      ['Materials & supplies', 78200, 71400],
      ['Subcontractors',       41600, 38200],
      ['Shipping & freight',   12300, 10900],
    ] as [string, number, number][],
    totalLabel: 'Total cost of goods sold',
  },
  { key: 'gross', computed: 'gross', income: true, label: 'Gross profit' },
  {
    key: 'opex', title: 'Operating expenses', income: false,
    rows: [
      ['Payroll & wages',           138400, 121900],
      ['Rent & lease',               42500,  42500],
      ['Software & subscriptions',   18900,  15200],
      ['Advertising & marketing',    24600,  19800],
      ['Travel & meals',              9840,  12400],
      ['Utilities',                   6420,   6100],
      ['Insurance',                   7200,   6800],
      ['Office supplies',             3180,   3560],
    ] as [string, number, number][],
    totalLabel: 'Total operating expenses',
  },
  { key: 'netop', computed: 'netop', income: true, label: 'Net operating income' },
  {
    key: 'other', title: 'Other expenses', income: false,
    rows: [
      ['Interest expense', 2180, 2640],
    ] as [string, number, number][],
    totalLabel: 'Total other expenses',
  },
  { key: 'net', computed: 'net', income: true, label: 'Net income' },
]

type CompareMode = 'pp' | 'py' | 'none'

function fmt(n: number) {
  return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtNum(n: number) {
  return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function cmpVal(cur: number, pp: number, mode: CompareMode) {
  return mode === 'py' ? Math.round(pp * 0.9) : pp
}

function sums(section: { rows: [string, number, number][] }, mode: CompareMode) {
  let cur = 0, cmp = 0
  for (const r of section.rows) {
    cur += r[1]
    cmp += cmpVal(r[1], r[2], mode)
  }
  return { cur, cmp }
}

function compute(mode: CompareMode) {
  const inc = sums(MODEL[0] as { rows: [string, number, number][] }, mode)
  const cogs = sums(MODEL[1] as { rows: [string, number, number][] }, mode)
  const opex = sums(MODEL[3] as { rows: [string, number, number][] }, mode)
  const other = sums(MODEL[5] as { rows: [string, number, number][] }, mode)
  return {
    income: inc, cogs, opex, other,
    gross: { cur: inc.cur - cogs.cur, cmp: inc.cmp - cogs.cmp },
    netop: { cur: inc.cur - cogs.cur - opex.cur, cmp: inc.cmp - cogs.cmp - opex.cmp },
    net: { cur: inc.cur - cogs.cur - opex.cur - other.cur, cmp: inc.cmp - cogs.cmp - opex.cmp - other.cmp },
  }
}

function PctBadge({ cur, cmp, incomeLike, mode }: { cur: number; cmp: number; incomeLike: boolean; mode: CompareMode }) {
  if (mode === 'none') return null
  if (!cmp) return <td className="num col-pct"><span className="pct flat">—</span></td>
  const change = cur - cmp
  const pct = (change / Math.abs(cmp)) * 100
  const favorable = incomeLike ? change > 0 : change < 0
  const cls = Math.abs(pct) < 0.05 ? 'flat' : favorable ? 'up' : 'down'
  const arrow = Math.abs(pct) < 0.05 ? '' : change > 0 ? '▲ ' : '▼ '
  return (
    <td className="num col-pct">
      <span className={`pct ${cls}`}>{arrow}{Math.abs(pct).toFixed(1)}%</span>
    </td>
  )
}

function CmpCell({ cmp, mode }: { cmp: number; mode: CompareMode }) {
  if (mode === 'none') return null
  return <td className="num col-cmp">{fmtNum(cmp)}</td>
}

const RANGES = [
  { short: 'May 2026',          long: 'May 1 – May 31, 2026',          label: 'This month' },
  { short: 'Q2 2026',           long: 'April 1 – June 30, 2026',        label: 'This quarter' },
  { short: 'Jan 1 – May 31, 2026', long: 'January 1 – May 31, 2026',   label: 'Year to date' },
  { short: 'FY 2025',           long: 'January 1 – December 31, 2025',  label: 'Last fiscal year' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function PnlContent() {
  const [compareMode, setCompareMode] = useState<CompareMode>('pp')
  const [rangeIdx, setRangeIdx] = useState(2) // Year to date
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false)
  const [cmpMenuOpen, setCmpMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const rangeMenuRef = useRef<HTMLDivElement>(null)
  const cmpMenuRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (rangeMenuRef.current && !rangeMenuRef.current.contains(e.target as Node)) setRangeMenuOpen(false)
      if (cmpMenuRef.current && !cmpMenuRef.current.contains(e.target as Node)) setCmpMenuOpen(false)
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  const C = compute(compareMode)
  const noCompare = compareMode === 'none'
  const cmpThLabel = compareMode === 'py' ? 'Jan–May 2025' : 'Prior period'

  return (
    <>
      {/* BREADCRUMB */}
      <div className="breadcrumb">
        <Link href="/reports" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', textDecoration: 'none' }}>
          <ArrowLeft />Reports
        </Link>
        <ChevronRight />
        <span className="cur">Profit &amp; Loss</span>
      </div>

      {/* TOOLBAR */}
      <div className="report-toolbar">
        <div className="rt-left">
          {/* Date range */}
          <div className="dd" ref={rangeMenuRef}>
            <button className="bar-btn" onClick={() => { setRangeMenuOpen((o) => !o); setCmpMenuOpen(false); setExportMenuOpen(false) }}>
              <Calendar /><span>{RANGES[rangeIdx].short}</span><ChevronDown />
            </button>
            {rangeMenuOpen && (
              <div className="menu left open" style={{ minWidth: 230 }}>
                {RANGES.map((r, i) => (
                  <div
                    key={r.short}
                    className={`menu-item${rangeIdx === i ? ' active' : ''}`}
                    onClick={() => { setRangeIdx(i); setRangeMenuOpen(false) }}
                  >
                    {rangeIdx === i ? <Check /> : <Calendar />}
                    {r.label}
                  </div>
                ))}
                <div className="menu-sep" />
                <div className="menu-item" onClick={() => setRangeMenuOpen(false)}>
                  <SlidersHorizontal />Custom range…
                </div>
              </div>
            )}
          </div>

          {/* Compare mode */}
          <div className="dd" ref={cmpMenuRef}>
            <button className="bar-btn" onClick={() => { setCmpMenuOpen((o) => !o); setRangeMenuOpen(false); setExportMenuOpen(false) }}>
              <GitCompare />
              <span>
                {compareMode === 'pp' ? 'vs. prior period' : compareMode === 'py' ? 'vs. prior year' : 'No comparison'}
              </span>
              <ChevronDown />
            </button>
            {cmpMenuOpen && (
              <div className="menu left open" style={{ minWidth: 210 }}>
                <div className={`menu-item${compareMode === 'pp' ? ' active' : ''}`} onClick={() => { setCompareMode('pp'); setCmpMenuOpen(false) }}>
                  {compareMode === 'pp' ? <Check /> : <Minus />}Prior period
                </div>
                <div className={`menu-item${compareMode === 'py' ? ' active' : ''}`} onClick={() => { setCompareMode('py'); setCmpMenuOpen(false) }}>
                  {compareMode === 'py' ? <Check /> : <CalendarClock />}Prior year
                </div>
                <div className={`menu-item${compareMode === 'none' ? ' active' : ''}`} onClick={() => { setCompareMode('none'); setCmpMenuOpen(false) }}>
                  {compareMode === 'none' ? <Check /> : <Minus />}No comparison
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="spacer" />

        <div className="rt-actions">
          {/* Export */}
          <div className="dd" ref={exportMenuRef}>
            <button className="btn btn-secondary" onClick={() => { setExportMenuOpen((o) => !o); setRangeMenuOpen(false); setCmpMenuOpen(false) }}>
              <Download />Export<ChevronDown />
            </button>
            {exportMenuOpen && (
              <div className="menu right open" style={{ minWidth: 180 }}>
                <div className="menu-item" onClick={() => { window.print(); setExportMenuOpen(false) }}>
                  <FileTextIcon />Export as PDF
                </div>
                <div className="menu-item" onClick={() => setExportMenuOpen(false)}>
                  <Sheet />Export as Excel
                </div>
                <div className="menu-item" onClick={() => setExportMenuOpen(false)}>
                  <FileSpreadsheet />Export as CSV
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            <Printer />Print
          </button>
        </div>
      </div>

      {/* REPORT DOCUMENT */}
      <div className={`report-doc${noCompare ? ' no-compare' : ''}`}>
        {/* Header */}
        <div className="doc-head">
          <div className="dh-logo">
            <svg className="logo" viewBox="0 0 30 30" fill="none" style={{ width: 24, height: 24 }}>
              <rect width="30" height="30" rx="8" style={{ fill: 'var(--primary)' }} />
              <rect x="8" y="8.5" width="14" height="2.2" rx="1.1" fill="#fff" opacity="0.55" />
              <rect x="8" y="13.4" width="9.5" height="2.2" rx="1.1" fill="#fff" opacity="0.55" />
              <path d="M8 21.2l3.6-3.6 2.7 1.9 4.9-5.6" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="nm">LedgerPro</span>
          </div>
          <div className="dh-company">Northwind Trading Co.</div>
          <div className="dh-title">Profit &amp; Loss Statement</div>
          <div className="dh-range">For the period {RANGES[rangeIdx].long}</div>
          <div className="dh-basis">Accrual basis · USD · Generated Jun 2, 2026</div>
        </div>

        <table className="pnl">
          <colgroup>
            <col className="c-acct" />
            <col className="c-amt" />
            <col className={`c-amt c-cmp${noCompare ? '' : ''}`} />
            <col className="c-pct" />
          </colgroup>
          <thead>
            <tr>
              <th className="acct">Account</th>
              <th className="num">Jan–May 2026</th>
              <th className="num col-cmp">{cmpThLabel}</th>
              <th className="num col-pct">% change</th>
            </tr>
          </thead>
          <tbody>
            {MODEL.map((s) => {
              // Computed rows (Gross profit, Net operating income, Net income)
              if ('computed' in s && s.computed) {
                const key = s.computed as 'gross' | 'netop' | 'net'
                const v = C[key]
                const rowCls = key === 'net' ? 'net' : 'total'
                const incomeRef = C.income.cur
                const marginNote = (key === 'gross' || key === 'net')
                  ? <div className="row-note">{((v.cur / incomeRef) * 100).toFixed(1)}% {key === 'gross' ? 'margin' : 'net margin'}</div>
                  : null

                return (
                  <React.Fragment key={s.key}>
                    <tr className={rowCls}>
                      <td className="acct">{s.label}{marginNote}</td>
                      <td className="num">{fmt(v.cur)}</td>
                      <CmpCell cmp={v.cmp} mode={compareMode} />
                      <PctBadge cur={v.cur} cmp={v.cmp} incomeLike={s.income} mode={compareMode} />
                    </tr>
                    {key !== 'net' && <tr className="spacer"><td colSpan={4} /></tr>}
                  </React.Fragment>
                )
              }

              // Section rows
              const sec = s as { key: string; title: string; income: boolean; rows: [string, number, number][]; totalLabel: string }
              const t = sums(sec, compareMode)
              return (
                <React.Fragment key={sec.key}>
                  <tr className="sec-head">
                    <td className="acct">{sec.title}</td>
                    <td className="num" />
                    {!noCompare && <><td className="num col-cmp" /><td className="num col-pct" /></>}
                  </tr>
                  {sec.rows.map((r, i) => {
                    const cmp = cmpVal(r[1], r[2], compareMode)
                    return (
                      <tr key={`${sec.key}-${i}`} className="line">
                        <td className="acct">{r[0]}</td>
                        <td className="num">{i === 0 ? fmt(r[1]) : fmtNum(r[1])}</td>
                        <CmpCell cmp={cmp} mode={compareMode} />
                        <PctBadge cur={r[1]} cmp={cmp} incomeLike={sec.income} mode={compareMode} />
                      </tr>
                    )
                  })}
                  <tr className="subtotal">
                    <td className="acct">{sec.totalLabel}</td>
                    <td className="num">{fmt(t.cur)}</td>
                    <CmpCell cmp={t.cmp} mode={compareMode} />
                    <PctBadge cur={t.cur} cmp={t.cmp} incomeLike={sec.income} mode={compareMode} />
                  </tr>
                  <tr className="spacer"><td colSpan={4} /></tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        <div className="doc-foot">
          <span>Northwind Trading Co. · Profit &amp; Loss</span>
          <span>Page 1 of 1 · Confidential</span>
        </div>
      </div>
    </>
  )
}
