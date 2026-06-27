'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money } from '@/lib/money';
import { format } from 'date-fns';
import {
  Building2, CreditCard, Plus, Upload, Search, Check, X, ArrowRightLeft, FileText,
  Loader2, ChevronDown, FileUp, AlertTriangle, MoreHorizontal,
} from 'lucide-react';

// ─── Types ───

interface FinancialAccount {
  id: string;
  name: string;
  mask: string | null;
  kind: 'checking' | 'savings' | 'creditcard' | 'paypal' | 'clearing';
  currentBalance: number;
  syncStatus: string;
  displayColor: string | null;
  logoInitials: string | null;
  pendingReviewCount: number;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  status: 'toreview' | 'categorized' | 'excluded' | 'transfer' | 'reconciled';
  account: { id: string; name: string; mask: string | null; kind: string };
  category: { id: string; code: string; name: string } | null;
  transferMatch: { id: string; confirmed: boolean } | null;
}

interface TransferSuggestion {
  outflowTx: Transaction;
  inflowTx: Transaction;
  matchedAmount: number;
}

// ─── Category options ───

const quickCategories = [
  { code: '6100', name: 'Software & Subscriptions' },
  { code: '6200', name: 'Professional Fees' },
  { code: '6300', name: 'Rent & Lease' },
  { code: '6400', name: 'Marketing' },
  { code: '6500', name: 'Travel' },
  { code: '6600', name: 'Utilities' },
  { code: '5000', name: 'Cost of Goods Sold' },
  { code: '4000', name: 'Product Sales' },
  { code: '4100', name: 'Service Revenue' },
];

// ─── Import Wizard Steps ───

type WizardStep = 'account' | 'map' | 'review';

