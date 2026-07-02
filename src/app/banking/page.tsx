'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
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
  kind: 'checking' | 'savings' | 'creditcard' | 'payoutclearing';
  currentBalance: number;
  glAccountCode: string | null;
  syncStatus: string;
  displayColor: string | null;
  logoInitials: string | null;
  pendingReviewCount: number;
}

interface ChartAccount {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  detailType: string | null;
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

// ─── Import Wizard Steps ───

type WizardStep = 'account' | 'map' | 'review';

export default function BankingPage() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [chartAccounts, setChartAccounts] = useState<ChartAccount[]>([]);
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
  const [wizardFiles, setWizardFiles] = useState<File[]>([]);
  const [wizardParsed, setWizardParsed] = useState<any>(null);
  const [wizardMappings, setWizardMappings] = useState<Record<string, string>>({});
  const [wizardPreview, setWizardPreview] = useState<any[]>([]);
  const [wizardSignDirection, setWizardSignDirection] = useState<'normal' | 'inverted'>('normal');
  const [wizardPdfAmbiguousSign, setWizardPdfAmbiguousSign] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardAccountName, setWizardAccountName] = useState('Primary Checking');
  const [wizardAccountKind, setWizardAccountKind] = useState<FinancialAccount['kind']>('checking');
  const [wizardCreatingAccount, setWizardCreatingAccount] = useState(false);
  const activeCompanyId = (session?.user as any)?.activeCompanyId || (session?.user as any)?.companyId || null;
  const activeUserId = (session?.user as any)?.id || null;

  function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function resolveCompanyId() {
    return activeCompanyId || getCookie('lp-active-company-id') || null;
  }

  function resolveTenantHeaders() {
    const companyId = resolveCompanyId();
    const headers: Record<string, string> = {};
    if (companyId) headers['x-company-id'] = String(companyId);
    if (activeUserId) headers['x-user-id'] = String(activeUserId);
    return headers;
  }
  const selectedCompanyId = resolveCompanyId();
  const hasSelectedCompany = Boolean(selectedCompanyId);

  async function fetchWithTenantHeaders(input: RequestInfo | URL, init?: RequestInit) {
    const headers = {
      ...(init?.headers || {}),
      ...resolveTenantHeaders(),
    } as Record<string, string>;
    const res = await fetch(input, { ...init, headers });
    if (res.status !== 401) return res;

    await new Promise((resolve) => setTimeout(resolve, 250));
    const retryHeaders = {
      ...(init?.headers || {}),
      ...resolveTenantHeaders(),
    } as Record<string, string>;
    return fetch(input, { ...init, headers: retryHeaders });
  }

  async function createWizardAccount() {
    if (wizardCreatingAccount) return null;
    if (!hasSelectedCompany) {
      setToast({ message: 'Select a company before creating a bank account for imports.', type: 'danger' });
      return null;
    }
    setWizardCreatingAccount(true);
    try {
      const name = wizardAccountName.trim() || 'Primary Checking';
      const glAccountCode = resolveDefaultBankGlCode(wizardAccountKind);
      const res = await fetchWithTenantHeaders('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          kind: wizardAccountKind,
          glAccountCode,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to create account');
      }
      const created = json.data as FinancialAccount;
      setAccounts((prev) => [...prev, created]);
      setWizardAccountId(created.id);
      setToast({ message: `Created ${created.name} for this import.`, type: 'success' });
      return created;
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Failed to create account', type: 'danger' });
      return null;
    } finally {
      setWizardCreatingAccount(false);
    }
  }

  function resolveDefaultBankGlCode(kind: FinancialAccount['kind']) {
    if (kind === 'creditcard') {
      return chartAccounts.find((a) => a.type === 'liability' && a.code.startsWith('21'))?.code
        || chartAccounts.find((a) => a.type === 'liability' && a.code.startsWith('2'))?.code
        || null;
    }

    const preferredCodes = kind === 'savings' ? ['1020', '1010', '1000'] : ['1010', '1020', '1000'];
    for (const code of preferredCodes) {
      const match = chartAccounts.find((a) => a.code === code);
      if (match) return match.code;
    }

    // Fallback: find any asset account starting with 10
    return chartAccounts.find((a) => a.type === 'asset' && a.code.startsWith('10'))?.code || null;
  }

  const categoryOptions = chartAccounts;
  const importBlockReason = !hasSelectedCompany
    ? 'Select a company first. Banking imports need an active company so accounts and the chart of accounts can load.'
    : !wizardAccountId
      ? accounts.length === 0
        ? 'Create a bank account first, then import the statement into that account.'
        : 'Select the bank account this statement belongs to.'
      : !Array.isArray(wizardParsed?.rows) || wizardParsed.rows.length === 0
        ? 'Upload and preview a statement before importing transactions.'
        : null;

  // ─── Fetch data ───

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetchWithTenantHeaders('/api/accounts');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to fetch accounts');
        setAccounts([]);
        return;
      }
      setError(null);
      setAccounts(Array.isArray(json.data) ? json.data : []);
    } catch {
      setError('Failed to fetch accounts');
      setAccounts([]);
    }
  }, [activeCompanyId, activeUserId]);

  const fetchChartAccounts = useCallback(async () => {
    try {
      const res = await fetchWithTenantHeaders('/api/coa');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to fetch chart of accounts');
        setChartAccounts([]);
        return;
      }
      setChartAccounts(Array.isArray(json.data) ? json.data : []);
    } catch {
      setChartAccounts([]);
    }
  }, [activeCompanyId, activeUserId]);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId);
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', '100');

      const res = await fetchWithTenantHeaders(`/api/transactions?${params.toString()}`);
      const json = await res.json();
      setTransactions(Array.isArray(json.data) ? json.data : []);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }, [activeCompanyId, activeUserId, selectedAccountId, statusFilter, search]);

  const fetchTransfers = useCallback(async () => {
    try {
      const res = await fetchWithTenantHeaders('/api/transfers');
      const json = await res.json();
      setTransfers(Array.isArray(json.data) ? json.data : []);
    } catch {
      // ignore
    }
  }, [activeCompanyId, activeUserId]);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchChartAccounts(), fetchTransfers()]).finally(() => setLoading(false));
  }, [fetchAccounts, fetchChartAccounts, fetchTransfers]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    if (wizardOpen && !wizardAccountId && accounts.length > 0) {
      setWizardAccountId(accounts[0].id);
    }
  }, [wizardOpen, wizardAccountId, accounts]);

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
    if (!categoryId) return;
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

  async function deleteTransaction(txId: string) {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    try {
      const res = await fetchWithTenantHeaders(`/api/transactions/${txId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      setToast({ message: 'Transaction deleted.', type: 'success' });
      fetchTransactions();
      fetchAccounts();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to delete', type: 'danger' });
    }
  }

  // Opening balance
  const [openingAcctId, setOpeningAcctId] = useState<string | null>(null);
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [settingBalance, setSettingBalance] = useState(false);

  async function setOpeningBalance() {
    if (!openingAcctId || !openingAmount || isNaN(parseFloat(openingAmount))) return;
    setSettingBalance(true);
    try {
      const res = await fetchWithTenantHeaders('/api/accounts/opening-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: openingAcctId, amount: parseFloat(openingAmount), date: openingDate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setToast({ message: `Opening balance set. New balance: ${money(json.data.newBalance)}`, type: 'success' });
      setOpeningAcctId(null);
      setOpeningAmount('');
      fetchAccounts();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed', type: 'danger' });
    } finally { setSettingBalance(false); }
  }

  async function deleteAllTransactions() {
    const isAllAccounts = !selectedAccountId || selectedAccountId === 'all';
    const label = isAllAccounts ? 'ALL transactions across ALL accounts' : `ALL transactions in ${accounts.find(a => a.id === selectedAccountId)?.name || 'this account'}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    try {
      const url = isAllAccounts
        ? '/api/transactions?all=true'
        : `/api/transactions?accountId=${selectedAccountId}`;
      const res = await fetchWithTenantHeaders(url, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      setToast({ message: `Deleted ${json.data.deleted} transaction${json.data.deleted !== 1 ? 's' : ''}.`, type: 'success' });
      fetchTransactions();
      fetchAccounts();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to delete', type: 'danger' });
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
    setWizardAccountName('Primary Checking');
    setWizardAccountKind('checking');
    setWizardCreatingAccount(false);
    setWizardFiles([]);
    setWizardParsed(null);
    setWizardMappings({});
    setWizardPreview([]);
    setWizardPdfAmbiguousSign(false);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    if (fileArray.length > 12) {
      setToast({ message: 'Maximum 12 files at once.', type: 'danger' });
      return;
    }
    if (!hasSelectedCompany) {
      setToast({ message: 'Select a company before uploading.', type: 'danger' });
      return;
    }

    setWizardFiles(fileArray);

    try {
      // Parse all files and combine results
      const allResults: any[] = [];
      const allErrors: string[] = [];
      let combinedFileType = '';

      for (const file of fileArray) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/import/parse', { method: 'POST', body: formData });
        const json = await res.json();
        if (!res.ok) {
          allErrors.push(`${file.name}: ${json.error || 'Parse failed'}`);
          continue;
        }
        if (Array.isArray(json.data?.errors) && json.data.errors.length > 0 && (!json.data.rows || json.data.rows.length === 0)) {
          allErrors.push(`${file.name}: ${json.data.errors[0]}`);
          continue;
        }
        allResults.push({ ...json.data, _fileName: file.name });
        combinedFileType = combinedFileType || json.data.fileType || '';
      }

      if (allResults.length === 0) {
        throw new Error(allErrors[0] || 'No files could be parsed');
      }

      // Combine: use headers from first result, concatenate rows
      const first = allResults[0];
      const combinedHeaders = first.headers || [];
      const combinedRows: any[] = [];

      for (const result of allResults) {
        // Only add rows whose headers match the first result's headers
        for (const row of (result.rows || [])) {
          combinedRows.push(row);
        }
      }

      const combined = {
        headers: combinedHeaders,
        rows: combinedRows,
        totalRows: combinedRows.length,
        fileType: combinedFileType,
        errors: allErrors,
        _fileCount: allResults.length,
      };

      setWizardParsed(combined);

      // Auto-map common column names (same logic as before)
      const auto: Record<string, string> = {};
      const headers = combinedHeaders;
      const rows = combinedRows;
      const isPdf = combinedFileType === 'pdf';

      for (const h of headers) {
        const lower = h.toLowerCase();
        if (lower.includes('date') && !auto.date) auto.date = h;
        else if ((lower.includes('description') || lower.includes('name') || lower.includes('memo') || lower.includes('particulars') || lower.includes('details')) && !auto.description) auto.description = h;
        else if ((lower.includes('amount') || lower.includes('value') || lower.includes('sum')) && !auto.amount && !lower.includes('balance')) auto.amount = h;
        else if ((lower.includes('withdrawal') || lower.includes('debit') || lower.includes('payment') || lower.includes('money out') || lower.includes('outflow')) && !auto.debit) auto.debit = h;
        else if ((lower.includes('deposit') || lower.includes('credit') || lower.includes('receipt') || lower.includes('money in') || lower.includes('inflow')) && !auto.credit) auto.credit = h;
        else if (lower.includes('balance') && !auto.balance) auto.balance = h;
      }

      let pdfAmbiguousSign = false;
      if (isPdf) {
        const amountCols = headers.filter((h: string) => /^Amount_\d+$/i.test(h));
        let negCounts: Record<string, number> = {};
        let posCounts: Record<string, number> = {};
        let popCounts: Record<string, number> = {};
        let magSums: Record<string, number> = {};
        for (const col of amountCols) { negCounts[col] = 0; posCounts[col] = 0; popCounts[col] = 0; magSums[col] = 0; }
        for (const row of rows) {
          for (const col of amountCols) {
            const v = Math.abs(parseFloat(row.raw?.[col] || '0'));
            if (v > 0.005) { popCounts[col] = (popCounts[col] || 0) + 1; magSums[col] = (magSums[col] || 0) + v; }
          }
        }
        for (const row of rows.slice(0, 10)) {
          for (const col of amountCols) {
            const val = parseFloat(row.raw?.[col] || '0');
            if (val < -0.005) negCounts[col] = (negCounts[col] || 0) + 1;
            else if (val > 0.005) posCounts[col] = (posCounts[col] || 0) + 1;
          }
        }

        // A running-balance column is populated on virtually every row and
        // carries much larger cumulative values than any single transaction
        // — unlike debit/credit columns, which only fill in for their
        // applicable side. Detect it by population rate + magnitude rather
        // than assuming it's the trailing column, so a 2-column
        // amount-plus-balance layout isn't mistaken for a debit/credit pair.
        const totalRows = rows.length || 1;
        const avgMag = (c: string) => (popCounts[c] ? magSums[c] / popCounts[c] : 0);
        let balanceCol: string | undefined;
        if (amountCols.length >= 2) {
          const stronglyPopulated = amountCols.filter((c: string) => (popCounts[c] || 0) / totalRows > 0.9);
          for (const c of stronglyPopulated) {
            const others = amountCols.filter((o: string) => o !== c);
            const otherMaxAvgMag = Math.max(0, ...others.map(avgMag));
            if (otherMaxAvgMag === 0 || avgMag(c) > otherMaxAvgMag * 2) {
              balanceCol = c;
              break;
            }
          }
        }
        const splitCols = amountCols.filter((c: string) => c !== balanceCol);

        const sortedByNeg = splitCols.slice().sort((a: string, b: string) => (negCounts[b] || 0) - (negCounts[a] || 0));
        const sortedByPos = splitCols.slice().sort((a: string, b: string) => (posCounts[b] || 0) - (posCounts[a] || 0));
        const hasAnyNegative = splitCols.some((c: string) => (negCounts[c] || 0) > 0);

        if (hasAnyNegative) {
          auto.debit = sortedByNeg[0];
          const creditCandidate = sortedByPos.find((c: string) => c !== auto.debit);
          if (creditCandidate) auto.credit = creditCandidate;
        } else if (splitCols.length >= 2) {
          // No sign info anywhere — assume the conventional debit-then-credit
          // column order (e.g. Withdrawal | Deposit). Still worth a review.
          auto.debit = splitCols[0];
          auto.credit = splitCols[1];
          pdfAmbiguousSign = true;
        } else if (splitCols.length === 1) {
          // Exactly one unsigned amount column — there is no reliable way to
          // tell debits from credits apart from this data. Map it as a plain
          // signed amount rather than silently forcing every row to "debit"
          // (which would flip genuine deposits into fake expenses).
          auto.amount = splitCols[0];
          pdfAmbiguousSign = true;
        }
        if (balanceCol) auto.balance = balanceCol;
      }
      setWizardPdfAmbiguousSign(pdfAmbiguousSign);

      const selectedAcct = accounts.find(a => a.id === wizardAccountId);
      setWizardSignDirection(selectedAcct?.kind === 'creditcard' ? 'inverted' : 'normal');
      setWizardMappings(auto);
      setWizardStep('map');

      if (allErrors.length > 0) {
        setToast({ message: `${allResults.length} files parsed, ${allErrors.length} had warnings.`, type: 'success' });
      }
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Failed to parse files', type: 'danger' });
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
      } else if (debit) {
        // Only debit column mapped — use it directly
        amt = parseFloat(String(row.raw[debit] || '0').replace(/[$,]/g, '') || '0') || 0;
      } else if (credit) {
        // Only credit column mapped — use it directly
        amt = parseFloat(String(row.raw[credit] || '0').replace(/[$,]/g, '') || '0') || 0;
      }

      // Apply sign direction for credit cards
      if (wizardSignDirection === 'inverted') amt = -amt;

      return {
        date: row.raw[date] ?? row.date ?? '',
        description: row.raw[description] ?? row.description ?? '',
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
    if (importBlockReason) {
      setToast({ message: importBlockReason, type: 'danger' });
      return;
    }
    if (!wizardAccountId) {
      setToast({
        message: 'Please create or select an account before importing the statement.',
        type: 'danger',
      });
      return;
    }
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
      } else if (debit) {
        amt = parseFloat(row.raw[debit]?.replace(/[$,]/g, '') || '0') || 0;
      } else if (credit) {
        amt = parseFloat(row.raw[credit]?.replace(/[$,]/g, '') || '0') || 0;
      }
      if (wizardSignDirection === 'inverted') amt = -amt;

      return {
        date: row.raw[date] ?? row.date ?? '',
        description: row.raw[description] ?? row.description ?? '',
        amount: String(amt),
      };
    });

    try {
      const res = await fetchWithTenantHeaders('/api/import/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountId: wizardAccountId,
          mappedRows,
          fileType: wizardParsed.fileType,
          skipDuplicates: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Import failed');
      }
      if (!json.data) {
        throw new Error('Import failed');
      }
      setToast({
        message: `Imported ${json.data.importedCount} transactions. ${json.data.duplicatesSkipped} duplicates skipped.`,
        type: 'success',
      });
      closeWizard();
      fetchAccounts();
      fetchTransactions();
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Import failed', type: 'danger' });
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

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

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
            <button
              onClick={(e) => { e.stopPropagation(); setOpeningAcctId(acct.id); setOpeningAmount(''); }}
              className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--primary)] font-medium"
            >
              Set Opening Balance
            </button>
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

      {/* Opening Balance Form */}
      {openingAcctId && (
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 mb-6 flex items-end gap-3">
          <div className="field flex-1">
            <label className="text-xs">Opening Balance Amount</label>
            <input
              type="number" step="0.01" className="input"
              value={openingAmount}
              onChange={e => setOpeningAmount(e.target.value)}
              placeholder="e.g. 5000.00"
              autoFocus
            />
          </div>
          <div className="field" style={{width: '160px'}}>
            <label className="text-xs">As of Date</label>
            <input
              type="date" className="input"
              value={openingDate}
              onChange={e => setOpeningDate(e.target.value)}
            />
          </div>
          <Button onClick={setOpeningBalance} disabled={settingBalance || !openingAmount}>
            {settingBalance ? <Loader2 size={16} className="animate-spin" /> : null}
            Save
          </Button>
          <Button variant="ghost" onClick={() => setOpeningAcctId(null)}>Cancel</Button>
          <span className="text-xs text-[var(--text-muted)] ml-2">
            Creates a journal entry to Opening Balance Equity (3900)
          </span>
        </div>
      )}

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
        {transactions.length > 0 && (
          <button
            onClick={deleteAllTransactions}
            className="text-xs text-[var(--danger)] hover:underline font-medium px-2 whitespace-nowrap"
            title={selectedAccountId === 'all' ? 'Delete ALL transactions across all accounts' : 'Delete all transactions for this account'}
          >
            Delete All
          </button>
        )}
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
                        {categoryOptions.length === 0 ? (
                          <option value="" disabled>No categories available</option>
                        ) : categoryOptions.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.code} — {cat.name} ({cat.type})
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

                    <div className="flex items-center gap-1 ml-auto">
                      {tx.status === 'toreview' && (
                        <>
                          <button
                            onClick={() => excludeTransaction(tx.id, 'Personal')}
                            className="w-[28px] h-[28px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                            title="Exclude"
                          >
                            <X size={13} />
                          </button>
                          <button
                            onClick={() => categorizeTransaction(tx.id, categoryOptions[0]?.id || '')}
                            disabled={categoryOptions.length === 0}
                            className="w-[28px] h-[28px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--success)] hover:border-[var(--success)] transition-colors"
                            title="Accept"
                          >
                            <Check size={13} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => deleteTransaction(tx.id)}
                        className="w-[28px] h-[28px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                        title="Delete"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
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
                {!hasSelectedCompany && (
                  <Alert variant="danger">
                    Select a company first. The importer cannot create bank accounts or save transactions until the app has an active company.
                  </Alert>
                )}

                <div className="field">
                  <label>Account</label>
                  <select
                    className="select"
                    value={wizardAccountId}
                    onChange={(e) => {
                      setWizardAccountId(e.target.value);
                      // Auto-set sign direction based on account type
                      const acct = accounts.find(a => a.id === e.target.value);
                      setWizardSignDirection(acct?.kind === 'creditcard' ? 'inverted' : 'normal');
                    }}
                    disabled={accounts.length === 0}
                  >
                    {accounts.length === 0 ? (
                      <option value="">No accounts yet</option>
                    ) : accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.kind.replace('_', ' ')}) · {money(a.currentBalance)}
                      </option>
                    ))}
                  </select>
                  {wizardAccountId && (
                    <span className="hint mt-1">
                      {accounts.find(a => a.id === wizardAccountId)?.kind === 'creditcard'
                        ? '💳 Credit card — charges will be auto-inverted to show as outflows.'
                        : '🏦 Bank account — debits = outflows, credits = inflows.'}
                    </span>
                  )}
                </div>

                {accounts.length === 0 && (
                  <Alert variant="warning">
                    <div className="space-y-3">
                      <div className="text-sm">
                        No bank accounts are available yet. Create one now so this statement has somewhere to import.
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="field">
                          <label>Account name</label>
                          <input
                            className="input"
                            value={wizardAccountName}
                            onChange={(e) => setWizardAccountName(e.target.value)}
                            placeholder="Primary Checking"
                          />
                        </div>
                        <div className="field">
                          <label>Account type</label>
                          <select
                            className="select"
                            value={wizardAccountKind}
                            onChange={(e) => setWizardAccountKind(e.target.value as FinancialAccount['kind'])}
                          >
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                            <option value="creditcard">Credit card</option>
                            <option value="payoutclearing">Payout clearing</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={createWizardAccount} disabled={wizardCreatingAccount || !hasSelectedCompany}>
                          {wizardCreatingAccount ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                          Create account
                        </Button>
                      </div>
                    </div>
                  </Alert>
                )}

                {/* Drop zone */}
                <div
                  className={cn(
                    'border-2 border-dashed border-[var(--border-strong)] rounded-xl p-10 text-center transition-colors',
                    hasSelectedCompany
                      ? 'hover:border-[var(--border-focus)] hover:bg-[var(--surface-2)] cursor-pointer'
                      : 'opacity-60 cursor-not-allowed'
                  )}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!hasSelectedCompany) {
                      setToast({ message: 'Select a company before uploading.', type: 'danger' });
                      return;
                    }
                    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
                  }}
                  onClick={() => {
                    if (!hasSelectedCompany) {
                      setToast({ message: 'Select a company before uploading.', type: 'danger' });
                      return;
                    }
                    const input = document.getElementById('wizard-file-input') as HTMLInputElement;
                    input?.click();
                  }}
                >
                  <FileUp size={40} className="mx-auto text-[var(--text-faint)] mb-3" />
                  <div className="text-sm font-semibold text-[var(--text-strong)] mb-1">
                    Drop statement files here
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    CSV, OFX, QFX, or PDF — up to 12 files, 10 MB each
                  </div>
                  {wizardFiles.length > 0 && (
                    <div className="text-xs text-[var(--primary)] mt-2 font-medium">
                      {wizardFiles.length} file{wizardFiles.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                  <input
                    id="wizard-file-input"
                    type="file"
                    accept=".csv,.ofx,.qfx,.txt,.pdf"
                    className="hidden"
                    multiple
                    disabled={!hasSelectedCompany}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
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

                {wizardPdfAmbiguousSign && (
                  <Alert variant="warning">
                    This PDF's amounts don't have distinguishing signs, CR/DR labels, or separate
                    debit/credit columns — LedgerPro can't reliably tell deposits from withdrawals
                    for it. Check the column mapping below against the sample values, and carefully
                    verify each transaction's amount (and sign) in the review step before importing.
                  </Alert>
                )}

                {/* Column Preview — shows sample values so user can identify columns */}
                {wizardParsed?.headers?.length > 0 && (
                  <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto">
                    <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">Column Preview (first 3 rows)</div>
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          {wizardParsed.headers.map((h: string) => (
                            <th key={h} className="text-left px-2 py-1 text-[var(--text-faint)] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wizardParsed.rows.slice(0, 3).map((row: any, ri: number) => (
                          <tr key={ri} className="border-b border-[var(--border)] last:border-0">
                            {wizardParsed.headers.map((h: string) => (
                              <td key={h} className="px-2 py-1 text-[var(--text)] whitespace-nowrap max-w-[150px] truncate">
                                {row.raw?.[h] ?? row[h] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'date', label: 'Date', help: 'Transaction date column' },
                    { key: 'description', label: 'Description', help: 'Merchant/payee name' },
                    { key: 'amount', label: 'Amount (signed)', help: 'Single column with +/- signs' },
                    { key: 'debit', label: 'Debit / Payment Column', help: 'Money OUT — withdrawals, payments, charges' },
                    { key: 'credit', label: 'Credit / Receipt Column', help: 'Money IN — deposits, refunds, interest' },
                    { key: 'balance', label: 'Balance (optional)', help: 'Running account balance after transaction' },
                  ].map((field) => (
                    <div className="field" key={field.key}>
                      <label title={field.help}>{field.label}</label>
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

                {/* Sign direction + Statement type guidance */}
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="field flex-1">
                      <label>Sign Direction</label>
                      <Segmented
                        options={[
                          { value: 'normal', label: 'Normal (bank)' },
                          { value: 'inverted', label: 'Inverted (credit card)' },
                        ]}
                        value={wizardSignDirection}
                        onChange={(v) => setWizardSignDirection(v as 'normal' | 'inverted')}
                      />
                    </div>
                    <div className="flex-1 text-xs text-[var(--text-muted)] leading-relaxed">
                      {wizardSignDirection === 'normal' ? (
                        <span><strong>Bank checking/savings:</strong> Debits = money out (negative). Credits = money in (positive).</span>
                      ) : (
                        <span><strong>Credit card:</strong> Charges look positive on statements but are money OUT. We flip the sign so your books are correct.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setWizardStep('account')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                  <Button
                    onClick={generatePreview}
                    disabled={!wizardMappings.date || (!wizardMappings.amount && !wizardMappings.debit && !wizardMappings.credit)}
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
                {wizardPdfAmbiguousSign && (
                  <Alert variant="warning">
                    Debit/credit direction for this file was guessed, not detected — double-check the
                    amount sign (red = money out, green = money in) on every row below. Go back to fix
                    the column mapping if any are wrong.
                  </Alert>
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
                  <Button variant="secondary" onClick={() => setWizardStep('map')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                  <div className="flex flex-col items-end gap-2">
                    {importBlockReason && (
                      <div className="max-w-[320px] text-xs text-right text-[var(--danger)]">
                        {importBlockReason}
                      </div>
                    )}
                    <Button onClick={confirmImport} disabled={wizardImporting || Boolean(importBlockReason)}>
                      {wizardImporting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      Import {wizardParsed?.totalRows} Transactions
                    </Button>
                  </div>
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
