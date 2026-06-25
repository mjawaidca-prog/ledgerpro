'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, isPast } from 'date-fns';
import { Plus, Search, Upload, Download, Trash2, Receipt, FileText } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';

interface Bill {
  id: string;
  kind: 'bill' | 'expense';
  vendorId: string;
  vendor: { id: string; name: string; companyName: string | null };
  billDate: string;
  dueDate: string | null;
  referenceNo: string | null;
  total: number;
  status: 'draft' | 'open' | 'paid' | 'overdue' | 'void';
  lineItems: { id: string; description: string; amount: number; categoryId: string | null }[];
  paymentAccount: { id: string; name: string; mask: string | null } | null;
}

const statusLabels: Record<string, string> = {
  draft: 'Draft', open: 'Open', paid: 'Paid', overdue: 'Overdue', void: 'Void',
};

export default function ExpensesPage() {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchBills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (kindFilter !== 'all') params.set('kind', kindFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/bills?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load expenses');
      const json = await res.json();
      setBills(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [search, kindFilter, statusFilter]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this record?')) return;
    try {
      await fetch(`/api/bills/${id}`, { method: 'DELETE' });
      fetchBills();
    } catch { /* ignore */ }
  }

  async function handleMarkPaid(id: string) {
    try {
      await fetch(`/api/bills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', paidAt: new Date().toISOString() }),
      });
      fetchBills();
    } catch { /* ignore */ }
  }

  const columns: Column<Bill>[] = [
    {
      key: 'id',
      header: 'Ref',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-strong)] font-medium">{row.id}</span>
      ),
    },
    {
      key: 'kind',
      header: 'Type',
      sortable: true,
      render: (row) => (
        <Badge variant={row.kind === 'bill' ? 'pending' : 'info'}>
          {row.kind === 'bill' ? 'Bill' : 'Expense'}
        </Badge>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor / Payee',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-[10px]">
          <div
            className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-bold text-white flex-none"
            style={{ background: '#7c3aed' }}
          >
            {row.vendor.name.charAt(0)}
          </div>
          <div>
            <div className="text-sm text-[var(--text-strong)] font-medium">
              {row.vendor.companyName || row.vendor.name}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'referenceNo',
      header: 'Reference',
      sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--text-muted)]">{row.referenceNo || '—'}</span>
      ),
    },
    {
      key: 'billDate',
      header: 'Date',
      type: 'date',
      sortable: true,
      render: (row) => (
        <span className="text-sm">{format(new Date(row.billDate), 'MMM d, yyyy')}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      type: 'date',
      sortable: true,
      render: (row) => {
        if (!row.dueDate) return <span className="text-[var(--text-faint)]">—</span>;
        const date = new Date(row.dueDate);
        const late = row.status !== 'paid' && row.status !== 'void' && isPast(date);
        return (
          <span className={cn('text-sm', late && 'text-[var(--danger)] font-medium')}>
            {format(date, 'MMM d, yyyy')}
          </span>
        );
      },
    },
    {
      key: 'total',
      header: 'Amount',
      type: 'num',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className={cn(
          'font-mono tabular-nums text-sm font-semibold',
          row.status === 'overdue' ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'
        )}>
          {money(row.total)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => {
        const variant = row.status === 'paid' ? 'paid' as const
          : row.status === 'overdue' ? 'overdue' as const
          : row.status === 'draft' ? 'draft' as const
          : row.status === 'void' ? 'draft' as const
          : 'pending' as const;
        return <Badge variant={variant}>{statusLabels[row.status]}</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-[120px]',
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.status !== 'paid' && row.status !== 'void' && (
            <Button variant="ghost" size="sm" onClick={() => handleMarkPaid(row.id)}>
              Pay
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.id)}
            className="text-[var(--danger)]">
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const totals = bills.reduce((acc, b) => {
    if (b.status === 'paid') acc.paid += b.total;
    else if (b.status === 'overdue') acc.overdue += b.total;
    else if (b.status === 'open') acc.open += b.total;
    else if (b.status === 'draft') acc.drafts += 1;
    return acc;
  }, { paid: 0, overdue: 0, open: 0, drafts: 0 });

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="content-head">
        <div>
          <h1 className="greet">Expenses</h1>
          <p className="sub">Bills, expenses, and accounts payable.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary"><Upload size={16} /> Import</Button>
        <Button variant="secondary"><Download size={16} /> Export</Button>
        <Button onClick={() => router.push('/expenses/new?kind=expense')}>
          <Plus size={16} /> New Expense
        </Button>
        <Button onClick={() => router.push('/expenses/new?kind=bill')}>
          <Plus size={16} /> Enter Bill
        </Button>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Open', value: money(totals.open), color: 'text-[var(--warning)]' },
          { label: 'Overdue', value: money(totals.overdue), color: 'text-[var(--danger)]' },
          { label: 'Paid', value: money(totals.paid), color: 'text-[var(--success)]' },
          { label: 'Drafts', value: String(totals.drafts), color: 'text-[var(--text-muted)]' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 shadow-[var(--shadow-sm)]">
            <div className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">{kpi.label}</div>
            <div className={cn('font-mono tabular-nums text-xl font-semibold', kpi.color)}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none grid">
            <Search size={16} />
          </span>
          <input type="text" placeholder="Search by vendor, reference..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>
        <Segmented
          options={[{ value: 'all', label: 'All' }, { value: 'bill', label: 'Bills' }, { value: 'expense', label: 'Expenses' }]}
          value={kindFilter} onChange={setKindFilter}
        />
        <Segmented
          options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' }, { value: 'draft', label: 'Drafts' }]}
          value={statusFilter} onChange={setStatusFilter}
        />
        <div className="flex-1" />
        <span className="text-sm text-[var(--text-muted)]">{bills.length} record{bills.length !== 1 ? 's' : ''}</span>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <DataTable
        columns={columns} data={bills} rowKey={(row) => row.id}
        emptyMessage={loading ? 'Loading...' : 'No expenses found.'}
        onRowClick={(row) => router.push(`/expenses/${row.id}`)}
      />
    </AppShell>
  );
}
