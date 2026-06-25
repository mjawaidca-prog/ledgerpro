'use client';

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import {
  TrendingUp, TrendingDown, FileText, BarChart3,
  ArrowRight, Receipt, Building2, Scale, BookOpen,
} from 'lucide-react';

const reports = [
  {
    title: 'Trial Balance',
    description: 'All GL accounts with debit and credit balances — the foundation of double-entry accounting.',
    href: '/reports/trial-balance',
    icon: Scale,
    color: 'bg-[var(--success-soft)] text-[var(--success)]',
  },
  {
    title: 'General Ledger',
    description: 'Full transaction history for any account with running balance and source links.',
    href: '/reports/general-ledger',
    icon: BookOpen,
    color: 'bg-[var(--primary-soft)] text-[var(--accent)]',
  },
  {
    title: 'Profit & Loss',
    description: 'Revenue, expenses, and net income over a period.',
    href: '/reports/profit-loss',
    icon: TrendingUp,
    color: 'bg-[var(--success-soft)] text-[var(--success)]',
  },
  {
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity at a point in time.',
    href: '/reports/balance-sheet',
    icon: Building2,
    color: 'bg-[var(--primary-soft)] text-[var(--accent)]',
  },
  {
    title: 'Cash Flow Statement',
    description: 'Operating, investing, and financing cash flows.',
    href: '/reports/cash-flow',
    icon: BarChart3,
    color: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    comingSoon: false,
  },
  {
    title: 'Accounts Receivable Aging',
    description: 'Outstanding invoices by age: current, 30, 60, 90+ days.',
    href: '/reports/ar-aging',
    icon: FileText,
    color: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    comingSoon: false,
  },
  {
    title: 'Accounts Payable Aging',
    description: 'Unpaid bills by age and vendor.',
    href: '/reports/ap-aging',
    icon: Receipt,
    color: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    comingSoon: false,
  },
  {
    title: 'Expense by Category',
    description: 'Breakdown of spending across GL expense accounts.',
    href: '/reports/expense-breakdown',
    icon: TrendingDown,
    color: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    comingSoon: false,
  },
];

export default function ReportsPage() {
  const router = useRouter();

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="content-head">
        <div>
          <h1 className="greet">Reports</h1>
          <p className="sub">Financial reports for Northwind Trading — fiscal year 2026.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <button
              key={report.href}
              onClick={() => !report.comingSoon && router.push(report.href)}
              disabled={report.comingSoon}
              className={cn(
                'text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6',
                'shadow-[var(--shadow-sm)] transition-all',
                !report.comingSoon && 'hover:shadow-[var(--shadow-md)] hover:border-[var(--border-strong)] cursor-pointer',
                report.comingSoon && 'opacity-60 cursor-not-allowed'
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn('w-[42px] h-[42px] rounded-xl grid place-items-center flex-none', report.color)}>
                  <Icon size={22} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--text-strong)]">
                      {report.title}
                    </h3>
                    {report.comingSoon && (
                      <span className="text-micro font-mono uppercase px-2 py-0.5 rounded-full bg-[var(--neutral-soft)] text-[var(--text-muted)]">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{report.description}</p>
                </div>
                {!report.comingSoon && (
                  <ArrowRight size={18} className="text-[var(--text-faint)] flex-none mt-2" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </AppShell>
  );
}
