'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface CategoryData {
  code: string;
  name: string;
  detailType: string | null;
  balance: number;
  billCount: number;
  descriptions: string[];
  percentage: number;
}

interface ExpenseData {
  year: string;
  totalExpenses: number;
  categories: CategoryData[];
  count: number;
}

export default function ExpenseBreakdownPage() {
  const router = useRouter();
  const [data, setData] = useState<ExpenseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState('2026');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/expense-breakdown?year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch expense breakdown');
      const json = await res.json();
      setData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [year]);

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

  const maxBalance = Math.max(...data.categories.map((c) => c.balance), 1);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">Expense by Category</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Fiscal year {year} · {data.count} categories · {money(data.totalExpenses)} total</p>
          </div>
        </div>
        <select value={year} onChange={(e) => setYear(e.target.value)} className="text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]">
          {['2026', '2025'].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Horizontal bar chart + table */}
      <Card>
        <CardHeader><h2 className="text-lg font-semibold text-[var(--text-strong)]">Spending by GL Account</h2></CardHeader>
        <CardBody>
          <div className="space-y-3">
            {data.categories.map((cat) => (
              <div key={cat.code} onClick={() => router.push(`/reports/general-ledger?code=${cat.code}&name=${encodeURIComponent(cat.name)}`)} className="cursor-pointer group">
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-[var(--text-strong)] truncate group-hover:text-[var(--primary)] transition-colors">{cat.name}</span>
                    <span className="text-xs text-[var(--text-faint)] shrink-0">{cat.code}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className="text-xs text-[var(--text-muted)]">{cat.percentage}%</span>
                    <span className="font-mono text-sm">{money(cat.balance)}</span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--surface-3)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--danger)] rounded-full transition-all"
                    style={{ width: `${(cat.balance / maxBalance) * 100}%` }}
                  />
                </div>
                {cat.descriptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 ml-0">
                    {cat.descriptions.map((desc, i) => (
                      <span key={i} className="text-micro text-[var(--text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">
                        {desc}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Summary pie-equivalent: list view */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader><h3 className="text-sm font-semibold text-[var(--text-strong)]">Top Expenses</h3></CardHeader>
          <CardBody>
            {data.categories.slice(0, 5).map((cat) => (
              <div key={cat.code} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <span className="text-[var(--text)]">{cat.name}</span>
                <span className="font-mono text-[var(--danger)]">{money(cat.balance)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><h3 className="text-sm font-semibold text-[var(--text-strong)]">Category Details</h3></CardHeader>
          <CardBody>
            {data.categories.map((cat) => (
              <div key={cat.code} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <div>
                  <span className="text-[var(--text)]">{cat.name}</span>
                  {cat.detailType && <span className="text-xs text-[var(--text-faint)] ml-1">· {cat.detailType}</span>}
                </div>
                <div className="text-right">
                  <div className="font-mono text-[var(--text-strong)]">{money(cat.balance)}</div>
                  <div className="text-xs text-[var(--text-muted)]">{cat.billCount} bill{cat.billCount !== 1 ? 's' : ''} · {cat.percentage}%</div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
