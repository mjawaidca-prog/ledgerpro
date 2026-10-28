'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Camera, FileText, Loader2, Paperclip, Trash2, Unlink, Check } from 'lucide-react';
import { RECEIPT_ACCEPT } from '@/lib/receipts/validate';

interface ReceiptRow {
  id: string;
  transactionId: string | null;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'inbox' | 'attached' | 'discarded';
  ocrStatus: string;
  merchant: string | null;
  date: string | null;
  total: number | null;
  taxAmount: number | null;
  confidence: number | null;
  suggestedCategoryId: string | null;
  suggestedCategoryCode: string | null;
  suggestedSource: string | null;
}

interface TxRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  account: { name: string };
}

interface CoaRow {
  id: string;
  code: string;
  name: string;
  type: string;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Math.abs(n).toFixed(2)}`;

export default function ReceiptsPage() {
  const [tab, setTab] = useState<'inbox' | 'attached' | 'all'>('inbox');
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [accounts, setAccounts] = useState<CoaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes, cRes] = await Promise.all([
        fetch(`/api/receipts?status=${tab}`),
        fetch('/api/bank-transactions?queue=1&limit=200'),
        fetch('/api/coa'),
      ]);
      const rJson = await rRes.json();
      setReceipts(rJson.data ?? []);
      const tJson = await tRes.json();
      setTransactions((tJson.data?.rows ?? []).filter((t: TxRow) => t.status !== 'reconciled'));
      const cJson = await cRes.json();
      setAccounts(cJson.data ?? []);
    } catch {
      setToast({ message: 'Failed to load receipts.', ok: false });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    setUploading(true);
    setToast(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/receipts', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed.');
      setTab('inbox');
      setToast({
        message:
          json.data.receipt.ocrStatus === 'done'
            ? 'Receipt uploaded — check the suggested fields below, then attach it to its bank transaction.'
            : 'Receipt uploaded. Text could not be read automatically, so type the merchant, date, and total before attaching.',
        ok: true,
      });
      await load();
    } catch (e: any) {
      setToast({ message: e.message || 'Upload failed.', ok: false });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-strong)]">Receipts</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Snap a photo of a receipt (or upload a PDF). LedgerPro reads the merchant, date,
            total, and tax, and suggests a category from your rules — you confirm everything
            before it touches a transaction. The image stays attached to the bank transaction
            as your audit evidence.
          </p>
        </div>

        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept={RECEIPT_ACCEPT}
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                {uploading ? 'Reading receipt…' : 'Add a receipt'}
              </Button>
              <span className="text-xs text-[var(--text-muted)]">
                JPEG, PNG, WebP, or PDF, up to 5 MB. iPhone: use “Most Compatible” (JPEG) photos.
              </span>
            </div>
            {toast && (
              <p className={`mt-3 text-sm ${toast.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {toast.message}
              </p>
            )}
          </CardBody>
        </Card>

        <div className="flex gap-2">
          {(['inbox', 'attached', 'all'] as const).map((t) => (
            <Button key={t} variant={tab === t ? 'primary' : 'secondary'} size="sm" onClick={() => setTab(t)}>
              {t === 'inbox' ? 'Inbox' : t === 'attached' ? 'Attached' : 'All'}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin" /> Loading receipts…
          </p>
        ) : receipts.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-[var(--text-muted)]">
                {tab === 'inbox'
                  ? 'No receipts waiting. Add one above — a photo from your phone works best.'
                  : 'Nothing here yet.'}
              </p>
            </CardBody>
          </Card>
        ) : (
          receipts.map((r) => (
            <ReceiptCard
              key={r.id}
              receipt={r}
              transactions={transactions}
              accounts={accounts}
              onChanged={load}
              notify={(message, ok) => setToast({ message, ok })}
            />
          ))
        )}
      </div>
    </AppShell>
  );
}

