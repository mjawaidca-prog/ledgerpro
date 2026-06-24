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
import { Plus, Search, Upload, Download, ArrowUpRight, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Column } from '@/components/ui/DataTable';

interface Invoice {
  id: string;
  customerId: string;
  customer: { id: string; name: string; companyName: string | null };
  issueDate: string;
  dueDate: string;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
  agingDays: number;
  lineItems: { id: string; description: string; amount: number }[];
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/invoices?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load invoices');
      const json = await res.json();
      setInvoices(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this invoice?')) return;
    try {
      await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
      fetchInvoices();
    } catch {
      // ignore
    }
  }

  async function handleMarkPaid(id: string) {
    try {
      await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', paidAt: new Date().toISOString() }),
      });
      fetchInvoices();
    } catch {
      // ignore
    }
  }

  const columns: Column<Invoice>[] = [
    {
      key: 'id',
      header: 'Invoice',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-sm text-[var(--text-strong)] font-medium">
          {row.id}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-[10px]">
          <div
            className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-bold text-white flex-none"
            style={{ background: '#1f6feb' }}
          >
            {row.customer.name.charAt(0)}
          </div>
          <div>
            <div className="text-sm text-[var(--text-strong)] font-medium">
              {row.customer.companyName || row.customer.name}
            </div>
            <div className="text-xs text-[var(--text-muted)]">{row.customer.name}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'issueDate',
      header: 'Issued',
      type: 'date',
      sortable: true,
      render: (row) => (
        <span className="text-sm">{format(new Date(row.issueDate), 'MMM d, yyyy')}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      type: 'date',
      sortable: true,
      render: (row) => {
        const dueDate = new Date(row.dueDate);
        const isLate = row.status !== 'paid' && row.status !== 'void' && isPast(dueDate);
        return (
          <span className={cn('text-sm', isLate && 'text-[var(--danger)] font-medium')}>
            {format(dueDate, 'MMM d, yyyy')}
            {row.agingDays > 0 && (
              <span className="text-[var(--danger)] ml-1">({row.agingDays}d)</span>
            )}
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
              Mark Paid
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(row.id)}
            className="text-[var(--danger)]"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const totals = invoices.reduce(
    (acc, inv) => {
      if (inv.status === 'paid') acc.paidTotal += inv.total;
      else if (inv.status === 'overdue') acc.overdueTotal += inv.total;
      else if (inv.status === 'sent') acc.openTotal += inv.total;
      else if (inv.status === 'draft') acc.draftCount++;
      return acc;
    },
    { paidTotal: 0, overdueTotal: 0, openTotal: 0, draftCount: 0 }
  );

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="content-head">
        <div>
          <h1 className="greet">Sales & Invoices</h1>
          <p className="sub">Manage invoices and track payments.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary"><Upload size={16} /> Import</Button>
        <Button variant="secondary"><Download size={16} /> Export</Button>
        <Button onClick={() => router.push('/invoices/new')}>
          <Plus size={16} /> New Invoice
        </Button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Open', value: money(totals.openTotal), color: 'text-[var(--warning)]' },
          { label: 'Overdue', value: money(totals.overdueTotal), color: 'text-[var(--danger)]' },
          { label: 'Paid YTD', value: money(totals.paidTotal), color: 'text-[var(--success)]' },
          { label: 'Drafts', value: String(totals.draftCount), color: 'text-[var(--text-muted)]' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 shadow-[var(--shadow-sm)]">
            <div className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">
              {kpi.label}
            </div>
            <div className={cn('font-mono tabular-nums text-xl font-semibold', kpi.color)}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none grid">
            <Search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search invoices or customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'sent', label: 'Open' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'paid', label: 'Paid' },
            { value: 'draft', label: 'Drafts' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <div className="flex-1" />
        <span className="text-sm text-[var(--text-muted)]">
          {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <DataTable
        columns={columns}
        data={invoices}
        rowKey={(row) => row.id}
        emptyMessage={loading ? 'Loading...' : 'No invoices found.'}
        onRowClick={(row) => router.push(`/invoices/${row.id}`)}
      />
    </AppShell>
  );
}
