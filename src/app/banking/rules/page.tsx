'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchWithTenantHeaders } from '@/lib/tenant-client';

interface BankRule {
  id: string;
  name: string;
  order: number;
  op: string;
  value: string;
  anyOf: string[];
  scope: { accountIds: string[] | 'all'; direction: string };
  setCategoryCode: string | null;
  setTaxCode: string | null;
  autoPost: boolean;
  appliedCount: number;
  enabled: boolean;
}

export default function RulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<BankRule[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', op: 'contains', value: '', categoryCode: '', taxCode: '', autoPost: false, direction: 'both' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchWithTenantHeaders('/api/bank-rules')
      .then((r) => r.json())
      .then((json) => setRules(json.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithTenantHeaders('/api/bank-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          op: form.op,
          value: form.value.trim(),
          scope: { accountIds: 'all', direction: form.direction },
          setCategoryCode: form.categoryCode || null,
          setTaxCode: form.taxCode || null,
          autoPost: form.autoPost,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setShowForm(false);
      setForm({ name: '', op: 'contains', value: '', categoryCode: '', taxCode: '', autoPost: false, direction: 'both' });
      load();
    } catch {
      setError('Failed to save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAutoPost = async (rule: BankRule) => {
    await fetchWithTenantHeaders(`/api/bank-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoPost: !rule.autoPost }),
    });
    load();
  };

  const remove = async (id: string) => {
    await fetchWithTenantHeaders(`/api/bank-rules/${id}`, { method: 'DELETE' });
    load();
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!rules) return;
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    const ordered = rules.map((r) => r.id);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await fetchWithTenantHeaders(`/api/bank-rules/${rules[index].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ordered }),
    });
    load();
  };

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/banking')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Banking <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Rules</strong>
        </span>
      </div>

      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Rules</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px]">
            Rules run as rows land, in the order below. Without a bank feed they are what keeps a 148-row statement down to a handful of decisions.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[13.5px] font-semibold px-4 py-2 transition-colors"
        >
          <Plus size={15} /> New rule
        </button>
      </div>

      {error && <div className="mb-4 text-[13px] text-[var(--danger)]">{error}</div>}

      {showForm && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 mb-5 space-y-3 max-w-[640px]">
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label>Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Petro-Canada fuel" /></div>
            <div className="field">
              <label>Match</label>
              <select className="input" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
                <option value="contains">contains</option>
                <option value="is">is</option>
                <option value="starts_with">starts with</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Description {form.op === 'is' ? 'equals' : form.op === 'starts_with' ? 'starts with' : 'contains'}</label><input className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="PETRO-CANADA" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="field"><label>Category code</label><input className="input" value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value })} placeholder="6120 (blank = leave for matching)" /></div>
            <div className="field">
              <label>Direction</label>
              <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                <option value="both">both</option>
                <option value="in">money in</option>
                <option value="out">money out</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <input type="checkbox" checked={form.autoPost} onChange={(e) => setForm({ ...form, autoPost: e.target.checked })} className="accent-[var(--primary)]" />
            Auto-post rows this rule categorizes
          </label>
          <button onClick={save} disabled={saving} className="rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13px] font-semibold px-4 py-2 transition-colors">
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      )}

      {!rules ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-[var(--text-muted)]" /></div>
      ) : rules.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          No rules yet. Create one and it will apply to the next import — and to existing rows via replay.
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden max-w-[900px]">
          <div className="grid grid-cols-[40px_40px_1fr_150px_90px_90px_40px] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            <div>#</div><div /><div>When the description</div><div>Then set category</div><div className="text-right">Applied</div><div className="text-right">Auto-post</div><div />
          </div>
          {rules.map((rule, i) => (
            <div key={rule.id} className="grid grid-cols-[40px_40px_1fr_150px_90px_90px_40px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center text-[13px]">
              <div className="font-mono text-[var(--text-faint)]">{i + 1}</div>
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} className="text-[var(--text-faint)] hover:text-[var(--text-strong)] transition-colors" aria-label="Move up"><ChevronUp size={13} /></button>
                <button onClick={() => move(i, 1)} className="text-[var(--text-faint)] hover:text-[var(--text-strong)] transition-colors" aria-label="Move down"><ChevronDown size={13} /></button>
              </div>
              <div>
                <div className="text-[var(--text)]">{rule.op} {rule.value}{rule.anyOf.length ? ` or ${rule.anyOf.join(' or ')}` : ''}</div>
                <div className="font-mono text-[10px] text-[var(--text-faint)]">
                  {rule.scope.accountIds === 'all' ? 'all accounts' : 'selected accounts'} · money {rule.scope.direction}
                </div>
              </div>
              <div className="font-mono text-[12px] text-[var(--text)]">{rule.setCategoryCode ?? 'Leave for matching'}</div>
              <div className="font-mono text-right tabular-nums text-[var(--text-muted)]">{rule.appliedCount}</div>
              <div className="text-right">
                <button
                  role="switch"
                  aria-checked={rule.autoPost}
                  onClick={() => toggleAutoPost(rule)}
                  className={cn('inline-block w-[34px] h-[20px] rounded-full relative transition-colors', rule.autoPost ? 'bg-[var(--primary)]' : 'bg-[var(--border-strong)]')}
                >
                  <span className={cn('absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all', rule.autoPost ? 'left-4' : 'left-[2px]')} />
                </button>
              </div>
              <button onClick={() => remove(rule.id)} className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors" aria-label="Delete rule">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            Auto-post is off by default. A rule that only fills in the category still leaves the row in the queue for a human to confirm.
          </div>
        </div>
      )}
    </AppShell>
  );
}
