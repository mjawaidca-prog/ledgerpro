'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { GlobalSearch } from './GlobalSearch';
import {
  Search,
  Moon,
  Sun,
  Bell,
  ChevronDown,
  Calendar,
} from 'lucide-react';

interface TopbarProps {
  theme: 'light' | 'dark';
  density: 'comfortable' | 'compact';
  onToggleTheme: () => void;
  onDensityChange: (d: 'comfortable' | 'compact') => void;
  userName: string;
  onNotificationsClick?: () => void;
  onMenuClick?: () => void;
}

export function Topbar({
  theme,
  density,
  onToggleTheme,
  onDensityChange,
  userName,
  onNotificationsClick,
  onMenuClick,
}: TopbarProps) {
  const [unreadCount, setUnreadCount] = useState(0);

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

      {/* User avatar */}
      <button className="bar-btn">
        <div className="av">{userName.charAt(0)}</div>
        <ChevronDown size={16} />
      </button>
    </header>
    <GlobalSearch />
    </>
  );
}
