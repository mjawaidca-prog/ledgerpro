'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Search,
  History,
  TrendingUp,
  Hourglass,
  Scale,
  ArrowLeftRight,
  ListChecks,
  Clock,
  Users,
  Percent,
  FileText,
  ArrowUpRight,
  Star,
} from 'lucide-react'

const REPORTS = [
  { id: 'pnl',  title: 'Profit & Loss',        desc: 'Revenue minus expenses over a period.',                ic: 'trending-up',    color: 'blue',  cat: 'Financial',               href: '/reports/pnl' },
  { id: 'bs',   title: 'Balance Sheet',         desc: 'Assets, liabilities, and equity at a point in time.', ic: 'scale',          color: 'blue',  cat: 'Financial',               href: '#' },
  { id: 'cf',   title: 'Cash Flow Statement',   desc: 'Cash moving in and out, by activity.',                ic: 'arrow-left-right', color: 'blue', cat: 'Financial',              href: '#' },
  { id: 'tb',   title: 'Trial Balance',         desc: "Every ledger account's debit and credit balance.",    ic: 'list-checks',    color: 'blue',  cat: 'Financial',               href: '#' },
  { id: 'ar',   title: 'Aged Receivables',      desc: 'Outstanding customer invoices, grouped by age.',      ic: 'hourglass',      color: 'amber', cat: 'Receivables & Payables',  href: '#' },
  { id: 'ap',   title: 'Aged Payables',         desc: 'What you owe vendors, grouped by age.',               ic: 'clock',          color: 'red',   cat: 'Receivables & Payables',  href: '#' },
  { id: 'cb',   title: 'Customer Balances',     desc: 'Open balance and credit for each customer.',          ic: 'users',          color: 'green', cat: 'Receivables & Payables',  href: '#' },
  { id: 'tax',  title: 'Sales Tax Summary',     desc: 'Tax collected and owed, by jurisdiction.',            ic: 'percent',        color: 'gray',  cat: 'Taxes',                   href: '#' },
  { id: '1099', title: '1099 Summary',          desc: 'Contractor payments prepared for 1099 filing.',       ic: 'file-text',      color: 'gray',  cat: 'Taxes',                   href: '#' },
]

const CATS = ['Financial', 'Receivables & Payables', 'Taxes']

const ICON_MAP: Record<string, React.ReactNode> = {
  'trending-up':    <TrendingUp />,
  'scale':          <Scale />,
  'arrow-left-right': <ArrowLeftRight />,
  'list-checks':    <ListChecks />,
  'hourglass':      <Hourglass />,
  'clock':          <Clock />,
  'users':          <Users />,
  'percent':        <Percent />,
  'file-text':      <FileText />,
}

