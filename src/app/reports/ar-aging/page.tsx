'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface InvoiceRow {
  id: string;
  customerName: string;
  invoiceId: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paidAmount: number;
  remaining: number;
  daysOverdue: number;
  status: string;
}

interface AgingData {
  asOf: string;
  aging: Record<string, { total: number; count: number; invoices: InvoiceRow[] }>;
  totalOutstanding: number;
  totalInvoices: number;
}

const BUCKET_LABELS: Record<string, string> = {
  current: 'Current',
  '1-30': '1–30 days overdue',
  '31-60': '31–60 days overdue',
  '61-90': '61–90 days overdue',
  '90+': '90+ days overdue',
};

const BUCKET_COLORS: Record<string, string> = {
  current: 'text-[var(--success)]',
  '1-30': 'text-[var(--warning)]',
  '31-60': 'text-[var(--warning)]',
  '61-90': 'text-[var(--danger)]',
  '90+': 'text-[var(--danger)]',
};

export default function ARAgingPage() {
  const router = useRouter();
  const [data, setData] = useState<AgingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/ar-aging?asOf=${asOf}`);
      if (!res.ok) throw new Error('Failed to fetch AR aging');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={28} /></div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="text-center py-16 text-[var(--text-muted)]">{error || 'No data'}</div>
      </AppShell>
    );
  }

  const buckets = ['current', '1-30', '31-60', '61-90', '90+'];

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Accounts Receivable Aging</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">As of {format(new Date(data.asOf), 'MMM d, yyyy')} · {data.totalInvoices} open invoices · {money(data.totalOutstanding)} outstanding</p>
          </div>
        </div>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {buckets.map((key) => (
          <Card key={key}>
            <CardBody className="p-3 text-center">
              <div className="text-xs text-[var(--text-muted)]">{BUCKET_LABELS[key]}</div>
              <div className={cn('text-lg font-mono font-bold mt-1', BUCKET_COLORS[key])}>{money(data.aging[key].total)}</div>
              <div className="text-xs text-[var(--text-faint)] mt-0.5">{data.aging[key].count} invoice{data.aging[key].count !== 1 ? 's' : ''}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Invoice Details</h2></CardHeader>
        <CardBody>
          {buckets.map((key) => {
            const bucket = data.aging[key];
            if (bucket.invoices.length === 0) return null;
            return (
              <div key={key} className="mb-4">
                <div className={cn('text-sm font-semibold px-1 py-1', BUCKET_COLORS[key])}>{BUCKET_LABELS[key]} ({bucket.count})</div>
                {bucket.invoices.map((inv) => (
                  <div key={inv.id} onClick={() => router.push(`/invoices/${inv.id}`)} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-[var(--primary-soft)] text-sm cursor-pointer group transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-[var(--text-strong)]">{inv.customerName}</span>
                      <span className="text-[var(--text-muted)] ml-2">{inv.invoiceId}</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mx-4 shrink-0">Due {format(new Date(inv.dueDate), 'MMM d')}</div>
                    <div className={cn('px-2 py-0.5 rounded-full text-xs font-medium', inv.daysOverdue > 60 ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : inv.daysOverdue > 0 ? 'bg-[var(--warning-soft)] text-[var(--warning)]' : 'bg-[var(--success-soft)] text-[var(--success)]')}>
                      {inv.daysOverdue > 0 ? `${inv.daysOverdue}d overdue` : 'Current'}
                    </div>
                    <div className="font-mono text-sm ml-4 w-24 text-right">{money(inv.remaining)}</div>
                  </div>
                ))}
              </div>
            );
          })}
          {data.totalInvoices === 0 && <div className="text-center py-8 text-[var(--text-muted)]">All invoices paid — nothing outstanding.</div>}
        </CardBody>
      </Card>
    </AppShell>
  );
}
