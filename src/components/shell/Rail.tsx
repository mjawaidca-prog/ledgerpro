'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { CompanySwitcher } from './CompanySwitcher';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Building2,
  BookOpen,
  BarChart3, Scale,
  Users,
  LogOut,
} from 'lucide-react';

interface RailProps {
  companyName: string;
  companyPlan: string;
  companyId: string | null;
  userName: string;
  userEmail: string;
}

const navItems = [
  { href: '/',              label: 'Dashboard',          icon: LayoutDashboard },
  { href: '/invoices',      label: 'Sales & Invoices',   icon: FileText },
  { href: '/expenses',      label: 'Expenses',           icon: Receipt },
  { href: '/banking',       label: 'Banking',            icon: Building2 },
  { href: '/journal',       label: 'Journal',            icon: FileText },
  { href: '/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
  { href: '/reports/trial-balance', label: 'Trial Balance', icon: Scale },
  { href: '/reports',       label: 'Reports',            icon: BarChart3 },
  { href: '/contacts',      label: 'Contacts',           icon: Users },
];

export function Rail({ companyName, companyPlan, companyId, userName, userEmail }: RailProps) {
  const pathname = usePathname();

  return (
    <aside className="rail">
      {/* Org switcher */}
      <CompanySwitcher
        activeCompanyId={companyId}
        activeCompanyName={companyName}
      />

      {/* Navigation */}
      <nav className="rail-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn('nav-item', isActive && 'active')}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="s-foot">
        <div className="s-user">
          <div className="av">{userName?.charAt(0) || '?'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="un">{userName}</div>
            <div className="ue">{userEmail}</div>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="nav-item"
          style={{ width: '100%', marginTop: 4 }}
        >
          <LogOut size={18} /> Sign Out
        </button>
      </div>
    </aside>
  );
}
