'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { useRouter } from 'next/navigation';
import { Search, Upload, Download, Loader2, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';

interface COAEntry {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  detailType: string | null;
  parentCode: string | null;
  description: string | null;
  balance: number;
  active: boolean;
  financialAccounts: { id: string; name: string; currentBalance: number; kind: string }[];
}

interface Summary {
  assets: number;
  liabilities: number;
  equity: number;
  income: number;
  expenses: number;
}

const typeLabels: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
};

const typeColors: Record<string, string> = {
  asset: 'green', liability: 'amber', equity: 'blue', income: 'green', expense: 'red',
};

export default function ChartOfAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<COAEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({ assets: 0, liabilities: 0, equity: 0, income: 0, expenses: 0 });
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['asset', 'liability', 'equity', 'income', 'expense']));

  const fetchCOA = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/coa?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setAccounts(json.data);
      setSummary(json.summary);
      setTotalAccounts(json.totalAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setLoading(false); }
  }, [search, typeFilter]);

  useEffect(() => { fetchCOA(); }, [fetchCOA]);

  function toggleGroup(type: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  // Group by type
  const grouped: Record<string, COAEntry[]> = {};
  for (const acct of accounts) {
    if (!grouped[acct.type]) grouped[acct.type] = [];
    grouped[acct.type].push(acct);
  }

  const typeOrder = ['asset', 'liability', 'equity', 'income', 'expense'];

  const columns: Column<COAEntry>[] = [
    {
      key: 'code', header: 'Code', sortable: true,
      render: (row) => (
        <span className={cn('font-mono text-sm font-medium', row.parentCode && 'pl-6 text-[var(--text-muted)]')}>
          {row.code}
        </span>
      ),
    },
    {
      key: 'name', header: 'Account Name', sortable: true,
      render: (row) => (
        <div className={cn(row.parentCode && 'pl-6')}>
          <div className={cn('text-sm font-medium', row.parentCode ? 'text-[var(--text)]' : 'text-[var(--text-strong)]')}>
            {row.name}
          </div>
          {row.description && (
            <div className="text-xs text-[var(--text-muted)]">{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type', header: 'Type', sortable: true,
      render: (row) => (
        <Badge variant={typeColors[row.type] as any} dot={false}>{typeLabels[row.type]}</Badge>
      ),
    },
    {
      key: 'detailType', header: 'Detail Type', sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--text-muted)]">{row.detailType || '—'}</span>
      ),
    },
    {
      key: 'balance', header: 'Balance', type: 'num', sortable: true, align: 'right',
      render: (row) => {
        const bal = Number(row.balance);
        const isZero = bal === 0;
        const isNegative = bal < 0;
        return (
          <span className={cn(
            'font-mono tabular-nums text-sm font-semibold',
            isZero ? 'text-[var(--text-faint)]' : isNegative ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'
          )}>
            {money(bal)}
          </span>
        );
      },
    },
    {
      key: 'active', header: 'Status', sortable: true,
      render: (row) => (
        row.active ? <Badge variant="paid" dot={false}>Active</Badge> : <Badge variant="draft" dot={false}>Inactive</Badge>
      ),
    },
  ];

  if (loading) {
    return (
      <AppShell companyName="Northwind Trading" companyPlan="Business">
        <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="content-head">
        <div>
          <h1 className="greet">Chart of Accounts</h1>
          <p className="sub">The complete ledger structure for Northwind Trading — {totalAccounts} accounts.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary"><Upload size={16} /> Import</Button>
        <Button variant="secondary"><Download size={16} /> Export</Button>
        <Button><PlusIcon /> New Account</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4 mb-5">
        {typeOrder.map((type) => {
          const val = summary[type as keyof Summary];
          const colorMap: Record<string, { bg: string; text: string }> = {
            asset: { bg: 'bg-[var(--success-soft)]', text: 'text-[var(--success)]' },
            liability: { bg: 'bg-[var(--warning-soft)]', text: 'text-[var(--warning)]' },
            equity: { bg: 'bg-[var(--primary-soft)]', text: 'text-[var(--accent)]' },
            income: { bg: 'bg-[var(--success-soft)]', text: 'text-[var(--success)]' },
            expense: { bg: 'bg-[var(--danger-soft)]', text: 'text-[var(--danger)]' },
          };
          const cm = colorMap[type];
          return (
            <div key={type} className={cn('rounded-xl p-4 border border-[var(--border)] shadow-[var(--shadow-sm)]', cm.bg)}>
              <div className="text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">{typeLabels[type]}</div>
              <div className={cn('font-mono tabular-nums text-xl font-bold', cm.text)}>{money(val)}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {grouped[type]?.filter(a => !a.parentCode).length || 0} accounts
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input type="text" placeholder="Search by name, number, or details..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'asset', label: 'Assets' },
            { value: 'liability', label: 'Liabilities' },
            { value: 'equity', label: 'Equity' },
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Expenses' },
          ]}
          value={typeFilter} onChange={setTypeFilter}
        />
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {/* Grouped account list */}
      <div className="space-y-4">
        {typeOrder.map((type) => {
          const entries = grouped[type];
          if (!entries || entries.length === 0) return null;
          const isExpanded = expandedGroups.has(type);
          const typeTotal = summary[type as keyof Summary];
          const parentEntries = entries.filter(a => !a.parentCode);

          return (
            <div key={type} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
              <button
                onClick={() => toggleGroup(type)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors text-left"
              >
                {isExpanded ? <ChevronDown size={18} className="text-[var(--text-muted)]" /> : <ChevronRight size={18} className="text-[var(--text-muted)]" />}
                <span className="text-sm font-semibold text-[var(--text-strong)]">{typeLabels[type]}</span>
                <span className="text-xs text-[var(--text-muted)] font-mono">{parentEntries.length} accounts</span>
                <div className="flex-1" />
                <span className={cn(
                  'font-mono tabular-nums text-sm font-semibold',
                  typeTotal >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                )}>
                  {money(typeTotal)}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-[var(--border)]">
                  {parentEntries.map((parent) => (
                    <div key={parent.code}>
                      <div
                        onClick={() => router.push(`/reports/general-ledger?code=${parent.code}&name=${encodeURIComponent(parent.name)}`)}
                        className="flex items-center gap-4 px-5 py-2.5 bg-[var(--surface-2)] text-sm cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group"
                      >
                        <span className="font-mono text-[var(--text-muted)] w-[60px]">{parent.code}</span>
                        <span className="font-medium text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">{parent.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">{parent.detailType}</span>
                        <ExternalLink size={12} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 mr-1 transition-opacity" />
                        <span className={cn(
                          'font-mono tabular-nums text-sm font-semibold w-[120px] text-right',
                          Number(parent.balance) >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                        )}>
                          {money(Number(parent.balance))}
                        </span>
                      </div>
                      {entries
                        .filter(a => a.parentCode === parent.code)
                        .map((child) => (
                          <div
                            key={child.code}
                            onClick={() => router.push(`/reports/general-ledger?code=${child.code}&name=${encodeURIComponent(child.name)}`)}
                            className="flex items-center gap-4 px-5 py-2.5 border-t border-[var(--border)] hover:bg-[var(--primary-soft)] text-sm cursor-pointer group transition-colors"
                          >
                            <span className="font-mono text-[var(--text-faint)] w-[60px] pl-6">{child.code}</span>
                            <span className="text-[var(--text)] flex-1 group-hover:text-[var(--primary)] transition-colors">{child.name}</span>
                            <span className="text-xs text-[var(--text-muted)]">{child.detailType}</span>
                            <ExternalLink size={12} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 mr-1 transition-opacity" />
                            <span className={cn(
                              'font-mono tabular-nums text-sm font-semibold w-[120px] text-right',
                              Number(child.balance) >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                            )}>
                              {money(Number(child.balance))}
                            </span>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
