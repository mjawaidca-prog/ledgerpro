'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Building2,
  BookOpen,
  BarChart3,
  Users,
  ChevronDown,
} from 'lucide-react';

interface RailProps {
  companyName: string;
  companyPlan: string;
  userName: string;
  userEmail: string;
}

const navItems = [
  { href: '/',              label: 'Dashboard',          icon: LayoutDashboard },
  { href: '/invoices',      label: 'Sales & Invoices',   icon: FileText },
  { href: '/expenses',      label: 'Expenses',           icon: Receipt },
  { href: '/banking',       label: 'Banking',            icon: Building2 },
  { href: '/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
  { href: '/reports',       label: 'Reports',            icon: BarChart3 },
  { href: '/contacts',      label: 'Contacts',           icon: Users },
];

export function Rail({ companyName, companyPlan, userName, userEmail }: RailProps) {
  const pathname = usePathname();

  return (
    <aside className="rail">
      {/* Org switcher */}
      <button className="org-switch">
        <div className="org-tile">N</div>
        <div className="org-meta">
          <span className="org-name">{companyName}</span>
          <span className="org-plan">{companyPlan}</span>
        </div>
        <span className="chev">
          <ChevronDown size={16} />
        </span>
      </button>

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
          <div className="av">{userName.charAt(0)}</div>
          <div>
            <div className="un">{userName}</div>
            <div className="ue">{userEmail}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
