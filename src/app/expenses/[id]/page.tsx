'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import { ArrowLeft, Plus, Trash2, Save, X, Loader2 } from 'lucide-react';

interface Bill {
  id: string; kind: 'bill' | 'expense';
  vendor: { id: string; name: string; companyName: string | null; email: string | null };
  billDate: string; dueDate: string | null; terms: string | null; referenceNo: string | null;
  subtotal: number; taxRate: number; taxAmount: number; total: number;
  status: 'draft' | 'open' | 'paid' | 'overdue' | 'void';
  notes: string | null; paidAt: string | null; paidAmount: number;
  paymentAccount: { id: string; name: string; mask: string | null } | null;
  lineItems: { id: string; description: string; amount: number; categoryId: string | null; sortOrder: number }[];
}

interface LineItem {
  key: string; description: string; amount: number; categoryId: string | null;
}

let lineKey = 0;
function fromSaved(li: { id: string; description: string; amount: number; categoryId: string | null }): LineItem {
  return { key: `line-${lineKey++}`, description: li.description, amount: Number(li.amount), categoryId: li.categoryId };
}

const expenseCategories = [
  { code: '6100', name: 'Software & Subscriptions' },
  { code: '6200', name: 'Professional Fees' },
  { code: '6300', name: 'Rent & Lease' },
  { code: '6400', name: 'Marketing' },
  { code: '6500', name: 'Travel' },
  { code: '6600', name: 'Utilities' },
  { code: '5000', name: 'Cost of Goods Sold' },
];