export function ReportsContent() {
  const [search, setSearch] = useState('')
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['pnl', 'ar']))

  function toggleFav(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const q = search.trim().toLowerCase()

  function matchesSearch(r: (typeof REPORTS)[0]) {
    return !q || (r.title + ' ' + r.desc).toLowerCase().includes(q)
  }

  const favReports = useMemo(() => REPORTS.filter((r) => favorites.has(r.id) && matchesSearch(r)), [favorites, q])
  const catReports = useMemo(() => {
    return CATS.map((cat) => ({
      cat,
      reports: REPORTS.filter((r) => r.cat === cat && matchesSearch(r)),
    }))
  }, [q])

  const anyVisible = favReports.length > 0 || catReports.some((c) => c.reports.length > 0)

  function ReportCard({ r }: { r: (typeof REPORTS)[0] }) {
    const isFav = favorites.has(r.id)
    const card = (
      <a
        className="rep-card"
        href={r.href}
        onClick={r.href === '#' ? (e) => e.preventDefault() : undefined}
      >
        <span className={`rep-ico ${r.color}`}>{ICON_MAP[r.ic]}</span>
        <div className="rep-body">
          <div className="rep-title">{r.title}</div>
          <div className="rep-desc">{r.desc}</div>
        </div>
        <button
          className={`rep-star${isFav ? ' on' : ''}`}
          aria-label="Favorite"
          title="Favorite"
          onClick={(e) => toggleFav(r.id, e)}
        >
          <Star />
        </button>
      </a>
    )

    if (r.href !== '#') {
      return <Link href={r.href} className="rep-card" style={{ textDecoration: 'none' }}>
        <span className={`rep-ico ${r.color}`}>{ICON_MAP[r.ic]}</span>
        <div className="rep-body">
          <div className="rep-title">{r.title}</div>
          <div className="rep-desc">{r.desc}</div>
        </div>
        <button
          className={`rep-star${isFav ? ' on' : ''}`}
          aria-label="Favorite"
          title="Favorite"
          onClick={(e) => toggleFav(r.id, e)}
        >
          <Star />
        </button>
      </Link>
    }
    return card
  }

  return (
    <>
      {/* PAGE HEADER */}
      <div className="page-head">
        <div>
          <h1 className="greet">Reports</h1>
          <div className="sub">Run, customize, and export financial reports for Northwind Trading</div>
        </div>
        <div className="spacer" />
      </div>

      {/* SEARCH */}
      <div className="rep-search">
        <div className="input-group">
          <span className="lead-icon"><Search /></span>
          <input
            className="input"
            type="text"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* RECENTLY VIEWED */}
      {!q && (
        <div className="rep-section">
          <div className="rep-section-head">
            <History style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
            <span className="rs-label">Recently viewed</span>
            <span className="rs-line" />
          </div>
          <div className="recent-row">
            <Link href="/reports/pnl" className="recent-card" style={{ textDecoration: 'none' }}>
              <span className="rc-ico" style={{ background: 'var(--primary-soft)', color: 'var(--accent)' }}>
                <TrendingUp />
              </span>
              <div>
                <div className="rc-title">Profit &amp; Loss</div>
                <div className="rc-meta">Viewed 2h ago</div>
              </div>
              <span className="rc-go"><ArrowUpRight /></span>
            </Link>
            <a href="#" className="recent-card" onClick={(e) => e.preventDefault()} style={{ textDecoration: 'none' }}>
              <span className="rc-ico" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                <Hourglass />
              </span>
              <div>
                <div className="rc-title">Aged Receivables</div>
                <div className="rc-meta">Viewed yesterday</div>
              </div>
              <span className="rc-go"><ArrowUpRight /></span>
            </a>
            <a href="#" className="recent-card" onClick={(e) => e.preventDefault()} style={{ textDecoration: 'none' }}>
              <span className="rc-ico" style={{ background: 'var(--primary-soft)', color: 'var(--accent)' }}>
                <Scale />
              </span>
              <div>
                <div className="rc-title">Balance Sheet</div>
                <div className="rc-meta">Viewed Apr 30</div>
              </div>
              <span className="rc-go"><ArrowUpRight /></span>
            </a>
          </div>
        </div>
      )}

      {/* FAVORITES */}
      {favReports.length > 0 && (
        <div className="rep-section" data-section="favorites">
          <div className="rep-section-head">
            <Star style={{ width: 14, height: 14, color: 'var(--amber-500)' }} />
            <span className="rs-label">Favorites</span>
            <span className="rs-count">{favReports.length}</span>
            <span className="rs-line" />
          </div>
          <div className="rep-grid">
            {favReports.map((r) => <ReportCard key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {/* CATEGORIES */}
      {catReports.map(({ cat, reports }) =>
        reports.length > 0 ? (
          <div key={cat} className="rep-section" data-section={cat}>
            <div className="rep-section-head">
              <span className="rs-label">{cat}</span>
              <span className="rs-count">{reports.length}</span>
              <span className="rs-line" />
            </div>
            <div className="rep-grid">
              {reports.map((r) => <ReportCard key={r.id} r={r} />)}
            </div>
          </div>
        ) : null
      )}

      {/* EMPTY */}
      {!anyVisible && (
        <div className="rep-empty" style={{ display: 'block' }}>
          <div className="re-ico"><FileText style={{ width: 34, height: 34 }} /></div>
          <div className="re-title">No reports found</div>
          <div className="t-caption">Try a different search term.</div>
        </div>
      )}
    </>
  )
}
