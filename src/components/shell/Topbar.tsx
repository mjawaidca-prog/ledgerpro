'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { GlobalSearch } from './GlobalSearch';
import { signOut } from 'next-auth/react';
import { clearActiveCompanyCookies } from '@/lib/active-company-cookies';
import {
  Search,
  Moon,
  Sun,
  Bell,
  ChevronDown,
  Calendar,
  User,
  Settings,
  LogOut,
} from 'lucide-react';

interface TopbarProps {
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
  onToggleTheme: () => void;
  onDensityChange: (d: 'comfortable' | 'compact') => void;
  userName: string;
  userEmail?: string;
  onNotificationsClick?: () => void;
  onMenuClick?: () => void;
}

export function Topbar({
  theme,
  density,
  onToggleTheme,
  onDensityChange,
  userName,
  userEmail,
  onNotificationsClick,
  onMenuClick,
}: TopbarProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Poll for unread notification count
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/notifications?unread=true&limit=1');
        if (res.ok) {
          const json = await res.json();
          setUnreadCount(json.unreadCount || 0);
        }
      } catch {}
    }
    check();
    const interval = setInterval(check, 30000); // every 30s
    return () => clearInterval(interval);
  }, []);

  return (<>
    <header className="topbar">
      {/* Hamburger menu (mobile only) */}
      <button className="hamburger" onClick={onMenuClick} aria-label="Menu">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 5h12M3 9h12M3 13h12" />
        </svg>
      </button>

      {/* Search — click opens global search */}
      <div className="topbar-search" onClick={() => {
        (window as any).__openGlobalSearch?.();
      }} style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label="Open search">
        <span className="lead-icon">
          <Search size={16} />
        </span>
        <span className="text-[var(--text-faint)] text-sm flex-1">Search invoices, contacts, transactions...</span>
        <span className="kbd">⌘K</span>
      </div>

      <div className="spacer" />

      {/* Density toggle */}
      <Segmented
        options={[
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ]}
        value={density}
        onChange={(v) => onDensityChange(v as 'comfortable' | 'compact')}
      />

      {/* Theme toggle */}
      <button
        className="iconbtn"
        onClick={onToggleTheme}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* Notifications bell with live count */}
      <button
        className="iconbtn"
        aria-label="Notifications"
        onClick={onNotificationsClick}
        style={{ position: 'relative' }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -4,
            backgroundColor: 'var(--danger)', color: '#fff',
            fontSize: 9, fontWeight: 700, minWidth: 16, height: 16,
            borderRadius: 999, display: 'grid', placeItems: 'center',
            padding: '0 4px', lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* User avatar + dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          className="bar-btn"
          onClick={() => setUserMenuOpen(!userMenuOpen)}
        >
          <div className="av">{userName.charAt(0)}</div>
          <ChevronDown size={16} />
        </button>

        {userMenuOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => setUserMenuOpen(false)}
            />
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              minWidth: 220, zIndex: 50,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
              padding: 6, overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 12px 8px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)' }}>{userName}</div>
                {userEmail && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{userEmail}</div>}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <button
                onClick={() => { setUserMenuOpen(false); window.location.href = '/settings'; }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', border: 'none', background: 'transparent',
                  borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--text)',
                }}
              >
                <Settings size={16} /> Settings
              </button>
              <button
                onClick={() => { clearActiveCompanyCookies(); signOut({ callbackUrl: '/login' }); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', border: 'none', background: 'transparent',
                  borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--danger)',
                }}
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
    <GlobalSearch />
    </>
  );
}
