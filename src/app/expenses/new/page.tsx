'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, addDays } from 'date-fns';
import { ArrowLeft, Plus, Trash2, Save, Search, X, Loader2, Building2 } from 'lucide-react';
import { getTaxRate, type Province } from '@/lib/taxes';

interface VendorOption {
  id: string; name: string; companyName: string | null; email: string | null;
}

interface AccountOption {
  id: string; name: string; mask: string | null; kind: string;
}

interface CategoryOption {
  id: string; code: string; name: string;
}

interface LineItem {
  key: string; description: string; amount: number; categoryId: string | null;
}

let lineKey = 0;
function newLine(): LineItem {
  return { key: `line-${lineKey++}`, description: '', amount: 0, categoryId: null };
}

function NewBillContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialKind = (searchParams.get('kind') as 'bill' | 'expense') || 'expense';

  const [kind, setKind] = useState<'bill' | 'expense'>(initialKind);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorOpen, setVendorOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<VendorOption | null>(null);

  // Fields
  const [billDate, setBillDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [terms, setTerms] = useState('Net 30');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([newLine()]);
  const [taxRate, setTaxRate] = useState(8.5);
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(null);
  // Inline vendor creation
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCompany, setNewVendorCompany] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [creatingContact, setCreatingContact] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  // Load vendors, bank accounts, expense categories & company tax rate
  useEffect(() => {
    fetch('/api/contacts?type=supplier&status=active&limit=100')
      .then(r => r.json()).then(j => setVendors(Array.isArray(j.data) ? j.data : [])).catch(() => {});
    fetch('/api/accounts')
      .then(r => r.json()).then(j => setAccounts(Array.isArray(j.data) ? j.data : [])).catch(() => {});
    fetch('/api/coa?type=expense')
      .then(r => r.json()).then(j => setCategories(Array.isArray(j.data) ? j.data : [])).catch(() => {});
    // Fetch company province to default tax rate
    fetch('/api/companies')
      .then(r => r.json())
      .then(json => {
        const companies = json.data || [];
        const activeId = document.cookie.match(/(?:^|; )lp-active-company-id=([^;]*)/)?.[1];
        const active = companies.find((c: any) => c.id === activeId) || companies[0];
        if (active?.province) {
          setTaxRate(getTaxRate(active.province as Province).totalRate);
        }
      })
      .catch(() => {});
  }, []);

  const filteredVendors = vendors.filter(v =>
    !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    (v.companyName ?? '').toLowerCase().includes(vendorSearch.toLowerCase())
  );

  async function createVendor() {
    if (!newVendorName.trim()) {
      setError('Vendor name is required.');
      return;
    }
    setCreatingContact(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVendorName.trim(),
          companyName: newVendorCompany.trim() || null,
          email: newVendorEmail.trim() || null,
          type: 'supplier',
          status: 'active',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create vendor');
      setVendors((prev) => [...prev, json.data]);
      setSelectedVendor(json.data);
      setVendorSearch('');
      setVendorOpen(false);
      setNewVendorName('');
      setNewVendorCompany('');
      setNewVendorEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create vendor');
    } finally {
      setCreatingContact(false);
    }
  }

  function updateLine(key: string, field: keyof LineItem, value: any) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  }
  function removeLine(key: string) {
    setLines(prev => prev.length === 1 ? prev : prev.filter(l => l.key !== key));
  }
  function addLine() { setLines(prev => [...prev, newLine()]); }

  async function handleSave(newStatus: 'draft' | 'open') {
    if (!selectedVendor) { setError('Please select a vendor.'); return; }
    if (lines.some(l => !l.description.trim())) { setError('All line items need a description.'); return; }

    setSaving(true); setError(null);
    const payload = {
      kind, vendorId: selectedVendor.id, billDate, dueDate: kind === 'bill' ? dueDate : null,
      terms: kind === 'bill' ? terms : null, referenceNo: referenceNo.trim() || null,
      subtotal, taxRate, taxAmount, total, status: newStatus,
      notes: notes.trim() || null,
      paymentAccountId: paymentAccountId || null,
      lineItems: lines.map((l, i) => ({
        description: l.description.trim(), amount: l.amount,
        categoryId: l.categoryId, sortOrder: i,
      })),
    };

    try {
      const res = await fetch('/api/bills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'Save failed'); }
      const json = await res.json();
      setToast({ message: `${json.data.id} saved.`, type: 'success' });
      setTimeout(() => router.push(`/expenses/${json.data.id}`), 800);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Save failed', type: 'danger' });
    } finally { setSaving(false); }
  }

  return (
    <AppShell>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/expenses')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="t-h1">{kind === 'bill' ? 'Enter Bill' : 'New Expense'}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {kind === 'bill' ? 'Record a vendor bill for payment.' : 'Record an out-of-pocket expense.'}
          </p>
        </div>
        <Badge variant="draft">Draft</Badge>
        <Button variant="secondary" onClick={() => handleSave('draft')} disabled={saving}>
          <Save size={16} /> Save Draft
        </Button>
        <Button onClick={() => handleSave('open')} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {kind === 'bill' ? 'Save Bill' : 'Save Expense'}
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {/* Kind toggle */}
      <div className="flex gap-3 mb-5">
        {(['bill', 'expense'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={cn(
              'flex-1 py-3 rounded-lg border text-sm font-semibold transition-all',
              kind === k
                ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
            )}>
            {k === 'bill' ? 'Bill (payable later)' : 'Expense (paid now or reimbursable)'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* Left column */}
        <div className="space-y-5">
          {/* Vendor */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">
              {kind === 'bill' ? 'Vendor' : 'Payee'}
            </label>
            {selectedVendor ? (
              <div className="flex items-center gap-3">
                <div className="w-[38px] h-[38px] rounded-full bg-[#7c3aed] text-white grid place-items-center font-bold text-sm">
                  {selectedVendor.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">
                    {selectedVendor.companyName || selectedVendor.name}
                  </div>
                  {selectedVendor.companyName && (
                    <div className="text-xs text-[var(--text-muted)]">{selectedVendor.name}</div>
                  )}
                </div>
                <button onClick={() => setSelectedVendor(null)}
                  className="w-7 h-7 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--danger)]">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <input type="text" placeholder="Search vendors..."
                    value={vendorSearch} onChange={e => { setVendorSearch(e.target.value); setVendorOpen(true); }}
                    onFocus={() => setVendorOpen(true)}
                    className="w-full h-[var(--control-h)] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
                  />
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                </div>
                {vendorOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] z-20 max-h-[320px] overflow-y-auto">
                    {filteredVendors.length === 0 ? (
                      <div className="p-3 space-y-3">
                        <div className="text-sm text-[var(--text-muted)] text-center">
                          {vendorSearch
                            ? `No vendors matching "${vendorSearch}". Create one:`
                            : 'No vendors yet. Create your first vendor:'}
                        </div>
                        <div className="space-y-2">
                          <input
                            type="text"
                            placeholder="Vendor name *"
                            value={newVendorName}
                            onChange={(e) => setNewVendorName(e.target.value)}
                            className="w-full h-[34px] px-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
                            onKeyDown={(e) => { if (e.key === 'Enter') createVendor(); }}
                          />
                          <input
                            type="text"
                            placeholder="Company name (optional)"
                            value={newVendorCompany}
                            onChange={(e) => setNewVendorCompany(e.target.value)}
                            className="w-full h-[34px] px-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
                            onKeyDown={(e) => { if (e.key === 'Enter') createVendor(); }}
                          />
                          <input
                            type="email"
                            placeholder="Email (optional)"
                            value={newVendorEmail}
                            onChange={(e) => setNewVendorEmail(e.target.value)}
                            className="w-full h-[34px] px-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
                            onKeyDown={(e) => { if (e.key === 'Enter') createVendor(); }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={createVendor} disabled={creatingContact || !newVendorName.trim()}>
                            {creatingContact ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Create Vendor
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setVendorOpen(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : filteredVendors.map(v => (
                      <button key={v.id}
                        className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-[var(--surface-3)]"
                        onClick={() => { setSelectedVendor(v); setVendorSearch(''); setVendorOpen(false); }}>
                        <div className="w-[30px] h-[30px] rounded-full bg-[#7c3aed] text-white grid place-items-center font-bold text-xs flex-none">
                          {v.name.charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--text-strong)]">{v.companyName || v.name}</div>
                          <div className="text-xs text-[var(--text-muted)]">{v.email}</div>
                        </div>
                      </button>
                    ))}
                    {/* Always show "Create new vendor" option at bottom */}
                    {filteredVendors.length > 0 && (
                      <div>
                        <div className="border-t border-[var(--border)]" />
                        <div className="p-3 space-y-2">
                          <div className="text-xs text-[var(--text-muted)] font-medium">Create new vendor</div>
                          <input
                            type="text"
                            placeholder="Vendor name *"
                            value={newVendorName}
                            onChange={(e) => setNewVendorName(e.target.value)}
                            className="w-full h-[30px] px-2 text-xs rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
                            onKeyDown={(e) => { if (e.key === 'Enter') createVendor(); }}
                          />
                          <input
                            type="text"
                            placeholder="Company name (optional)"
                            value={newVendorCompany}
                            onChange={(e) => setNewVendorCompany(e.target.value)}
                            className="w-full h-[30px] px-2 text-xs rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)]"
                            onKeyDown={(e) => { if (e.key === 'Enter') createVendor(); }}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={createVendor} disabled={creatingContact || !newVendorName.trim()}>
                              {creatingContact ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                              Create
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(vendorOpen && filteredVendors.length > 0) && (
                  <div className="fixed inset-0 z-10" onClick={() => setVendorOpen(false)} />
                )}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] flex items-center gap-4">
              <span className="flex-1">Description</span>
              <span className="w-[160px]">Category</span>
              <span className="w-[120px] text-right">Amount</span>
              <span className="w-[40px]" />
            </div>
            <div className="divide-y divide-[var(--border)]">
              {lines.map(line => (
                <div key={line.key} className="flex items-center gap-4 px-5 py-3">
                  <input type="text" placeholder="Description"
                    value={line.description} onChange={e => updateLine(line.key, 'description', e.target.value)}
                    className="flex-1 h-[34px] px-2 rounded-md border border-transparent bg-transparent text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)]"
                  />
                  <select value={line.categoryId ?? ''}
                    onChange={e => updateLine(line.key, 'categoryId', e.target.value || null)}
                    className="w-[160px] h-[34px] px-2 rounded-md border border-transparent bg-transparent text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)]">
                    <option value="">Select...</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                  <input type="number" min="0" step="0.01"
                    value={line.amount || ''} onChange={e => updateLine(line.key, 'amount', parseFloat(e.target.value) || 0)}
                    className="w-[120px] h-[34px] px-2 text-right rounded-md border border-transparent bg-transparent font-mono text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button onClick={() => removeLine(line.key)}
                    className="w-[34px] h-[34px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)]">
              <Button variant="ghost" size="sm" onClick={addLine}><Plus size={14} /> Add Line</Button>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">Notes</label>
            <textarea rows={3} placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)] resize-none"
            />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Dates + Details */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5 space-y-4">
            <div className="field">
              <label>{kind === 'bill' ? 'Bill Date' : 'Expense Date'}</label>
              <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="input" />
            </div>
            {kind === 'bill' && (
              <>
                <div className="field">
                  <label>Reference No.</label>
                  <input type="text" placeholder="Vendor reference" value={referenceNo}
                    onChange={e => setReferenceNo(e.target.value)} className="input" />
                </div>
                <div className="field">
                  <label>Payment Terms</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Net 15', 'Net 30', 'Net 60'].map(t => (
                      <button key={t} type="button" onClick={() => setTerms(t)}
                        className={cn('py-2 text-xs font-semibold rounded-md border transition-all',
                          terms === t ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]')}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Due Date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input" />
                </div>
              </>
            )}
            <div className="field">
              <label>Pay from Account</label>
              <select value={paymentAccountId ?? ''} onChange={e => setPaymentAccountId(e.target.value || null)}
                className="select">
                <option value="">Select account...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} {a.mask && `(••${a.mask})`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Totals */}
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
                    onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
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
              {kind === 'bill' && dueDate && (
                <div className="text-xs text-[var(--text-muted)] pt-1">Due {format(new Date(dueDate), 'MMM d, yyyy')}</div>
              )}
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

export default function NewBillPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>}>
      <NewBillContent />
    </Suspense>
  );
}
