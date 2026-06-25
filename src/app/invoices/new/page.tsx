'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format, addDays } from 'date-fns';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Send,
  Search,
  ChevronDown,
  X,
  Loader2,
} from 'lucide-react';

interface CustomerOption {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
}

interface LineItem {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  categoryId: string | null;
}

let lineKey = 0;
function newLine(): LineItem {
  return { key: `line-${lineKey++}`, description: '', quantity: 1, unitPrice: 0, amount: 0, categoryId: null };
}

export default function NewInvoicePage() {
  const router = useRouter();

  // Customers
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);

  // Invoice fields
  const [invoiceId, setInvoiceId] = useState('');
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [terms, setTerms] = useState('Net 30');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'draft' | 'sent'>('draft');

  // Line items
  const [lines, setLines] = useState<LineItem[]>([newLine()]);

  // Tax
  const [taxRate, setTaxRate] = useState(8.5);

  // State
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null);

  // Computed
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  // Fetch customers
  useEffect(() => {
    fetch('/api/contacts?type=customer&status=active&limit=100')
      .then((r) => r.json())
      .then((json) => setCustomers(Array.isArray(json.data) ? json.data : []))
      .catch(() => {});
  }, []);

  const filteredCustomers = customers.filter(
    (c) =>
      !customerSearch ||
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.companyName ?? '').toLowerCase().includes(customerSearch.toLowerCase())
  );

  // Terms handlers
  function setTermsAndDate(term: string) {
    setTerms(term);
    const days = term === 'Net 15' ? 15 : term === 'Net 30' ? 30 : term === 'Net 60' ? 60 : 0;
    if (days > 0) {
      setDueDate(format(addDays(new Date(issueDate), days), 'yyyy-MM-dd'));
    }
  }

  // Line item handlers
  function updateLine(key: string, field: keyof LineItem, value: any) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          updated.amount = updated.quantity * updated.unitPrice;
        }
        return updated;
      })
    );
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  // Save / Send
  async function handleSave(newStatus: 'draft' | 'sent') {
    if (!selectedCustomer) {
      setError('Please select a customer.');
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      setError('All line items need a description.');
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      customerId: selectedCustomer.id,
      issueDate,
      dueDate,
      terms,
      subtotal,
      taxRate,
      taxAmount,
      total,
      status: newStatus,
      notes: notes.trim() || null,
      lineItems: lines.map((l, i) => ({
        description: l.description.trim(),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.amount,
        categoryId: l.categoryId,
        sortOrder: i,
      })),
    };

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Save failed');
      }

      const json = await res.json();
      if (newStatus === 'sent') {
        setToast({ message: `Invoice ${json.data.id} created and sent.`, type: 'success' });
      } else {
        setToast({ message: `Invoice ${json.data.id} saved as draft.`, type: 'success' });
      }
      setTimeout(() => router.push(`/invoices/${json.data.id}`), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell companyName="Northwind Trading" companyPlan="Business">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/invoices')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="t-h1">New Invoice</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Create a new invoice for a customer.</p>
        </div>
        <Badge variant={status === 'draft' ? 'draft' : 'pending'}>{status === 'draft' ? 'Draft' : 'Sent'}</Badge>
        <Button variant="secondary" onClick={() => handleSave('draft')} disabled={saving}>
          <Save size={16} /> Save Draft
        </Button>
        <Button onClick={() => handleSave('sent')} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          Send Invoice
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* Left column — Customer + Line items */}
        <div className="space-y-5">
          {/* Customer selection */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">
              Bill To
            </label>
            {selectedCustomer ? (
              <div className="flex items-center gap-3">
                <div className="w-[38px] h-[38px] rounded-full bg-[var(--primary)] text-white grid place-items-center font-bold text-sm">
                  {selectedCustomer.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[var(--text-strong)]">
                    {selectedCustomer.companyName || selectedCustomer.name}
                  </div>
                  {selectedCustomer.companyName && (
                    <div className="text-xs text-[var(--text-muted)]">{selectedCustomer.name}</div>
                  )}
                  {selectedCustomer.email && (
                    <div className="text-xs text-[var(--text-muted)]">{selectedCustomer.email}</div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="w-7 h-7 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--danger)]"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search customers..."
                    value={customerSearch}
                    onChange={(e) => { setCustomerSearch(e.target.value); setCustomerOpen(true); }}
                    onFocus={() => setCustomerOpen(true)}
                    className="w-full h-[var(--control-h)] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
                  />
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                </div>
                {customerOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-lg)] z-20 max-h-[200px] overflow-y-auto">
                    {filteredCustomers.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
                        No customers found.
                      </div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-[var(--surface-3)] transition-colors"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerSearch('');
                            setCustomerOpen(false);
                          }}
                        >
                          <div className="w-[30px] h-[30px] rounded-full bg-[var(--primary)] text-white grid place-items-center font-bold text-xs flex-none">
                            {c.name.charAt(0)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-[var(--text-strong)]">
                              {c.companyName || c.name}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">{c.email}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {(customerOpen && filteredCustomers.length > 0) && (
                  <div className="fixed inset-0 z-10" onClick={() => setCustomerOpen(false)} />
                )}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] flex items-center gap-4">
              <span className="flex-1">Item</span>
              <span className="w-[80px] text-right">Qty</span>
              <span className="w-[120px] text-right">Price</span>
              <span className="w-[120px] text-right">Amount</span>
              <span className="w-[40px]" />
            </div>

            <div className="divide-y divide-[var(--border)]">
              {lines.map((line) => (
                <div key={line.key} className="flex items-center gap-4 px-5 py-3">
                  <input
                    type="text"
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, 'description', e.target.value)}
                    className="flex-1 h-[34px] px-2 rounded-md border border-transparent bg-transparent text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)]"
                  />
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={line.quantity || ''}
                    onChange={(e) => updateLine(line.key, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-[80px] h-[34px] px-2 text-right rounded-md border border-transparent bg-transparent font-mono text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice || ''}
                    onChange={(e) => updateLine(line.key, 'unitPrice', parseFloat(e.target.value) || 0)}
                    className="w-[120px] h-[34px] px-2 text-right rounded-md border border-transparent bg-transparent font-mono text-sm text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)] focus:bg-[var(--surface-2)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="w-[120px] text-right font-mono tabular-nums text-sm font-medium text-[var(--text-strong)]">
                    {money(line.amount)}
                  </span>
                  <button
                    onClick={() => removeLine(line.key)}
                    className="w-[34px] h-[34px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-[var(--border)]">
              <Button variant="ghost" size="sm" onClick={addLine}>
                <Plus size={14} /> Add Line
              </Button>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">
              Notes
            </label>
            <textarea
              rows={3}
              placeholder="Payment instructions or internal notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)] resize-none"
            />
          </div>
        </div>

        {/* Right column — Summary */}
        <div className="space-y-4">
          {/* Dates & Terms */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5 space-y-4">
            <div className="field">
              <label>Issue Date</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="input"
              />
            </div>
            <div className="field">
              <label>Payment Terms</label>
              <div className="grid grid-cols-3 gap-2">
                {['Net 15', 'Net 30', 'Net 60'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTermsAndDate(t)}
                    className={cn(
                      'py-2 px-2 text-xs font-semibold rounded-md border transition-all',
                      terms === t
                        ? 'border-[var(--border-focus)] bg-[var(--primary-soft)] text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Totals */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <h3 className="font-semibold text-[var(--text-strong)] text-sm">Invoice Total</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">Subtotal</span>
                <span className="font-mono tabular-nums text-[var(--text-strong)]">{money(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-muted)]">Tax Rate</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
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
                <span className="font-mono tabular-nums text-lg font-semibold text-[var(--text-strong)]">
                  {money(total)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="toast-stack">
          <div className={cn('toast', toast.type === 'danger' && 'danger')}>
            <span className="t-ico">
              {toast.type === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </span>
            <div className="t-body"><div>{toast.message}</div></div>
            <button className="t-close" onClick={() => setToast(null)}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
