'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { money } from '@/lib/money';
import { Plus, Loader2, Zap, Trash2, Target } from 'lucide-react';

const typeLabels: Record<string, string> = {
  merchant_match: 'Merchant Match',
  description_contains: 'Description Contains',
  amount_range: 'Amount Range',
  regex: 'Regex Pattern',
};

export default function CategorizationRulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [coa, setCoa] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', pattern: '', patternType: 'description_contains' as string, categoryId: '', minAmount: '', maxAmount: '', priority: '0' });

  const fetchRules = useCallback(async () => {
    const [rRes, cRes] = await Promise.all([
      fetch('/api/categorization-rules').then(r => r.json()),
      fetch('/api/coa').then(r => r.json()),
    ]);
    setRules(rRes.data || []);
    setCoa(cRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function handleApply() {
    setApplying(true); setResult(null);
    try {
      const res = await fetch('/api/categorization-rules/apply', { method: 'POST' });
      const json = await res.json();
      setResult(json.data?.message || 'Applied');
    } catch {} finally { setApplying(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name, pattern: form.pattern, patternType: form.patternType, categoryId: form.categoryId,
      minAmount: form.minAmount ? parseFloat(form.minAmount) : undefined,
      maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
      priority: parseInt(form.priority) || 0,
    };
    const res = await fetch('/api/categorization-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { setShowForm(false); setForm({ name: '', pattern: '', patternType: 'description_contains', categoryId: '', minAmount: '', maxAmount: '', priority: '0' }); fetchRules(); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule?')) return;
    await fetch(`/api/categorization-rules/${id}`, { method: 'DELETE' });
    fetchRules();
  }

  if (loading) return <AppShell><div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div></AppShell>;

  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="content-head">
          <div>
            <h1 className="greet">Categorization Rules</h1>
            <p className="sub">Auto-categorize imported bank transactions based on patterns you define.</p>
          </div>
          <div className="spacer" />
          <Button variant="secondary" onClick={handleApply} disabled={applying}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Apply Rules
          </Button>
          <Button onClick={() => setShowForm(true)}><Plus size={14} /> New Rule</Button>
        </div>

        {result && <Alert variant="success" className="mb-4">{result}</Alert>}

        {showForm && (
          <Card className="mb-6">
            <CardHeader><h3 className="t-h3">New Rule</h3></CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="field"><label>Rule Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="AWS charges" required /></div>
                  <div className="field"><label>Match Type</label><select className="input" value={form.patternType} onChange={e => setForm({...form, patternType: e.target.value})}>
                    {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                </div>
                <div className="field"><label>Pattern</label><input className="input" value={form.pattern} onChange={e => setForm({...form, pattern: e.target.value})} placeholder={form.patternType === 'amount_range' ? '0-100' : form.patternType === 'regex' ? 'Amazon.*Web.*' : 'Amazon Web Services'} required /></div>
                {form.patternType === 'amount_range' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="field"><label>Min Amount ($)</label><input type="number" className="input" value={form.minAmount} onChange={e => setForm({...form, minAmount: e.target.value})} /></div>
                    <div className="field"><label>Max Amount ($)</label><input type="number" className="input" value={form.maxAmount} onChange={e => setForm({...form, maxAmount: e.target.value})} /></div>
                  </div>
                )}
                <div className="field"><label>Category</label><select className="input" value={form.categoryId} onChange={e => setForm({...form, categoryId: e.target.value})} required>
                  <option value="">Select GL account...</option>
                  {coa.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select></div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm"><Plus size={14} /> Create Rule</Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        )}

        {rules.length === 0 ? (
          <Card><CardBody><div className="text-center py-12">
            <Target size={36} className="text-[var(--text-faint)] mx-auto mb-3" />
            <p className="text-sm text-[var(--text-muted)] mb-4">No categorization rules yet. Create rules to auto-categorize transactions.</p>
          </div></CardBody></Card>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <Card key={rule.id}>
                <CardBody>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--primary-soft)] grid place-items-center"><Target size={16} className="text-[var(--primary)]" /></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[var(--text-strong)]">{rule.name}</span>
                          <Badge variant="info">{typeLabels[rule.patternType] || rule.patternType}</Badge>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          Pattern: <code className="font-mono text-[var(--accent)]">{rule.pattern}</code>
                          {rule.patternType === 'amount_range' && ` ($${rule.minAmount || 0} – $${rule.maxAmount || '∞'})`}
                        </p>
                        <p className="text-[10px] text-[var(--text-faint)]">
                          → {rule.category?.code} {rule.category?.name}
                          {rule.matchCount > 0 && ` · ${rule.matchCount} matches`}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => handleDelete(rule.id)}><Trash2 size={14} /></Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
