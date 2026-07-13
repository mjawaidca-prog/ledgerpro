'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/cn';
import { CompanySwitcher } from './CompanySwitcher';
import { signOut } from 'next-auth/react';
import { clearActiveCompanyCookies } from '@/lib/active-company-cookies';
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Building2,
  BookOpen,
  BarChart3, Scale,
  Users,
  LogOut,
  Settings,
  Shield,
  Briefcase,
  Target,
} from 'lucide-react';

interface RailProps {
  companyName: string;
  companyPlan: string;
  companyId: string | null;
  userName: string;
  userEmail: string;
  className?: string;
}

const mainNavItems = [
  { href: '/dashboard',     label: 'Dashboard',          icon: LayoutDashboard },
  { href: '/invoices',      label: 'Sales & Invoices',   icon: FileText },
  { href: '/expenses',      label: 'Expenses',           icon: Receipt },
  { href: '/banking',       label: 'Banking',            icon: Building2 },
  { href: '/journal',       label: 'Journal',            icon: FileText },
  { href: '/chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
  { href: '/reports',       label: 'Reports',            icon: BarChart3 },
  { href: '/budgets',       label: 'Budgets',            icon: Target },
  { href: '/contacts',      label: 'Contacts',           icon: Users },
];

const settingsNavItems = [
  { href: '/recurring',                label: 'Recurring',          icon: FileText },
  { href: '/settings/categorization',  label: 'Categorization',     icon: Shield },
  { href: '/settings',                 label: 'Company Settings',    icon: Settings },
  { href: '/settings/period-close',    label: 'Period Close',       icon: Shield },
  { href: '/settings/audit-log',       label: 'Audit Log',          icon: FileText },
];

export function Rail({ companyName, companyPlan, companyId, userName, userEmail, className }: RailProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const availableCompanies = (session?.user as any)?.availableCompanies || [];
  const isAccountant = availableCompanies.length > 1;

  function renderLink(item: { href: string; label: string; icon: any }) {
    const Icon = item.icon;
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link key={item.href} href={item.href} className={cn('nav-item', isActive && 'active')}>
        <Icon size={18} />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <aside className={cn('rail', className)}>
      <CompanySwitcher activeCompanyId={companyId} activeCompanyName={companyName} />

      <nav className="rail-nav">
        {mainNavItems.map(renderLink)}

        <div style={{ height: 1, background: 'var(--side-border)', margin: '6px 8px' }} />

        {/* Accountant — only visible for multi-company users */}
        {isAccountant && renderLink({ href: '/accountant', label: 'Accountant', icon: Briefcase })}

        {settingsNavItems.map(renderLink)}
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
          onClick={() => { clearActiveCompanyCookies(); signOut({ callbackUrl: '/login' }); }}
          className="nav-item"
          style={{ width: '100%', marginTop: 4 }}
        >
          <LogOut size={18} /> Sign Out
        </button>
      </div>
    </aside>
  );
}
