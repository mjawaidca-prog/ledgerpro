'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Loader2, Building2, CreditCard, Tag, FileText, AlertCircle } from 'lucide-react';

export default function TransactionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [tx, setTx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  async function handleVoid() {
    if (!confirm('Void this transaction? A reversing entry will be posted to the ledger — this cannot be undone.')) return;
    setVoiding(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to void transaction');
      router.push('/banking');
    } catch (err: any) {
      setVoidError(err.message);
      setVoiding(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/transactions?id=${id}`);
        if (!res.ok) throw new Error('Transaction not found');
        const json = await res.json();
        setTx(json.data?.[0] || null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[var(--text-muted)]" size={28} /></div>
      </AppShell>
    );
  }

  if (error || !tx) {
    return (
      <AppShell>
        <div className="text-center py-16">
          <AlertCircle size={48} className="mx-auto text-[var(--text-faint)] mb-4" />
          <p className="text-[var(--text-muted)]">{error || 'Transaction not found'}</p>
        </div>
      </AppShell>
    );
  }

  const statusColors: Record<string, 'paid' | 'overdue' | 'pending' | 'draft' | 'info' | 'neutral'> = {
    toreview: 'pending',
    categorized: 'paid',
    excluded: 'neutral',
    transfer: 'info',
    reconciled: 'paid',
    voided: 'draft',
  };

  return (
    <AppShell>
      <div className="max-w-3xl">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-6 transition-colors">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">{tx.description}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {format(new Date(tx.date), 'MMMM d, yyyy')} · Transaction ID: {tx.id}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusColors[tx.status] || 'neutral'} className="text-sm">{tx.status}</Badge>
            {tx.status !== 'voided' && (
              <button
                onClick={handleVoid}
                disabled={voiding}
                className="text-sm font-medium text-[var(--danger)] hover:underline disabled:opacity-50"
              >
                {voiding ? 'Voiding…' : 'Void'}
              </button>
            )}
          </div>
        </div>
        {voidError && (
          <p className="text-sm text-[var(--danger)] mb-4">{voidError}</p>
        )}

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Details</h2></CardHeader>
            <CardBody className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)] flex items-center gap-2"><Building2 size={14} /> Account</span>
                <span className="font-medium text-[var(--text-strong)]">{tx.account?.name || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)] flex items-center gap-2"><Tag size={14} /> Category</span>
                <span className="font-medium text-[var(--text-strong)]">{tx.category?.name || 'Uncategorized'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)] flex items-center gap-2"><CreditCard size={14} /> Amount</span>
                <span className={cn('font-mono font-bold text-lg', Number(tx.amount) >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                  {money(Number(tx.amount), true)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Currency</span>
                <span className="font-medium text-[var(--text)]">{tx.currency}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Source</span>
                <span className="font-medium text-[var(--text)] capitalize">{tx.source}</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Additional Info</h2></CardHeader>
            <CardBody className="space-y-4">
              {tx.merchant && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Merchant</span>
                  <span className="font-medium text-[var(--text)]">{tx.merchant}</span>
                </div>
              )}
              {tx.rawStatementText && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Statement Text</span>
                  <span className="font-mono text-xs text-[var(--text-muted)] text-right max-w-[200px] truncate">{tx.rawStatementText}</span>
                </div>
              )}
              {tx.matchRef && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Match Reference</span>
                  <span className="font-medium text-[var(--accent)]">{tx.matchRef}</span>
                </div>
              )}
              {tx.excludeReason && (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">Exclude Reason</span>
                  <span className="font-medium text-[var(--warning)]">{tx.excludeReason}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Created</span>
                <span className="font-medium text-[var(--text)]">{format(new Date(tx.createdAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Updated</span>
                <span className="font-medium text-[var(--text)]">{format(new Date(tx.updatedAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Related links */}
        <div className="flex gap-2 mt-4">
          <button onClick={() => router.push(`/reports/general-ledger?code=${tx.category?.code || ''}`)} className="text-sm text-[var(--accent)] hover:text-[var(--primary)] flex items-center gap-1">
            <FileText size={14} /> View in General Ledger
          </button>
          {tx.matchRef && tx.matchRef.startsWith('INV') && (
            <button onClick={() => router.push(`/invoices/${tx.matchRef}`)} className="text-sm text-[var(--accent)] hover:text-[var(--primary)] flex items-center gap-1">
              <FileText size={14} /> View Invoice {tx.matchRef}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