export default function EditBillPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null);

  const [kind, setKind] = useState<'bill' | 'expense'>('expense');
  const [billDate, setBillDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('Net 30');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [taxRate, setTaxRate] = useState(8.5);
  const [vendor, setVendor] = useState<{ id: string; name: string; companyName: string | null; email: string | null } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/bills/${id}`);
        if (!res.ok) throw new Error('Bill not found');
        const json = await res.json();
        const b: Bill = json.data;
        setKind(b.kind);
        setBillDate(format(new Date(b.billDate), 'yyyy-MM-dd'));
        setDueDate(b.dueDate ? format(new Date(b.dueDate), 'yyyy-MM-dd') : '');
        setTerms(b.terms ?? 'Net 30');
        setReferenceNo(b.referenceNo ?? '');
        setNotes(b.notes ?? '');
        setStatus(b.status);
        setTaxRate(Number(b.taxRate ?? 0));
        setVendor(b.vendor);
        setLines(b.lineItems.map(fromSaved));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally { setLoading(false); }
    }
    load();
  }, [id]);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  const isLocked = status === 'paid' || status === 'void';

  function updateLine(key: string, field: keyof LineItem, value: any) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }
  function removeLine(key: string) { setLines(prev => prev.length === 1 ? prev : prev.filter(l => l.key !== key)); }
  function addLine() { setLines(prev => [...prev, { key: `line-${lineKey++}`, description: '', amount: 0, categoryId: null }]); }

  async function handleSave(newStatus: string) {
    if (lines.some(l => !l.description.trim())) { setError('All line items need a description.'); return; }
    setSaving(true); setError(null);
    const payload = {
      billDate, dueDate: kind === 'bill' ? dueDate : null,
      terms: kind === 'bill' ? terms : null, referenceNo: referenceNo.trim() || null,
      subtotal, taxRate, taxAmount, total, status: newStatus,
      notes: notes.trim() || null,
      lineItems: lines.map((l, i) => ({
        description: l.description.trim(), amount: l.amount,
        categoryId: l.categoryId, sortOrder: i,
      })),
    };
    try {
      const res = await fetch(`/api/bills/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
      setToast({ message: 'Saved.', type: 'success' });
      if (newStatus !== 'draft') setStatus(newStatus);
    } catch (err) {
      setToast({ message: 'Save failed.', type: 'danger' });
    } finally { setSaving(false); }
  }

  async function handleVoid() {
    if (!confirm('Void this record?')) return;
    setSaving(true);
    try {
      await fetch(`/api/bills/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'void' }) });
      setToast({ message: 'Voided.', type: 'success' }); setStatus('void');
    } catch { setToast({ message: 'Failed.', type: 'danger' }); }
    finally { setSaving(false); }
  }

  if (loading) {
    return <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
        <Loader2 size={24} className="animate-spin" />
      </div>
    </AppShell>;
  }

  const statusVariant = status === 'paid' ? 'paid' as const : status === 'overdue' ? 'overdue' as const : status === 'draft' ? 'draft' as const : status === 'void' ? 'draft' as const : 'pending' as const;

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/expenses')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="t-h1">{id}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{vendor?.companyName || vendor?.name} · {kind === 'bill' ? 'Bill' : 'Expense'}</p>
        </div>
        <Badge variant={statusVariant}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
        {!isLocked && (
          <>
            <Button variant="secondary" onClick={() => handleSave('draft')} disabled={saving}><Save size={16} /> Save</Button>
            <Button onClick={() => handleSave('open')} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Update
            </Button>
          </>
        )}
        {!isLocked && status !== 'void' && (
          <Button variant="destructive" size="sm" onClick={handleVoid}>Void</Button>
        )}
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className={cn('grid grid-cols-[1fr_340px] gap-6', isLocked && 'pointer-events-none opacity-60')}>
        <div className="space-y-5">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">
              {kind === 'bill' ? 'Vendor' : 'Payee'}
            </label>
            {vendor && (
              <div className="flex items-center gap-3">
                <div className="w-[38px] h-[38px] rounded-full bg-[#7c3aed] text-white grid place-items-center font-bold text-sm">{vendor.name.charAt(0)}</div>
                <div>
                  <div className="text-sm font-semibold text-[var(--text-strong)]">{vendor.companyName || vendor.name}</div>
                  {vendor.companyName && <div className="text-xs text-[var(--text-muted)]">{vendor.name}</div>}
                </div>
              </div>
            )}
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] flex items-center gap-4">
              <span className="flex-1">Description</span>
              <span className="w-[160px]">Category</span>
              <span className="w-[120px] text-right">Amount</span>
              {!isLocked && <span className="w-[40px]" />}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {lines.map(line => (
                <div key={line.key} className="flex items-center gap-4 px-5 py-3">
                  <input type="text" placeholder="Description" value={line.description}
                    onChange={e => updateLine(line.key, 'description', e.target.value)} readOnly={isLocked}
                    className="flex-1 h-[34px] px-2 rounded-md border border-transparent bg-transparent text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)]"
                  />
                  <select value={line.categoryId ?? ''}
                    onChange={e => updateLine(line.key, 'categoryId', e.target.value || null)} disabled={isLocked}
                    className="w-[160px] h-[34px] px-2 rounded-md border border-transparent bg-transparent text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)]">
                    <option value="">Select...</option>
                    {expenseCategories.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                  </select>
                  <input type="number" min="0" step="0.01" value={line.amount || ''}
                    onChange={e => updateLine(line.key, 'amount', parseFloat(e.target.value) || 0)} readOnly={isLocked}
                    className="w-[120px] h-[34px] px-2 text-right rounded-md border border-transparent bg-transparent font-mono text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {!isLocked && (
                    <button onClick={() => removeLine(line.key)}
                      className="w-[34px] h-[34px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isLocked && (
              <div className="px-5 py-3 border-t border-[var(--border)]">
                <Button variant="ghost" size="sm" onClick={addLine}><Plus size={14} /> Add Line</Button>
              </div>
            )}
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">Notes</label>
            <textarea rows={3} placeholder="Internal notes..." value={notes}
              onChange={e => setNotes(e.target.value)} readOnly={isLocked}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)] resize-none"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5 space-y-4">
            <div className="field">
              <label>Bill Date</label>
              <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="input" readOnly={isLocked} />
            </div>
            {kind === 'bill' && (
              <>
                <div className="field">
                  <label>Reference No.</label>
                  <input type="text" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} className="input" readOnly={isLocked} />
                </div>
                <div className="field">
                  <label>Due Date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" readOnly={isLocked} />
                </div>
              </>
            )}
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <h3 className="font-semibold text-[var(--text-strong)] text-sm">Bill Total</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Subtotal</span>
                <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-muted)]">Tax Rate</span>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max="100" step="0.1" value={taxRate}
                    onChange={e => setTaxRate(parseFloat(e.target.value) || 0)} readOnly={isLocked}
                    className="w-[70px] h-[30px] px-2 text-right rounded-md border border-[var(--border-strong)] bg-[var(--surface)] font-mono text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-sm text-[var(--text-muted)]">%</span>
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Tax ({taxRate}%)</span>
                <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(taxAmount)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-[var(--border)]">
                <span className="text-sm font-semibold text-[var(--text-strong)]">Total (USD)</span>
                <span className="font-mono tabular-nums text-lg font-semibold text-[var(--text-strong)]">{money(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="toast-stack">
          <div className={cn('toast', toast.type === 'danger' && 'danger')}>
            <span className="t-ico">
              {toast.type === 'success'
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
              }
            </span>
            <div className="t-body"><div>{toast.message}</div></div>
            <button className="t-close" onClick={() => setToast(null)}><X size={15} /></button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
