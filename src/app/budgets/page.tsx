'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { money } from '@/lib/money';
import { Plus, Loader2, ArrowRight, Trash2 } from 'lucide-react';

export default function BudgetsPage() {
  const router = useRouter();
  const [budgets, setBudgets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/budgets').then(r => r.json()).then(json => setBudgets(json.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this budget?')) return;
    await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    setBudgets(p => p.filter(b => b.id !== id));
  }

  return (
    <AppShell>
      <div className="content-head">
        <div>
          <h1 className="greet">Budgets</h1>
          <p className="sub">Plan and track your financial targets.</p>
        </div>
        <div className="spacer" />
        <Button onClick={() => router.push('/budgets/new')}><Plus size={16} /> New Budget</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>
      ) : budgets.length === 0 ? (
        <Card><CardBody><div className="py-12 text-center"><p className="text-sm text-[var(--text-muted)] mb-4">No budgets yet.</p><Button onClick={() => router.push('/budgets/new')}><Plus size={14} /> Create your first budget</Button></div></CardBody></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {budgets.map((b) => (
            <Card key={b.id}>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h3 className="font-semibold text-[var(--text-strong)]">{b.name}</h3>
                    <span className="text-xs text-[var(--text-muted)]">FY {b.fiscalYear} · {b.period} · {b.lines.length} accounts</span>
                  </div>
                  <Badge variant="info">{b.period}</Badge>
                </div>
              </CardHeader>
              <CardBody>
                <div className="space-y-1 mb-4">
                  {b.lines.slice(0, 3).map((l: any) => (
                    <div key={l.glAccountCode} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-muted)]">{l.glAccountCode}</span>
                      <span className="font-mono tabular-nums">{money(l.amount)}</span>
                    </div>
                  ))}
                  {b.lines.length > 3 && <p className="text-xs text-[var(--text-faint)]">+{b.lines.length - 3} more</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/reports/budget-vs-actual?budgetId=${b.id}`)}>
                    <ArrowRight size={12} /> Compare
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/budgets/${b.id}`)}>Edit</Button>
                  <div className="flex-1" />
                  <button onClick={() => handleDelete(b.id)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--danger)]"><Trash2 size={14} /></button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