export default function BankingPage() {
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<TransferSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'danger' } | null>(null);

  // Filters
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState('needsreview');
  const [search, setSearch] = useState('');

  // Import wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('account');
  const [wizardAccountId, setWizardAccountId] = useState<string>('');
  const [wizardFile, setWizardFile] = useState<File | null>(null);
  const [wizardParsed, setWizardParsed] = useState<any>(null);
  const [wizardMappings, setWizardMappings] = useState<Record<string, string>>({});
  const [wizardPreview, setWizardPreview] = useState<any[]>([]);
  const [wizardSignDirection, setWizardSignDirection] = useState<'normal' | 'inverted'>('normal');
  const [wizardImporting, setWizardImporting] = useState(false);

  // ─── Fetch data ───

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts');
      const json = await res.json();
      setAccounts(Array.isArray(json.data) ? json.data : []);
    } catch {
      setAccounts([]);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId);
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '100');

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const json = await res.json();
      setTransactions(Array.isArray(json.data) ? json.data : []);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }, [selectedAccountId, statusFilter, search]);

  const fetchTransfers = useCallback(async () => {
    try {
      const res = await fetch('/api/transfers');
      const json = await res.json();
      setTransfers(Array.isArray(json.data) ? json.data : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchTransfers()]).finally(() => setLoading(false));
  }, [fetchAccounts, fetchTransfers]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // ─── Transaction actions ───

  const [postingGL, setPostingGL] = useState(false);

  async function postToGL() {
    const categorized = transactions.filter((t) => t.status === 'categorized');
    if (categorized.length === 0) {
      setToast({ message: 'No categorized transactions to post', type: 'danger' });
      return;
    }
    setPostingGL(true);
    try {
      const res = await fetch('/api/transactions/post-gl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: categorized.map((t) => t.id) }),
      });
      const json = await res.json();
      setToast({ message: `Posted ${json.data.posted} transactions to General Ledger`, type: 'success' });
      fetchTransactions();
      fetchAccounts();
    } catch {
      setToast({ message: 'Failed to post to GL', type: 'danger' });
    } finally {
      setPostingGL(false);
    }
  }

  async function categorizeTransaction(txId: string, categoryId: string) {
    try {
      await fetch(`/api/transactions/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
      fetchTransactions();
    } catch {
      setToast({ message: 'Failed to categorize', type: 'danger' });
    }
  }

  async function excludeTransaction(txId: string, reason: string) {
    try {
      await fetch(`/api/transactions/${txId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'excluded', excludeReason: reason }),
      });
      fetchTransactions();
    } catch {
      setToast({ message: 'Failed to exclude', type: 'danger' });
    }
  }

  async function confirmTransfer(outflowId: string, inflowId: string) {
    try {
      await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outflowTxId: outflowId, inflowTxId: inflowId }),
      });
      setToast({ message: 'Transfer confirmed.', type: 'success' });
      fetchTransactions();
      fetchTransfers();
    } catch {
      setToast({ message: 'Failed to confirm transfer', type: 'danger' });
    }
  }

  // ─── Import wizard ───

  function openWizard() {
    setWizardStep('account');
    setWizardAccountId(accounts[0]?.id ?? '');
    setWizardFile(null);
    setWizardParsed(null);
    setWizardMappings({});
    setWizardPreview([]);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
  }

  async function handleFileDrop(file: File) {
    setWizardFile(file);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/import/parse', { method: 'POST', body: formData });
      const json = await res.json();
      setWizardParsed(json.data || null);

      // Auto-map common column names
      const auto: Record<string, string> = {};
      const headers: string[] = json.data.headers || [];
      for (const h of headers) {
        const lower = h.toLowerCase();
        if (lower.includes('date') && !auto.date) auto.date = h;
        else if ((lower.includes('description') || lower.includes('name') || lower.includes('memo') || lower.includes('particulars') || lower.includes('details')) && !auto.description) auto.description = h;
        else if ((lower.includes('amount') || lower.includes('value') || lower.includes('sum')) && !auto.amount && !lower.includes('balance')) auto.amount = h;
        else if ((lower.includes('withdrawal') || lower.includes('debit') || lower.includes('payment') || lower.includes('money out') || lower.includes('outflow')) && !auto.debit) auto.debit = h;
        else if ((lower.includes('deposit') || lower.includes('credit') || lower.includes('receipt') || lower.includes('money in') || lower.includes('inflow')) && !auto.credit) auto.credit = h;
        else if (lower.includes('balance') && !auto.balance) auto.balance = h;
      }

      setWizardMappings(auto);

      // PDF: parser already extracts fields — skip mapping, go straight to preview
      if (json.data?.fileType === 'pdf') {
        generatePreviewFromMappings(auto, json.data);
      } else {
        setWizardStep('map');
      }
    } catch {
      setToast({ message: 'Failed to parse file', type: 'danger' });
    }
  }

  function generatePreviewFromMappings(mappings: Record<string, string>, parsed: any) {
    if (!parsed) return;
    const { rows } = parsed;
    const { date, description, amount, debit, credit } = mappings;

    const preview = rows.slice(0, 10).map((row: any) => {
      let amt = 0;
      if (amount && row.raw[amount]) {
        amt = parseFloat(String(row.raw[amount]).replace(/[$,]/g, '')) || 0;
      } else if (debit && credit) {
        const dr = parseFloat(String(row.raw[debit] || '0').replace(/[$,]/g, '') || '0') || 0;
        const cr = parseFloat(String(row.raw[credit] || '0').replace(/[$,]/g, '') || '0') || 0;
        amt = cr - dr;
      }

      // Apply sign direction for credit cards
      if (wizardSignDirection === 'inverted') amt = -amt;

      return {
        date: row.raw[date] ?? '',
        description: row.raw[description] ?? '',
        amount: amt,
      };
    });

    setWizardPreview(preview);
    setWizardStep('review');
  }

  function generatePreview() {
    generatePreviewFromMappings(wizardMappings, wizardParsed);
  }

  async function confirmImport() {
    if (!wizardParsed) return;
    setWizardImporting(true);

    const { rows } = wizardParsed;
    const { date, description, amount, debit, credit } = wizardMappings;

    const mappedRows = rows.map((row: any) => {
      let amt = 0;
      if (amount && row.raw[amount]) {
        amt = parseFloat(row.raw[amount].replace(/[$,]/g, '')) || 0;
      } else if (debit && credit) {
        const dr = parseFloat(row.raw[debit]?.replace(/[$,]/g, '') || '0') || 0;
        const cr = parseFloat(row.raw[credit]?.replace(/[$,]/g, '') || '0') || 0;
        amt = cr - dr;
      }
      if (wizardSignDirection === 'inverted') amt = -amt;

      return {
        date: row.raw[date] ?? '',
        description: row.raw[description] ?? '',
        amount: String(amt),
      };
    });

    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: wizardAccountId,
          mappedRows,
          skipDuplicates: true,
        }),
      });
      const json = await res.json();
      setToast({
        message: `Imported ${json.data.importedCount} transactions. ${json.data.duplicatesSkipped} duplicates skipped.`,
        type: 'success',
      });
      closeWizard();
      fetchAccounts();
      fetchTransactions();
    } catch {
      setToast({ message: 'Import failed', type: 'danger' });
    } finally {
      setWizardImporting(false);
    }
  }

  // ─── Account card helpers ───

  function accountIcon(kind: string) {
    const cls = 'w-5 h-5';
    if (kind === 'creditcard') return <CreditCard className={cls} />;
    return <Building2 className={cls} />;
  }

  function accountColor(kind: string, color: string | null) {
    if (color) return color;
    return kind === 'creditcard' ? '#7c3aed' : '#1f6feb';
  }

  // ─── Render ───

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
          <Loader2 size={24} className="animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="content-head">
        <div>
          <h1 className="greet">Banking</h1>
          <p className="sub">Review, categorize, and reconcile transactions.</p>
        </div>
        <div className="spacer" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={postToGL} disabled={postingGL}>
            {postingGL ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            Post to GL
          </Button>
          <Button onClick={openWizard}>
            <Upload size={16} /> Import Statement
          </Button>
        </div>
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {accounts.map((acct) => (
          <button
            key={acct.id}
            onClick={() => setSelectedAccountId(acct.id)}
            className={cn(
              'text-left bg-[var(--surface)] border rounded-2xl p-5 shadow-[var(--shadow-sm)] transition-all',
              'hover:shadow-[var(--shadow-md)] hover:border-[var(--border-strong)]',
              selectedAccountId === acct.id
                ? 'border-[var(--border-focus)] ring-1 ring-[var(--ring)]'
                : 'border-[var(--border)]'
            )}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-[36px] h-[36px] rounded-lg grid place-items-center text-white"
                style={{ background: accountColor(acct.kind, acct.displayColor) }}
              >
                {accountIcon(acct.kind)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--text-strong)] truncate">
                  {acct.name}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono">
                  {acct.kind.replace('_', ' ')} {acct.mask && `· ••${acct.mask}`}
                </div>
              </div>
            </div>
            <div className="font-mono tabular-nums text-xl font-semibold text-[var(--text-strong)]">
              {money(acct.currentBalance)}
            </div>
            {acct.pendingReviewCount > 0 && (
              <div className="mt-2">
                <Badge variant="pending">{acct.pendingReviewCount} to review</Badge>
              </div>
            )}
          </button>
        ))}

        {/* Connect account card */}
        <button
          onClick={openWizard}
          className="text-left bg-[var(--surface)] border border-dashed border-[var(--border-strong)] rounded-2xl p-5 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--text-faint)] transition-colors min-h-[140px]"
        >
          <Plus size={24} />
          <span className="text-sm font-medium">Connect Account</span>
          <span className="text-xs">or import a statement</span>
        </button>
      </div>

      {/* Transfer suggestions */}
      {transfers.length > 0 && (
        <Alert variant="warning" className="mb-4">
          <span className="font-medium">
            {transfers.length} potential transfer{transfers.length !== 1 ? 's' : ''} detected.
          </span>{' '}
          Review below — these may be credit card payments, not duplicate expenses.
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>
        <Segmented
          options={[
            { value: 'needsreview', label: 'To Review' },
            { value: 'categorized', label: 'Categorized' },
            { value: 'excluded', label: 'Excluded' },
            { value: 'transfer', label: 'Transfers' },
            { value: 'all', label: 'All' },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <div className="flex-1" />
        <span className="text-sm text-[var(--text-muted)]">
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Transaction list */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--border)] font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)]">
          <span className="w-[110px]">Date</span>
          <span className="flex-1">Description</span>
          <span className="w-[160px]">Category</span>
          <span className="w-[120px] text-right">Amount</span>
          <span className="w-[180px]">Status</span>
        </div>

        <div className="divide-y divide-[var(--border)] max-h-[600px] overflow-y-auto">
          {txLoading ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">
              No transactions found.
            </div>
          ) : (
            transactions.map((tx) => {
              const isTransfer = tx.status === 'transfer' || tx.transferMatch;
              const isExcluded = tx.status === 'excluded';

              return (
                <div
                  key={tx.id}
                  className={cn(
                    'flex items-center gap-4 px-5 py-3 hover:bg-[var(--surface-2)] transition-colors',
                    isTransfer && 'bg-[var(--warning-soft)]',
                    isExcluded && 'opacity-50'
                  )}
                >
                  {/* Date */}
                  <span className="w-[110px] text-sm text-[var(--text)] font-mono">
                    {format(new Date(tx.date), 'MMM d, yyyy')}
                  </span>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-strong)] truncate">
                      {tx.merchant || tx.description}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                      {tx.account.name}
                    </div>
                  </div>

                  {/* Category dropdown */}
                  <div className="w-[160px]">
                    {tx.status === 'toreview' ? (
                      <select
                        className="w-full h-[30px] px-2 text-xs rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)]"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) categorizeTransaction(tx.id, e.target.value);
                        }}
                      >
                        <option value="">Categorize...</option>
                        {quickCategories.map((cat) => (
                          <option key={cat.code} value={cat.code}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    ) : tx.category ? (
                      <span className="inline-flex items-center gap-[6px] text-xs font-mono text-[var(--text-muted)]">
                        <span className="w-[7px] h-[7px] rounded-full bg-[var(--primary)]" />
                        {tx.category.code} — {tx.category.name}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-faint)]">—</span>
                    )}
                  </div>

                  {/* Amount */}
                  <span
                    className={cn(
                      'w-[120px] text-right font-mono tabular-nums text-sm font-semibold',
                      Number(tx.amount) < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                    )}
                  >
                    {money(Number(tx.amount), true)}
                  </span>

                  {/* Status + actions */}
                  <div className="w-[180px] flex items-center gap-2">
                    {isTransfer ? (
                      <Badge variant="pending">Transfer</Badge>
                    ) : tx.status === 'categorized' ? (
                      <Badge variant="paid">Categorized</Badge>
                    ) : tx.status === 'excluded' ? (
                      <Badge variant="draft">Excluded</Badge>
                    ) : tx.status === 'reconciled' ? (
                      <Badge variant="info">Reconciled</Badge>
                    ) : (
                      <Badge variant="pending">To Review</Badge>
                    )}

                    {tx.status === 'toreview' && (
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          onClick={() => excludeTransaction(tx.id, 'Personal')}
                          className="w-[28px] h-[28px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                          title="Exclude"
                        >
                          <X size={13} />
                        </button>
                        <button
                          onClick={() => categorizeTransaction(tx.id, quickCategories[0].code)}
                          className="w-[28px] h-[28px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--success)] hover:border-[var(--success)] transition-colors"
                          title="Accept"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── Transfer suggestions section ─── */}
      {transfers.length > 0 && (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <h3 className="t-h3">
                <ArrowRightLeft size={16} className="inline mr-2" />
                Transfer Matches
              </h3>
              <div className="spacer" />
              <span className="text-xs text-[var(--text-muted)]">
                Matched by amount + date — these are credit card payments, not expenses
              </span>
            </CardHeader>
            <div className="divide-y divide-[var(--border)]">
              {transfers.map((match, idx) => (
                <div key={idx} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1">
                    <div className="text-sm text-[var(--text-strong)] font-medium">
                      {match.outflowTx.description}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--danger)] font-mono">
                        {money(Number(match.outflowTx.amount))} — {match.outflowTx.account.name}
                      </span>
                      <ArrowRightLeft size={14} className="text-[var(--text-faint)]" />
                      <span className="text-xs text-[var(--success)] font-mono">
                        {money(Number(match.inflowTx.amount))} — {match.inflowTx.account.name}
                      </span>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-strong)]">
                    {money(match.matchedAmount)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => confirmTransfer(match.outflowTx.id, match.inflowTx.id)}
                  >
                    <ArrowRightLeft size={14} /> Confirm Transfer
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ─── Import Wizard Modal ─── */}
      {wizardOpen && (
        <>
          <div className="fixed inset-0 z-90 bg-black/40 backdrop-blur-sm" onClick={closeWizard} />

          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-100 w-full max-w-[640px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
              <h2 className="t-h3 flex-1">Import Statement</h2>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  wizardStep === 'account' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>1</span>
                <span className="w-4 h-px bg-[var(--border)]" />
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  wizardStep === 'map' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>2</span>
                <span className="w-4 h-px bg-[var(--border)]" />
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  wizardStep === 'review' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>3</span>
              </div>
              <button onClick={closeWizard}
                className="w-8 h-8 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]">
                <X size={16} />
              </button>
            </div>

            {/* Step 1 — Account & File */}
            {wizardStep === 'account' && (
              <div className="p-5 space-y-4">
                <div className="field">
                  <label>Account</label>
                  <select
                    className="select"
                    value={wizardAccountId}
                    onChange={(e) => setWizardAccountId(e.target.value)}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.kind.replace('_', ' ')}) · {money(a.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Drop zone */}
                <div
                  className="border-2 border-dashed border-[var(--border-strong)] rounded-xl p-10 text-center hover:border-[var(--border-focus)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileDrop(file);
                  }}
                  onClick={() => {
                    const input = document.getElementById('wizard-file-input') as HTMLInputElement;
                    input?.click();
                  }}
                >
                  <FileUp size={40} className="mx-auto text-[var(--text-faint)] mb-3" />
                  <div className="text-sm font-semibold text-[var(--text-strong)] mb-1">
                    Drop your statement here
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    CSV, OFX, QFX, or PDF bank statement — up to 10 MB
                  </div>
                  <input
                    id="wizard-file-input"
                    type="file"
                    accept=".csv,.ofx,.qfx,.txt,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileDrop(file);
                    }}
                  />
                </div>
              </div>
            )}

            {/* Step 2 — Map columns */}
            {wizardStep === 'map' && wizardParsed && (
              <div className="p-5 space-y-4">
                <div className="text-sm text-[var(--text-muted)] mb-2">
                  Map your statement columns to LedgerPro fields.
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'date', label: 'Date' },
                    { key: 'description', label: 'Description' },
                    { key: 'amount', label: 'Amount (signed)' },
                    { key: 'debit', label: 'Debit Column' },
                    { key: 'credit', label: 'Credit Column' },
                    { key: 'balance', label: 'Balance (optional)' },
                  ].map((field) => (
                    <div className="field" key={field.key}>
                      <label>{field.label}</label>
                      <select
                        className="select"
                        value={wizardMappings[field.key] || ''}
                        onChange={(e) =>
                          setWizardMappings({ ...wizardMappings, [field.key]: e.target.value })
                        }
                      >
                        <option value="">— Ignore —</option>
                        {wizardParsed.headers.map((h: string) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Sign direction for credit cards */}
                <div className="field">
                  <label>Sign Direction</label>
                  <Segmented
                    options={[
                      { value: 'normal', label: 'Normal (bank)' },
                      { value: 'inverted', label: 'Inverted (credit card)' },
                    ]}
                    value={wizardSignDirection}
                    onChange={(v) => setWizardSignDirection(v as 'normal' | 'inverted')}
                  />
                  <span className="hint mt-1">
                    Credit card charges are positive on statements but are outflows. Select "Inverted" to flip the sign.
                  </span>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setWizardStep('account')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                  <Button
                    onClick={generatePreview}
                    disabled={!wizardMappings.date || (!wizardMappings.amount && !(wizardMappings.debit && wizardMappings.credit))}
                  >
                    Preview & Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3 — Review & Confirm */}
            {wizardStep === 'review' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4 text-sm">
                  <div className="bg-[var(--success-soft)] px-3 py-2 rounded-lg">
                    <span className="font-semibold text-[var(--success)]">{wizardParsed?.totalRows}</span>
                    <span className="text-[var(--text-muted)] ml-1">transactions found</span>
                  </div>
                  {wizardPreview.length > 0 && (
                    <div className="text-[var(--text-muted)]">
                      Date range: {wizardPreview[0]?.date ?? '—'} — {wizardPreview[wizardPreview.length - 1]?.date ?? '—'}
                    </div>
                  )}
                  <Badge variant="info">{wizardParsed?.fileType?.toUpperCase()}</Badge>
                </div>

                {/* Parse warnings */}
                {wizardParsed?.errors?.length > 0 && (
                  <Alert variant="warning">
                    <ul className="list-disc ml-4 text-xs">
                      {wizardParsed.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </Alert>
                )}

                {/* Low confidence flag for PDF */}
                {wizardParsed?.fileType === 'pdf' && (
                  <p className="text-xs text-[var(--text-muted)]">
                    ⚠️ PDF parsing is best-effort. Please review all transactions carefully before importing.
                  </p>
                )}

                {/* Preview table */}
                <div className="border border-[var(--border)] rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--surface-2)]">
                        <th className="text-left px-3 py-2 font-mono text-micro uppercase text-[var(--text-muted)]">Date</th>
                        <th className="text-left px-3 py-2 font-mono text-micro uppercase text-[var(--text-muted)]">Description</th>
                        <th className="text-right px-3 py-2 font-mono text-micro uppercase text-[var(--text-muted)]">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wizardPreview.map((row: any, i: number) => (
                        <tr key={i} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2 font-mono">{row.date}</td>
                          <td className="px-3 py-2 truncate max-w-[300px]">{row.description}</td>
                          <td className={cn(
                            'px-3 py-2 text-right font-mono tabular-nums',
                            row.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                          )}>
                            {money(row.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setWizardStep(wizardParsed?.fileType === 'pdf' ? 'account' : 'map')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                  <Button onClick={confirmImport} disabled={wizardImporting}>
                    {wizardImporting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    Import {wizardParsed?.totalRows} Transactions
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-stack">
          <div className={cn('toast', toast.type === 'danger' && 'danger')}>
            <span className="t-ico">
              {toast.type === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
              )}
            </span>
            <div className="t-body"><div>{toast.message}</div></div>
            <button className="t-close" onClick={() => setToast(null)}><X size={15} /></button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
