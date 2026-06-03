'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Landmark,
  BookOpen,
  BarChart3,
  Users,
  Settings,
  ChevronsUpDown,
  ChevronDown,
  Search,
  Calendar,
  Plus,
  Bell,
  Check,
  AlertCircle,
  CheckCircle2,
  Moon,
  Sun,
  User,
  Building2,
  CreditCard,
  LogOut,
  SlidersHorizontal,
  Settings2,
} from 'lucide-react'
import { useTheme, useDensity } from '@/components/providers/ThemeProvider'

interface NavItem {
  icon: React.ReactNode
  label: string
  href: string
  count?: number
}

const navItems: NavItem[] = [
  { icon: <LayoutDashboard />, label: 'Dashboard', href: '/' },
  { icon: <FileText />, label: 'Sales & Invoices', href: '/invoices', count: 7 },
  { icon: <Receipt />, label: 'Expenses', href: '/expenses' },
  { icon: <Landmark />, label: 'Banking', href: '/banking', count: 12 },
  { icon: <BookOpen />, label: 'Chart of Accounts', href: '/chart-of-accounts' },
  { icon: <BarChart3 />, label: 'Reports', href: '/reports' },
  { icon: <Users />, label: 'Contacts', href: '/contacts' },
]

function useDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [open])

  return { open, setOpen, ref }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const { density, setDensity } = useDensity()

  const orgMenu = useDropdown()
  const userRailMenu = useDropdown()
  const dateMenu = useDropdown()
  const notifMenu = useDropdown()
  const userMenu = useDropdown()

  const [dateLabel, setDateLabel] = useState('This month')

  const dateOptions = ['This month', 'Last month', 'This quarter', 'Year to date', 'Custom range…']

  return (
    <div className="app">
      {/* ======== LEFT RAIL ======== */}
      <aside className="rail">
        {/* Org switcher */}
        <div className="dd" ref={orgMenu.ref}>
          <button
            className="org-switch"
            onClick={(e) => { e.stopPropagation(); orgMenu.setOpen(!orgMenu.open) }}
            aria-haspopup="true"
          >
            <span className="org-tile">NT</span>
            <span className="org-meta">
              <span className="org-name">Northwind Trading</span>
              <span className="org-plan">Plus · FY 2026</span>
            </span>
            <span className="chev"><ChevronsUpDown /></span>
          </button>
          <div className={`menu left${orgMenu.open ? ' open' : ''}`} style={{ minWidth: '240px' }}>
            <div className="menu-label">Switch company</div>
            <div className="menu-org">
              <span className="mo-tile" style={{ background: 'linear-gradient(135deg,#3074ef,#1857c4)' }}>NT</span>
              <span className="mo-name">Northwind Trading</span>
              <span className="mo-check"><Check /></span>
            </div>
            <div className="menu-org">
              <span className="mo-tile" style={{ background: 'linear-gradient(135deg,#16a063,#0c7044)' }}>AL</span>
              <span className="mo-name">Atlas Logistics</span>
            </div>
            <div className="menu-org">
              <span className="mo-tile" style={{ background: 'linear-gradient(135deg,#b97c12,#92600d)' }}>BS</span>
              <span className="mo-name">Brightline Studio</span>
            </div>
            <div className="menu-sep" />
            <div className="menu-item"><Plus />Add a company</div>
            <div className="menu-item"><Settings2 />Manage companies</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="rail-nav">
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${isActive ? ' active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span className="count">{item.count}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="s-foot">
          <div className="nav-item">
            <Settings />
            <span>Settings</span>
          </div>
          <div className="dd" ref={userRailMenu.ref}>
            <div
              className="s-user"
              onClick={(e) => { e.stopPropagation(); userRailMenu.setOpen(!userRailMenu.open) }}
            >
              <span className="av">RA</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="un">Rosa Alvarez</div>
                <div className="ue">Owner · Admin</div>
              </div>
              <ChevronsUpDown style={{ width: '15px', color: 'var(--side-text-muted)' }} />
            </div>
            <div
              className={`menu left${userRailMenu.open ? ' open' : ''}`}
              style={{ bottom: 'calc(100% + 6px)', top: 'auto', minWidth: '210px' }}
            >
              <div className="menu-item"><User />My profile</div>
              <div className="menu-item"><Building2 />Company settings</div>
              <div className="menu-item"><CreditCard />Billing &amp; plan</div>
              <div className="menu-sep" />
              <div className="menu-item"><LogOut />Sign out</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ======== MAIN ======== */}
      <div className="main">
        {/* Top bar */}
        <header className="topbar">
          <div className="brandmark">
            <svg className="logo" viewBox="0 0 30 30" fill="none" style={{ width: '26px', height: '26px' }}>
              <rect width="30" height="30" rx="8" style={{ fill: 'var(--primary)' }} />
              <rect x="8" y="8.5" width="14" height="2.2" rx="1.1" fill="#fff" opacity="0.55" />
              <rect x="8" y="13.4" width="9.5" height="2.2" rx="1.1" fill="#fff" opacity="0.55" />
              <path d="M8 21.2l3.6-3.6 2.7 1.9 4.9-5.6" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="topbar-search">
            <span className="lead-icon"><Search /></span>
            <input type="text" placeholder="Search invoices, contacts, transactions…" />
            <span className="kbd">⌘K</span>
          </div>

          <div className="spacer" />

          <div className="topbar-actions">
            {/* Date range */}
            <div className="dd" ref={dateMenu.ref}>
              <button
                className="bar-btn"
                onClick={(e) => { e.stopPropagation(); dateMenu.setOpen(!dateMenu.open) }}
              >
                <Calendar /><span>{dateLabel}</span><ChevronDown />
              </button>
              <div className={`menu right${dateMenu.open ? ' open' : ''}`}>
                {dateOptions.map((opt) => (
                  <div
                    key={opt}
                    className={`menu-item${opt === dateLabel ? ' active' : ''}`}
                    onClick={() => { setDateLabel(opt); dateMenu.setOpen(false) }}
                  >
                    {opt === dateLabel ? <Check /> : <Calendar />}
                    {opt}
                  </div>
                ))}
                <div className="menu-sep" />
                <div
                  className="menu-item"
                  onClick={() => { setDateLabel('Custom range…'); dateMenu.setOpen(false) }}
                >
                  <SlidersHorizontal />Custom range…
                </div>
              </div>
            </div>

            <button className="btn btn-primary">
              <Plus />New
            </button>

            {/* Notifications */}
            <div className="dd" ref={notifMenu.ref}>
              <button
                className="iconbtn"
                onClick={(e) => { e.stopPropagation(); notifMenu.setOpen(!notifMenu.open) }}
                aria-label="Notifications"
              >
                <Bell />
                <span className="notif-dot" />
              </button>
              <div className={`menu right${notifMenu.open ? ' open' : ''}`} style={{ minWidth: '300px' }}>
                <div className="menu-label">Notifications</div>
                <div className="menu-item" style={{ alignItems: 'flex-start', gap: '9px' }}>
                  <AlertCircle style={{ color: 'var(--danger)' }} />
                  <div>
                    <div style={{ color: 'var(--text-strong)', fontWeight: 550 }}>Invoice INV-1042 is overdue</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Atlas Logistics · $12,450 · 14 days</div>
                  </div>
                </div>
                <div className="menu-item" style={{ alignItems: 'flex-start', gap: '9px' }}>
                  <Landmark style={{ color: 'var(--accent)' }} />
                  <div>
                    <div style={{ color: 'var(--text-strong)', fontWeight: 550 }}>12 transactions to reconcile</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chase Business ••4021</div>
                  </div>
                </div>
                <div className="menu-item" style={{ alignItems: 'flex-start', gap: '9px' }}>
                  <CheckCircle2 style={{ color: 'var(--success)' }} />
                  <div>
                    <div style={{ color: 'var(--text-strong)', fontWeight: 550 }}>Payment received</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vertex Partners · $23,110</div>
                  </div>
                </div>
              </div>
            </div>

            {/* User menu */}
            <div className="dd" ref={userMenu.ref}>
              <button
                className="bar-btn"
                onClick={(e) => { e.stopPropagation(); userMenu.setOpen(!userMenu.open) }}
                style={{ paddingLeft: '5px' }}
              >
                <span className="av">RA</span>
                <ChevronDown />
              </button>
              <div className={`menu right${userMenu.open ? ' open' : ''}`} style={{ minWidth: '220px' }}>
                <div style={{ padding: '8px 10px 10px' }}>
                  <div style={{ fontWeight: 650, color: 'var(--text-strong)', fontSize: 'var(--text-sm)' }}>Rosa Alvarez</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>rosa@northwind.co</div>
                </div>
                <div className="menu-sep" />
                <div className="menu-item"><User />My profile</div>
                <div className="menu-item"><Bell />Notification settings</div>
                <div
                  className="menu-item"
                  onClick={() => { toggleTheme(); userMenu.setOpen(false) }}
                >
                  {theme === 'dark' ? <Sun /> : <Moon />}Appearance
                </div>
                <div className="menu-sep" />
                <div className="menu-item"><LogOut />Sign out</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="content">
          {children}
        </div>
      </div>
    </div>
  )
}
