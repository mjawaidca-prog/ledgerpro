'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';

export default function BudgetEditorPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isNew = params.id === 'new';
  const fy = useFiscalYear();
  const [name, setName] = useState('');
  // Use string state for year input to avoid parseInt-on-every-keystroke issue
  // where typing "26" would capture just "2" and immediately react
  const [fiscalYearText, setFiscalYearText] = useState(fy.defaultYear || String(new Date().getFullYear()));
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'annual'>('annual');
  const [lines, setLines] = useState<{ glAccountCode: string; amount: number; period?: string }[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => { if (fy.loaded) setFiscalYearText(fy.defaultYear); }, [fy.loaded, fy.defaultYear]);

  useEffect(() => {
    fetch('/api/coa').then(r => r.json()).then(json => setCoaAccounts(json.data || [])).catch(() => {});

    if (!isNew) {
      fetch(`/api/budgets/${params.id}`).then(r => r.json()).then(json => {
        const b = json.data;
        if (b) {
          setName(b.name);
          setFiscalYearText(String(b.fiscalYear));
          setPeriod(b.period);
          setLines(b.lines.map((l: any) => ({ glAccountCode: l.glAccountCode, amount: Number(l.amount), period: l.period })));
        }
      }).catch(() => {}).finally(() => setLoading(false));
    }
  }, [isNew, params.id]);

  function addLine() { setLines([...lines, { glAccountCode: coaAccounts[0]?.code || '', amount: 0 }]); }
  function removeLine(idx: number) { setLines(lines.filter((_, i) => i !== idx)); }
  function updateLine(idx: number, field: string, value: any) {
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: field === 'amount' ? parseFloat(value) || 0 : value } : l));
  }

  async function handleSave() {
    if (!name.trim()) { setMessage({ type: 'danger', text: 'Budget name is required.' }); return; }
    if (lines.length === 0) { setMessage({ type: 'danger', text: 'Add at least one budget line.' }); return; }
    setSaving(true); setMessage(null);

    const fiscalYear = parseInt(fiscalYearText) || new Date().getFullYear();
    const payload = { name, fiscalYear, period, lines };
    const url = isNew ? '/api/budgets' : `/api/budgets/${params.id}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMessage({ type: 'success', text: 'Budget saved.' });
      if (isNew) router.push(`/budgets/${json.data.id}`);
    } catch (err: any) {
      setMessage({ type: 'danger', text: err.message });
    } finally { setSaving(false); }
  }

  if (loading) return <AppShell><div className="flex items-center justify-center h-48"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>;

  const expenseAccounts = coaAccounts.filter(a => a.type === 'expense');
  const totalBudget = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <AppShell>
      <div className="max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/budgets')} className="p-2 rounded-lg hover:bg-[var(--surface-3)]"><ArrowLeft size={18} className="text-[var(--text-muted)]" /></button>
          <div className="flex-1"><h1 className="text-2xl font-bold text-[var(--text-strong)]">{isNew ? 'New Budget' : 'Edit Budget'}</h1></div>
          <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</Button>
        </div>

        {message && <Alert variant={message.type} className="mb-4">{message.text}</Alert>}

        <Card className="mb-4">
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="field"><label>Budget Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Annual Operating Budget" /></div>
              <div className="field"><label>Fiscal Year</label><input className="input" type="text" inputMode="numeric" pattern="[0-9]*" value={fiscalYearText} onChange={e => setFiscalYearText(e.target.value)} /></div>
            </div>
            <div className="field">
              <label>Period</label>
              <div className="flex gap-2">
                {(['monthly', 'quarterly', 'annual'] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all ${period === p ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold text-[var(--text-strong)]">Budget Lines ({lines.length})</h3></CardHeader>
          <CardBody>
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select className="input flex-1" value={line.glAccountCode} onChange={e => updateLine(idx, 'glAccountCode', e.target.value)}>
                    {expenseAccounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <input type="number" className="input w-[140px] text-right font-mono" value={line.amount || ''} onChange={e => updateLine(idx, 'amount', e.target.value)} placeholder="0.00" />
                  <button onClick={() => removeLine(idx)} className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--danger)]"><Trash2 size={14} /></button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addLine}><Plus size={14} /> Add Line</Button>
              {lines.length > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                  <span className="text-sm font-medium text-[var(--text-strong)]">Total Budget</span>
                  <span className="font-mono text-lg font-semibold tabular-nums">{money(totalBudget)}</span>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
