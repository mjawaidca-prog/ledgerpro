'use client';

import { cn } from '@/lib/cn';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
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
}

export function Topbar({
  theme,
  density,
  onToggleTheme,
  onDensityChange,
  userName,
}: TopbarProps) {
  return (
    <header className="topbar">
      {/* Search */}
      <div className="topbar-search">
        <span className="lead-icon">
          <Search size={16} />
        </span>
        <input
          type="text"
          placeholder="Search invoices, contacts, transactions..."
        />
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

      {/* Notifications */}
      <button className="iconbtn" aria-label="Notifications">
        <Bell size={18} />
        <span className="notif-dot" />
      </button>

      {/* Date range */}
      <button className="bar-btn">
        <Calendar size={16} />
        <span id="date-range-label">This year</span>
        <ChevronDown size={16} />
      </button>

      {/* User avatar */}
      <button className="bar-btn">
        <div className="av">{userName.charAt(0)}</div>
        <ChevronDown size={16} />
      </button>
    </header>
  );
}
