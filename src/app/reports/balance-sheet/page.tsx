'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';

interface AccountLine {
  code: string;
  name: string;
  detailType: string | null;
  balance: number;
}

interface BalanceSheetData {
  asOf: string;
  isBalanced: boolean;
  assets: {
    current: { accounts: AccountLine[]; total: number };
    nonCurrent: { accounts: AccountLine[]; total: number };
    total: number;
  };
  liabilities: {
    current: { accounts: AccountLine[]; total: number };
    nonCurrent: { accounts: AccountLine[]; total: number };
    total: number;
  };
  equity: {
    accounts: AccountLine[];
    total: number;
  };
  totalLiabilitiesAndEquity: number;
}

function AccountRow({ account, indent, router }: { account: AccountLine; indent?: boolean; router: any }) {
  return (
    <div
      onClick={() => router.push(`/reports/general-ledger?code=${account.code}&name=${encodeURIComponent(account.name)}`)}
      className={cn('flex items-center justify-between py-2 px-3 rounded-md hover:bg-[var(--primary-soft)] cursor-pointer transition-colors group', indent && 'pl-8')}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-strong)] truncate group-hover:text-[var(--primary)] transition-colors">{account.name}</div>
        <div className="text-xs text-[var(--text-muted)]">
          {account.code}{account.detailType ? ` · ${account.detailType}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 ml-4">
        <ExternalLink size={12} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="text-sm font-mono tabular-nums text-[var(--text)]">
          {money(account.balance)}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, total, borderTop }: { title: string; total: number; borderTop?: boolean }) {
  return (
    <div className={cn(
      'flex items-center justify-between py-3 px-3',
      borderTop && 'border-t border-[var(--border)] mt-1'
    )}>
      <span className="text-sm font-semibold text-[var(--text-strong)]">{title}</span>
      <span className="text-sm font-mono font-semibold tabular-nums text-[var(--text-strong)]">
        {money(total, true)}
      </span>
    </div>
  );
}

export default function BalanceSheetPage() {
  const router = useRouter();
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fy = useFiscalYear();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  useEffect(() => { if (fy.loaded && fy.fiscalYearEnd) setAsOf(fy.fiscalYearEnd); }, [fy.loaded, fy.fiscalYearEnd]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/balance-sheet?asOf=${asOf}`);
      if (!res.ok) throw new Error('Failed to fetch balance sheet');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-[var(--text-muted)]" size={28} />
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="text-center py-16 text-[var(--text-muted)]">
          {error || 'Unable to load balance sheet.'}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/reports')}
            className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          >
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
              Balance Sheet
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              As of {format(new Date(data.asOf), 'MMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)] font-mono"
          />
          <div className={cn(
            'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full font-medium',
            data.isBalanced
              ? 'bg-[var(--success-soft)] text-[var(--success)]'
              : 'bg-[var(--danger-soft)] text-[var(--danger)]'
          )}>
            {data.isBalanced
              ? <CheckCircle2 size={14} />
              : <AlertTriangle size={14} />
            }
            {data.isBalanced ? 'Balanced' : 'Unbalanced'}
          </div>
        </div>
      </div>

      {/* Balance Sheet Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* ASSETS Column */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">Assets</h2>
          </CardHeader>
          <CardBody className="space-y-0">
            {/* Current Assets */}
            <div className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-3 py-2">
              Current Assets
            </div>
            {data.assets.current.accounts.map((a) => (
              <AccountRow key={a.code} account={a} router={router} />
            ))}
            <SectionHeader title="Total Current Assets" total={data.assets.current.total} borderTop />

            {/* Non-Current Assets */}
            <div className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-3 py-2 mt-4">
              Non-Current Assets
            </div>
            {data.assets.nonCurrent.accounts.length > 0 ? (
              data.assets.nonCurrent.accounts.map((a) => (
                <AccountRow key={a.code} account={a} router={router} />
              ))
            ) : (
              <div className="text-sm text-[var(--text-faint)] px-3 py-2 italic">No non-current assets</div>
            )}
            <SectionHeader title="Total Non-Current Assets" total={data.assets.nonCurrent.total} borderTop />

            {/* Total Assets */}
            <div className="flex items-center justify-between py-4 px-3 mt-2 border-t-2 border-[var(--border-strong)]">
              <span className="text-base font-bold text-[var(--text-strong)]">Total Assets</span>
              <span className="text-base font-bold font-mono tabular-nums text-[var(--text-strong)]">
                {money(data.assets.total)}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* LIABILITIES + EQUITY Column */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">Liabilities</h2>
            </CardHeader>
            <CardBody className="space-y-0">
              {/* Current Liabilities */}
              <div className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-3 py-2">
                Current Liabilities
              </div>
              {data.liabilities.current.accounts.map((a) => (
                <AccountRow key={a.code} account={a} router={router} />
              ))}
              {data.liabilities.current.accounts.length === 0 && (
                <div className="text-sm text-[var(--text-faint)] px-3 py-2 italic">No current liabilities</div>
              )}
              <SectionHeader title="Total Current Liabilities" total={data.liabilities.current.total} borderTop />

              {/* Non-Current Liabilities */}
              {data.liabilities.nonCurrent.accounts.length > 0 && (
                <>
                  <div className="text-xs font-semibold uppercase tracking-[0.10em] text-[var(--text-muted)] px-3 py-2 mt-4">
                    Non-Current Liabilities
                  </div>
                  {data.liabilities.nonCurrent.accounts.map((a) => (
                    <AccountRow key={a.code} account={a} router={router} />
                  ))}
                  <SectionHeader title="Total Non-Current Liabilities" total={data.liabilities.nonCurrent.total} borderTop />
                </>
              )}

              {/* Total Liabilities */}
              <div className="flex items-center justify-between py-3 px-3 mt-1 border-t border-[var(--border)]">
                <span className="text-sm font-bold text-[var(--text-strong)]">Total Liabilities</span>
                <span className="text-sm font-bold font-mono tabular-nums text-[var(--text-strong)]">
                  {money(data.liabilities.total)}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* EQUITY */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--text-strong)]">Equity</h2>
            </CardHeader>
            <CardBody className="space-y-0">
              {data.equity.accounts.map((a) => (
                <AccountRow key={a.code} account={a} router={router} />
              ))}
              <div className="flex items-center justify-between py-3 px-3 mt-1 border-t border-[var(--border)]">
                <span className="text-sm font-bold text-[var(--text-strong)]">Total Equity</span>
                <span className="text-sm font-bold font-mono tabular-nums text-[var(--text-strong)]">
                  {money(data.equity.total)}
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Total Liabilities + Equity */}
          <div className="flex items-center justify-between py-4 px-4 bg-[var(--surface)] border-2 border-[var(--border-strong)] rounded-xl">
            <span className="text-base font-bold text-[var(--text-strong)]">Total Liabilities &amp; Equity</span>
            <span className="text-base font-bold font-mono tabular-nums text-[var(--text-strong)]">
              {money(data.totalLiabilitiesAndEquity)}
            </span>
          </div>

          {/* Accounting equation verification */}
          <div className={cn(
            'text-center text-xs px-4 py-2 rounded-lg font-medium',
            data.isBalanced
              ? 'bg-[var(--success-soft)] text-[var(--success)]'
              : 'bg-[var(--danger-soft)] text-[var(--danger)]'
          )}>
            Assets ({money(data.assets.total)}) = Liabilities ({money(data.liabilities.total)}) + Equity ({money(data.equity.total)})
            {data.isBalanced ? ' ✓' : ' ⚠ Equation unbalanced'}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
