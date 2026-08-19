'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Alert } from '@/components/ui/Alert';
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { N } from '@/lib/fx-format';
import FxBreakdownCard, { type SettlementPreviewData } from '@/components/fx/FxBreakdownCard';
import JournalPreview from '@/components/fx/JournalPreview';

interface InvoiceData {
  id: string;
  currency: string;
  fxRate: string | null;
  fxRateDate: string | null;
  total: string;
  paidAmount: string;
  totalHome: string | null;
  paidAmountHome: string;
  status: string;
  customer?: { name: string; companyName?: string | null };
}

interface AccountOption {
  id: string;
  name: string;
  mask?: string | null;
  kind: string;
  currency?: string;
  glAccountCode?: string | null;
}

export default function ReceivePaymentPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<SettlementPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/invoices/${params.id}`).then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
    ]).then(([invJson, accJson]) => {
      setInvoice(invJson.data ?? null);
      const list: AccountOption[] = accJson.data ?? [];
      setAccounts(list);
      if (list.length) setAccountId(list[0].id);
    });
  }, [params.id]);

  const remainingForeign = invoice
    ? Math.max(0, Number(invoice.total) - Number(invoice.paidAmount))
    : 0;

  // Debounced preview
  useEffect(() => {
    if (!invoice || !Number.isFinite(parseFloat(amount)) || parseFloat(amount) <= 0 || !accountId || invoice.status === 'paid') {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ invoiceId: invoice.id, amount: String(amount), date, accountId });
      fetch(`/api/fx/settlement-preview?${params.toString()}`)
        .then(async (r) => {
          const json = await r.json();
          if (!r.ok) {
            setPreview(null);
            setError(json.error ?? 'Failed to preview');
            return;
          }
          setError(null);
          setPreview(json.data);
        })
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [invoice, amount, date, accountId]);

  if (!invoice) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      </AppShell>
    );
  }

  const account = accounts.find((a) => a.id === accountId);
  const invoiceRate = invoice.fxRate ? Number(invoice.fxRate) : 1;
  const outstandingHome = invoice.totalHome ? Number(invoice.totalHome) - Number(invoice.paidAmountHome) : remainingForeign * invoiceRate;

  async function recordPayment() {
    if (!preview) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice!.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: preview.amountForeign, currency: invoice!.currency, date, accountId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to record payment');
      setPosted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  if (posted) {
    return (
      <AppShell>
        <div className="max-w-[560px] mx-auto py-16 text-center">
          <CheckCircle2 size={40} className="mx-auto text-[var(--success)] mb-4" />
          <h1 className="text-xl font-bold text-[var(--text-strong)]">Payment recorded</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {preview ? `${N(preview.amountForeign, { zeroDecimals: invoice.currency === 'JPY' || invoice.currency === 'INR' })} ${invoice.currency} applied to ${invoice.id}` : ''}
          </p>
          <button onClick={() => router.push(`/invoices/${invoice.id}`)} className="mt-6 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]">
            Back to invoice
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push(`/invoices/${invoice.id}`)}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Sales &amp; Invoices <span className="text-[var(--text-faint)]">›</span> {invoice.id} <span className="text-[var(--text-faint)]">›</span>{' '}
          <strong className="text-[var(--text-strong)] font-semibold">Receive Payment</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Receive payment — {invoice.currency}</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px] mb-6">
        The rate has moved since the invoice was raised. The difference is a realized gain or loss — shown in full before anything is posted.
      </p>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="grid grid-cols-[1fr_420px] gap-6 max-[1100px]:grid-cols-1">
        {/* Left column */}
        <div className="space-y-5">
          {/* Invoice strip */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-3">Invoice being paid · {invoice.id}</div>
            <div className="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <div className="text-xs text-[var(--text-faint)]">Customer</div>
                <div className="text-[var(--text-strong)] font-medium mt-0.5">{invoice.customer?.companyName || invoice.customer?.name || 'Customer'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-faint)]">Raised</div>
                <div className="font-mono text-[var(--text)] mt-0.5">{invoice.fxRateDate ? `${String(invoice.fxRateDate).slice(0, 10)} @ ${Number(invoice.fxRate).toFixed(4)}` : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-faint)]">Outstanding</div>
                <div className="font-mono text-[var(--text-strong)] font-medium mt-0.5">{N(remainingForeign, { zeroDecimals: invoice.currency === 'JPY' || invoice.currency === 'INR' })} {invoice.currency}</div>
                <div className="font-mono text-[11px] text-[var(--text-faint)]">carried at {N(outstandingHome, { suffix: 'CAD' })}</div>
              </div>
            </div>
          </div>

          {/* Payment form */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 space-y-4">
            <div>
              <label className="text-xs text-[var(--text-muted)]">Amount received ({invoice.currency})</label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(remainingForeign)}
                className="w-full mt-1 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2.5 font-mono text-[19px] text-[var(--text-strong)] outline-none focus:border-[var(--border-focus)]"
              />
              {preview && (
                <div className="font-mono text-[11.5px] text-[var(--text-muted)] mt-1.5">
                  ≈ {N(preview.cashHome, { suffix: preview.homeCurrency })} at {preview.settlementRate.toFixed(4)}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-[var(--text-muted)]">Payment date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full mt-1 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 font-mono text-[13px] text-[var(--text-strong)] outline-none focus:border-[var(--border-focus)]"
              />
              <div className="text-[11px] text-[var(--text-faint)] mt-1">Rate is taken from this date, not today.</div>
            </div>

            <div>
              <label className="text-xs text-[var(--text-muted)]">Deposit to</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full mt-1 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-strong)] outline-none"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {a.glAccountCode ?? '—'}</option>
                ))}
              </select>
              {account && (
                <div className="text-[11px] text-[var(--text-faint)] mt-1">
                  {account.currency === invoice.currency
                    ? `A ${account.currency} account, so no conversion on deposit.`
                    : `Deposits convert to ${account.currency ?? 'CAD'} at the settlement rate.`}
                </div>
              )}
            </div>

            {preview && (
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1.5">Settlement rate</label>
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[22px] font-semibold tabular-nums text-[var(--text-strong)]">{preview.settlementRate.toFixed(4)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--success)]">Bank of Canada</span>
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">
                    {preview.outcome === 'none'
                      ? 'Same rate as the invoice — no FX effect.'
                      : `${preview.settlementRate > preview.invoiceRate ? '+' : '−'}${Math.abs(preview.settlementRate - preview.invoiceRate).toFixed(4)} against the invoice rate of ${preview.invoiceRate.toFixed(4)}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Journal preview */}
          {previewLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : preview ? (
            <JournalPreview rows={preview.journal} homeCurrency={preview.homeCurrency} />
          ) : null}
        </div>

        {/* Right column — FX breakdown */}
        <div className="space-y-4">
          {preview ? (
            <>
              <FxBreakdownCard data={preview} totalForeign={remainingForeign} />
              <button
                onClick={recordPayment}
                disabled={posting || invoice.status === 'paid'}
                className="w-full rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-3 transition-all active:translate-y-[1px] flex items-center justify-center gap-2"
              >
                {posting && <Loader2 size={15} className="animate-spin" />}
                {preview.outcome === 'gain'
                  ? 'Record payment and post gain'
                  : preview.outcome === 'loss'
                    ? 'Record payment and post loss'
                    : 'Record payment'}
              </button>
            </>
          ) : (
            <div className="text-center text-sm text-[var(--text-muted)] py-10 border border-dashed border-[var(--border-strong)] rounded-[var(--r-xl)]">
              Enter an amount to see the FX breakdown.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
