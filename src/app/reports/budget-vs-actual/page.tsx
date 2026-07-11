'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import {
  ArrowLeft, Loader2, TrendingDown, TrendingUp, BarChart3,
} from 'lucide-react';
import { ReportHeader } from '@/components/reports/ReportHeader';
import {
  BarChart as ReBarChart, Bar as ReBar, XAxis as ReXAxis, YAxis as ReYAxis,
  CartesianGrid as ReCartesianGrid, Tooltip as ReTooltip, ResponsiveContainer as ReResponsiveContainer,
} from 'recharts';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}: {money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function BudgetVsActualContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const budgetId = searchParams.get('budgetId') || '';

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!budgetId) { setLoading(false); return; }
    fetch(`/api/reports/budget-vs-actual?budgetId=${budgetId}`)
      .then(r => r.json()).then(json => setData(json.data)).catch(() => {}).finally(() => setLoading(false));
  }, [budgetId]);

  if (!budgetId) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-12 text-center">
          <h2 className="text-lg font-bold text-[var(--text-strong)] mb-2">Select a Budget</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">Choose a budget to compare against actuals.</p>
          <Button onClick={() => router.push('/budgets')}><ArrowLeft size={14} /> View Budgets</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/budgets')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]"><ArrowLeft size={18} className="text-[var(--text-muted)]" /></button>
        <div>
          <ReportHeader
            companyName={data?.companyName || ''}
            statementName="Budget vs Actual"
            periodLabel={data ? `FY ${data.budget.fiscalYear}` : 'Loading...'}
            subtitle={data?.budget.name}
          />
        </div>
      </div>

      {loading && <div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>}

      {!loading && data && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Budget', value: data.totals.budget, color: 'text-[var(--text-strong)]' },
              { label: 'Actual', value: data.totals.actual, color: data.totals.variance > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
              { label: 'Variance', value: data.totals.variance, color: data.totals.variance > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
              { label: 'Variance %', value: `${data.totals.variancePct}%`, color: data.totals.variancePct > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]' },
            ].map(kpi => (
              <Card key={kpi.label}>
                <CardBody>
                  <div className="text-xs text-[var(--text-muted)] mb-1">{kpi.label}</div>
                  <div className={cn('font-mono text-xl font-semibold', kpi.color)}>
                    {kpi.value}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Chart */}
          <Card className="mb-6">
            <CardHeader><h3 className="font-semibold text-[var(--text-strong)]">Comparison Chart</h3></CardHeader>
            <CardBody>
              <ReResponsiveContainer width="100%" height={300}>
                <ReBarChart data={data.rows} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <ReCartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <ReXAxis dataKey="accountName" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} angle={-25} textAnchor="end" height={60} />
                  <ReYAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <ReTooltip content={<ChartTooltip />} />
                  <ReBar dataKey="budgetAmount" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={30} name="Budget" />
                  <ReBar dataKey="actualAmount" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={30} name="Actual" />
                </ReBarChart>
              </ReResponsiveContainer>
            </CardBody>
          </Card>

          {/* Detail table */}
          <Card>
            <CardHeader><h3 className="font-semibold text-[var(--text-strong)]">Line Item Details</h3></CardHeader>
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="py-2">Account</th>
                      <th className="py-2 text-right">Budget</th>
                      <th className="py-2 text-right">Actual</th>
                      <th className="py-2 text-right">Variance</th>
                      <th className="py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.rows.map((row: any) => (
                      <tr key={row.glAccountCode} className="hover:bg-[var(--surface-2)]">
                        <td className="py-2.5">
                          <div className="text-[var(--text-strong)]">{row.accountName}</div>
                          <div className="text-xs text-[var(--text-muted)]">{row.glAccountCode}</div>
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums">{money(row.budgetAmount)}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums">{money(row.actualAmount)}</td>
                        <td className={cn('py-2.5 text-right font-mono tabular-nums', row.variance > 0 ? 'text-[var(--danger)]' : row.variance < 0 ? 'text-[var(--success)]' : '')}>
                          {row.variance > 0 ? '+' : ''}{money(row.variance)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Badge variant={row.isOverBudget ? 'overdue' : 'paid'}>{row.variancePct}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </AppShell>
  );
}

export default function BudgetVsActualPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>}>
      <BudgetVsActualContent />
    </Suspense>
  );
}