function ReceiptCard({
  receipt,
  transactions,
  accounts,
  onChanged,
  notify,
}: {
  receipt: ReceiptRow;
  transactions: TxRow[];
  accounts: CoaRow[];
  onChanged: () => Promise<void>;
  notify: (message: string, ok: boolean) => void;
}) {
  const [merchant, setMerchant] = useState(receipt.merchant ?? '');
  const [date, setDate] = useState(receipt.date ?? '');
  const [total, setTotal] = useState(receipt.total?.toString() ?? '');
  const [taxAmount, setTaxAmount] = useState(receipt.taxAmount?.toString() ?? '');
  const [categoryId, setCategoryId] = useState(receipt.suggestedCategoryId ?? '');
  const [txId, setTxId] = useState('');
  const [busy, setBusy] = useState(false);

  const expenseAccounts = accounts.filter((a) => a.type === 'expense' || a.type === 'asset' || a.type === 'liability');
  const selectedTx = transactions.find((t) => t.id === txId);
  const totalNum = total ? Number(total) : null;
  const amountMismatch =
    selectedTx && totalNum !== null && Math.abs(Math.abs(selectedTx.amount) - totalNum) > 0.01;

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/receipts/${receipt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Save failed.');
    return json.data;
  }

  async function saveFields() {
    setBusy(true);
    try {
      await patch({
        merchant: merchant || null,
        date: date || null,
        total: total === '' ? null : Number(total),
        taxAmount: taxAmount === '' ? null : Number(taxAmount),
        categoryId: categoryId || null,
      });
      notify('Receipt details saved.', true);
      await onChanged();
    } catch (e: any) {
      notify(e.message, false);
    } finally {
      setBusy(false);
    }
  }

  async function attachAndCategorize() {
    if (!txId) return;
    setBusy(true);
    try {
      // Persist any edits first so the attach uses the confirmed category.
      await patch({
        merchant: merchant || null,
        date: date || null,
        total: total === '' ? null : Number(total),
        taxAmount: taxAmount === '' ? null : Number(taxAmount),
        categoryId: categoryId || null,
      });
      const res = await fetch(`/api/receipts/${receipt.id}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Attach failed.');

      const split = json.data?.suggestedSplit;
      if (split) {
        const sRes = await fetch(`/api/bank-transactions/${txId}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ splits: [split], post: false }),
        });
        const sJson = await sRes.json();
        if (!sRes.ok) throw new Error(sJson.error || 'Attached, but categorizing failed — categorize it from Banking.');
        notify('Receipt attached and the transaction is categorized. Post it from Banking when you are ready.', true);
      } else {
        notify('Receipt attached. Pick a category for the transaction from Banking.', true);
      }
      await onChanged();
    } catch (e: any) {
      notify(e.message, false);
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/detach`, { method: 'POST' });
      if (!res.ok) throw new Error('Detach failed.');
      notify('Receipt detached and returned to the inbox.', true);
      await onChanged();
    } catch (e: any) {
      notify(e.message, false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed.');
      notify('Receipt deleted.', true);
      await onChanged();
    } catch (e: any) {
      notify(e.message, false);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1';

  return (
    <Card>
      <CardHeader>
        {receipt.mimeType === 'application/pdf' ? <FileText size={18} /> : <Paperclip size={18} />}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-strong)]">
          {receipt.originalFileName}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {receipt.ocrStatus === 'done'
            ? `Read automatically${receipt.confidence !== null ? ` · ${Math.round(receipt.confidence * 100)}% of fields found` : ''}`
            : 'Not read automatically — enter the details'}
        </span>
        <span className="rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text)]">
          {receipt.status}
        </span>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="shrink-0">
            {receipt.mimeType === 'application/pdf' ? (
              <a
                href={`/api/receipts/${receipt.id}/image`}
                target="_blank"
                rel="noreferrer"
                className="flex h-36 w-28 items-center justify-center rounded-lg border border-[var(--border)] text-xs text-[var(--text-muted)]"
              >
                Open PDF
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/receipts/${receipt.id}/image`}
                alt={receipt.originalFileName}
                className="h-36 w-28 rounded-lg border border-[var(--border)] object-cover"
              />
            )}
          </div>

          <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="col-span-2">
              <label className={labelCls}>Merchant</label>
              <input className={inputCls} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. STAPLES" />
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Total (tax incl.)</label>
              <input className={inputCls} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Tax on receipt</label>
              <input className={inputCls} inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>
                Category {receipt.suggestedSource ? `(suggested by ${receipt.suggestedSource === 'manual' ? 'you' : 'a rule'})` : ''}
              </label>
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose a category…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex items-end">
              <Button variant="secondary" size="sm" onClick={saveFields} disabled={busy}>
                <Check size={14} /> Save details
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-3">
          {receipt.status === 'attached' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--text-muted)]">
                Attached to its bank transaction — the image is saved as audit evidence.
              </span>
              <Button variant="ghost" size="sm" onClick={detach} disabled={busy}>
                <Unlink size={14} /> Detach
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select className={`${inputCls} max-w-md`} value={txId} onChange={(e) => setTxId(e.target.value)}>
                <option value="">Choose the bank transaction this receipt belongs to…</option>
                {transactions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {new Date(t.date).toLocaleDateString('en-CA')} — {t.description} — {money(t.amount)} ({t.account.name})
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={attachAndCategorize} disabled={busy || !txId}>
                <Paperclip size={14} /> Attach &amp; categorize
              </Button>
              <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
                <Trash2 size={14} /> Delete
              </Button>
              {amountMismatch && (
                <span className="text-xs text-[var(--danger)]">
                  Heads up: the receipt total ({money(totalNum)}) differs from the bank row ({money(selectedTx?.amount)}).
                  The bank amount is what gets categorized — check the receipt total before attaching.
                </span>
              )}
              <span className="text-xs text-[var(--text-muted)]">Receipt total: {money(receipt.total)}</span>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
