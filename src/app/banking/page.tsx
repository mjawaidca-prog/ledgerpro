'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Loader2, ChevronDown, FileUp, AlertTriangle, MoreHorizontal, Trash2,
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
  balance?: number;
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

interface SavedMapping {
  id: string;
  financialAccountId: string;
  profileName: string | null;
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string | null;
  debitColumn: string | null;
  creditColumn: string | null;
  balanceColumn: string | null;
  signDirection: 'normal' | 'inverted';
  headerSignature: string | null;
  mappingsJson: Record<string, string> | null;
}

// ─── Import Wizard Steps ───

type WizardStep = 'account' | 'upload' | 'map' | 'review';

// ─── Column mapping roles ───
// These are the roles a user can assign to each uploaded column.

type ColumnRole =
  | 'ignore'
  | 'date'
  | 'description'
  | 'money_out'
  | 'money_in'
  | 'card_charge'
  | 'card_payment'
  | 'balance'
  | 'reference'
  | 'memo'
  | 'signed_amount';

interface RoleDef {
  value: ColumnRole;
  label: string;
  help: string;
}

function bankRoles(): RoleDef[] {
  return [
    { value: 'ignore', label: 'Ignore', help: 'Skip this column' },
    { value: 'date', label: 'Date', help: 'Transaction date' },
    { value: 'description', label: 'Description', help: 'Merchant or payee name' },
    { value: 'money_out', label: 'Money Out / Payment', help: 'Withdrawals, payments, debits' },
    { value: 'money_in', label: 'Money In / Receipt', help: 'Deposits, refunds, credits' },
    { value: 'signed_amount', label: 'Signed Amount', help: 'Single column with +/- for direction' },
    { value: 'balance', label: 'Balance', help: 'Running account balance' },
    { value: 'reference', label: 'Reference / Cheque No.', help: 'Cheque or transaction reference' },
    { value: 'memo', label: 'Memo', help: 'Additional notes' },
  ];
}

function creditCardRoles(): RoleDef[] {
  return [
    { value: 'ignore', label: 'Ignore', help: 'Skip this column' },
    { value: 'date', label: 'Date', help: 'Transaction date' },
    { value: 'description', label: 'Description', help: 'Merchant or payee name' },
    { value: 'card_charge', label: 'Charge / Purchase', help: 'New charges or purchases' },
    { value: 'card_payment', label: 'Payment / Credit', help: 'Payments, refunds, credits' },
    { value: 'signed_amount', label: 'Signed Amount', help: 'Single column with +/- for direction' },
    { value: 'balance', label: 'Balance', help: 'Running card balance' },
    { value: 'reference', label: 'Reference', help: 'Transaction reference number' },
    { value: 'memo', label: 'Memo', help: 'Additional notes' },
  ];
}

// Derive the user-visible column set from the account type
type AccountImportType = 'bank' | 'credit_card';

function resolveImportType(coaAccount: ChartAccount | null, finAccountKind?: string): AccountImportType {
  if (!coaAccount) {
    // Fallback: use financial account kind
    return finAccountKind === 'creditcard' ? 'credit_card' : 'bank';
  }
  if (coaAccount.type === 'liability') return 'credit_card';
  return 'bank';
}

function normalizedPreviewColumns(importType: AccountImportType) {
  if (importType === 'credit_card') {
    return ['Date', 'Description', 'Charge', 'Payment/Credit', 'Balance', 'Reference', 'Status'];
  }
  return ['Date', 'Description', 'Money Out', 'Money In', 'Balance', 'Reference', 'Status'];
}

// ─── Statement-to-CSV conversion ───────────────────────────────
// Converts any parsed statement (PDF, OFX, QFX, CSV) into a standardized
// format where every column has a descriptive name. This ensures the
// original statement preview always shows meaningful headers, not
// synthetic names like "Amount_1" / "Amount_2".

interface NormalizedStatement {
  headers: string[];
  rows: any[];
  totalRows: number;
  fileType: string;
  errors: string[];
  columnMeta: any;
  _fileCount: number;
}

function normalizeParsedStatement(
  parsed: { headers: string[]; rows: any[]; totalRows: number; fileType: string; errors: string[]; columnMeta: any; _fileCount: number }
): NormalizedStatement {
  const { headers, rows, fileType, columnMeta } = parsed;

  // CSV files: headers are already the original column names — pass through
  if (fileType === 'csv' || fileType === 'ofx') {
    return { ...parsed, headers };
  }

  // PDF: rename synthetic Amount_N columns to descriptive names using
  // column metadata (sign patterns, population rate, magnitude).
  if (fileType === 'pdf') {
    // Build header rename map: old header name → new header name
    const renameMap = new Map<string, string>();
    for (const h of headers) {
      renameMap.set(h, h); // default: keep same name
    }

    // Gather stats from columnMeta if available
    const colMetaMap = new Map<string, { kind: string; populatedCount: number; avgMagnitude: number }>();
    if (Array.isArray(columnMeta)) {
      for (const m of columnMeta) {
        colMetaMap.set(m.name, { kind: m.kind, populatedCount: m.populatedCount, avgMagnitude: m.avgMagnitude });
      }
    }

    // Collect row-level stats for each Amount_N column
    const amountCols = headers.filter((h: string) => /^Amount_\d+$/i.test(h));
    const colStats: Record<string, { negCount: number; posCount: number; popCount: number; sumAbs: number }> = {};
    for (const col of amountCols) {
      colStats[col] = { negCount: 0, posCount: 0, popCount: 0, sumAbs: 0 };
    }
    for (const row of rows) {
      for (const col of amountCols) {
        const val = parseFloat(String(row.raw?.[col] || ''));
        if (!isNaN(val) && Math.abs(val) > 0.001) {
          colStats[col].popCount++;
          colStats[col].sumAbs += Math.abs(val);
          if (val < 0) colStats[col].negCount++;
          else colStats[col].posCount++;
        }
      }
    }

    const totalRows = rows.length || 1;

    // First pass: identify the balance column using the server's columnMeta
    // (which compares magnitudes) or by finding the column with the largest
    // average magnitude among high-population columns.
    let balanceColName: string | null = null;

    // Trust server columnMeta first — it does proper magnitude comparison
    if (colMetaMap.size > 0) {
      const serverBalance = Array.from(colMetaMap.entries()).find(
        ([, m]) => m.kind === 'balance'
      );
      if (serverBalance) {
        balanceColName = serverBalance[0];
      }
    }

    // Fallback: balance has the largest average magnitude among columns
    // present on >80% of rows (typically the running balance dwarfs individual txns)
    if (!balanceColName && amountCols.length >= 2) {
      const highPopCols = amountCols.filter(
        (c) => (colStats[c]?.popCount || 0) / totalRows > 0.8
      );
      if (highPopCols.length >= 2) {
        // Pick the one with the largest average magnitude
        balanceColName = highPopCols.reduce((best, c) =>
          (colStats[c]?.sumAbs / Math.max(colStats[c]?.popCount || 1, 1)) >
          (colStats[best]?.sumAbs / Math.max(colStats[best]?.popCount || 1, 1))
            ? c : best
        , highPopCols[0]);
      }
    }

    // Second pass: rename columns based on their role
    for (const col of amountCols) {
      const meta = colMetaMap.get(col);
      const stats = colStats[col];
      if (!stats) continue;

      const popRate = stats.popCount / totalRows;

      // 1. Balance column (identified by server meta or magnitude comparison)
      if (col === balanceColName) {
        renameMap.set(col, 'Balance');
        continue;
      }

      // 2. Use server columnMeta for positive-only columns (separate debit/credit)
      if (meta?.kind === 'positive-only') {
        // Among non-balance positive-only columns, the one with MORE entries
        // is typically debits/withdrawals (most transactions are expenses)
        const peerPositiveOnly = amountCols.filter(
          (c: string) => c !== col && c !== balanceColName && colMetaMap.get(c)?.kind === 'positive-only'
        );
        const peerMaxPop = Math.max(0, ...peerPositiveOnly.map((c: string) => colStats[c]?.popCount || 0));

        if (stats.popCount >= peerMaxPop) {
          renameMap.set(col, 'Withdrawals / Debits');
        } else {
          renameMap.set(col, 'Deposits / Credits');
        }
        continue;
      }

      // 3. Signed column (has both +/-)
      if (meta?.kind === 'signed' || (stats.negCount > 0 && stats.posCount > 0)) {
        renameMap.set(col, 'Amount (signed)');
        continue;
      }

      // 4. Fallback for positive-only columns WITHOUT columnMeta
      if (stats.negCount === 0 && stats.posCount > 0 && popRate < 0.8) {
        renameMap.set(col, 'Withdrawals / Debits');
        continue;
      }

      // 5. Sparse / unknown — keep numbered
      if (popRate < 0.3) {
        renameMap.set(col, `Column ${col.replace('Amount_', '')}`);
      }
    }

    // If we didn't find any debit/credit columns via columnMeta, try a
    // simpler fallback: the first non-balance column with decent population
    // is debits, the next is credits.
    const renamed = amountCols.filter((c) => renameMap.get(c) !== c || c !== renameMap.get(c));
    const stillUnnamed = amountCols.filter((c) => {
      const name = renameMap.get(c);
      return !name || name === c || name.startsWith('Amount_') || name.startsWith('Column ');
    });

    if (stillUnnamed.length >= 2 && stillUnnamed.every((c) => (colStats[c]?.popCount || 0) / totalRows > 0.3)) {
      renameMap.set(stillUnnamed[0], 'Withdrawals / Debits');
      renameMap.set(stillUnnamed[1], 'Deposits / Credits');
    } else if (stillUnnamed.length === 1 && (colStats[stillUnnamed[0]]?.popCount || 0) / totalRows > 0.3) {
      renameMap.set(stillUnnamed[0], 'Amount');
    }

    // Build new header list and remap raw data in all rows
    const newHeaders = headers.map((h) => renameMap.get(h) || h);

    // Remap each row's raw keys from old header names to new header names
    const newRows = rows.map((row: any) => {
      const newRaw: Record<string, string> = {};
      if (row.raw) {
        for (const [key, value] of Object.entries(row.raw)) {
          const newKey = renameMap.get(key) || key;
          newRaw[newKey] = String(value ?? '');
        }
      }
      return { ...row, raw: newRaw };
    });

    return { ...parsed, headers: newHeaders, rows: newRows };
  }

  // Unknown format: pass through unchanged
  return parsed;
}

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
  const [wizardCoaAccountId, setWizardCoaAccountId] = useState<string>('');       // Chart of Accounts ID
  const [wizardFinancialAccountId, setWizardFinancialAccountId] = useState<string>(''); // linked FinancialAccount ID
  const [wizardImportType, setWizardImportType] = useState<AccountImportType>('bank');
  const [wizardFiles, setWizardFiles] = useState<File[]>([]);
  const [wizardParsed, setWizardParsed] = useState<any>(null);
  // column header → role (e.g. { 'Transaction Date': 'date', 'Withdrawals': 'money_out' })
  const [wizardMappings, setWizardMappings] = useState<Record<string, string>>({});
  const [wizardPreview, setWizardPreview] = useState<any[]>([]);
  const [wizardSignDirection, setWizardSignDirection] = useState<'normal' | 'inverted'>('normal');
  const [wizardPdfAmbiguousSign, setWizardPdfAmbiguousSign] = useState(false);
  const [wizardImporting, setWizardImporting] = useState(false);
  const [wizardSaveMapping, setWizardSaveMapping] = useState(true);
  const [wizardSavedMapping, setWizardSavedMapping] = useState<SavedMapping | null>(null);
  const [wizardCreatingAccount, setWizardCreatingAccount] = useState(false);
  const [wizardNewAccountName, setWizardNewAccountName] = useState('');
  const [wizardNewAccountKind, setWizardNewAccountKind] = useState<FinancialAccount['kind']>('checking');
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

  // ─── Filter COA accounts for import selector ───
  const importableCoaAccounts = useMemo(() => {
    return chartAccounts.filter(
      (a) =>
        (a.type === 'asset' && (a.code.startsWith('10') || a.code.startsWith('11') || a.code.startsWith('12'))) ||
        (a.type === 'liability' && (a.code.startsWith('21') || a.code.startsWith('22')))
    );
  }, [chartAccounts]);

  const selectedCoaAccount = useMemo(
    () => chartAccounts.find((a) => a.id === wizardCoaAccountId) || null,
    [chartAccounts, wizardCoaAccountId]
  );

  // ─── Create a new FinancialAccount from the wizard ───
  async function createWizardFinancialAccount(): Promise<FinancialAccount | null> {
    if (wizardCreatingAccount) return null;
    if (!hasSelectedCompany) {
      setToast({ message: 'Select a company before creating an account.', type: 'danger' });
      return null;
    }
    if (!wizardCoaAccountId || !selectedCoaAccount) {
      setToast({ message: 'Select a GL account first.', type: 'danger' });
      return null;
    }
    setWizardCreatingAccount(true);
    try {
      const name = wizardNewAccountName.trim() || selectedCoaAccount.name;
      const kind = wizardImportType === 'credit_card' ? 'creditcard' as const : wizardNewAccountKind;
      const res = await fetchWithTenantHeaders('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          kind,
          glAccountCode: selectedCoaAccount.code,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create account');
      const created = json.data as FinancialAccount;
      setAccounts((prev) => [...prev, created]);
      setWizardFinancialAccountId(created.id);
      setToast({ message: `Created ${created.name} for imports.`, type: 'success' });
      return created;
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to create account', type: 'danger' });
      return null;
    } finally {
      setWizardCreatingAccount(false);
    }
  }

  // Derive which FinancialAccount is linked to the selected COA account
  const linkedFinancialAccount = useMemo(() => {
    if (!selectedCoaAccount) return null;
    return accounts.find((a) => a.glAccountCode === selectedCoaAccount.code) || null;
  }, [selectedCoaAccount, accounts]);

  const importBlockReason = !hasSelectedCompany
    ? 'Select a company first.' :
    !wizardCoaAccountId
    ? 'Select the Chart of Accounts account this statement belongs to.' :
    !linkedFinancialAccount && !wizardFinancialAccountId
    ? 'Create a bank account for this GL account first, then upload.' :
    !Array.isArray(wizardParsed?.rows) || wizardParsed.rows.length === 0
    ? 'Upload and preview a statement before importing.' :
    null;

  // Validation messages for column mapping
  const mappingValidation = useMemo(() => {
    if (wizardStep !== 'map' && wizardStep !== 'review') return [];
    const errors: string[] = [];
    const roles = Object.values(wizardMappings);
    if (!roles.includes('date')) errors.push('Choose a Date column.');
    if (!roles.includes('description')) errors.push('Choose a Description column.');
    const hasMoneyOut = roles.includes('money_out');
    const hasMoneyIn = roles.includes('money_in');
    const hasCharge = roles.includes('card_charge');
    const hasPayment = roles.includes('card_payment');
    const hasSignedAmount = roles.includes('signed_amount');
    if (wizardImportType === 'credit_card') {
      if (!hasCharge && !hasPayment && !hasSignedAmount)
        errors.push('Choose at least one amount column (Charge or Payment/Credit).');
    } else {
      if (!hasMoneyOut && !hasMoneyIn && !hasSignedAmount)
        errors.push('Choose at least one amount column (Money Out or Money In).');
    }
    const dateCount = roles.filter((r) => r === 'date').length;
    if (dateCount > 1) errors.push('Only one column can be mapped as Date.');
    const descCount = roles.filter((r) => r === 'description').length;
    if (descCount > 1) errors.push('Only one column can be mapped as Description.');
    const balCount = roles.filter((r) => r === 'balance').length;
    if (balCount > 1) errors.push('Only one column can be mapped as Balance.');
    return errors;
  }, [wizardMappings, wizardStep, wizardImportType]);

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

  // ─── Normalize header for signature matching ───
  function buildHeaderSignature(headers: string[]): string {
    return headers
      .map((h) => h.toLowerCase().trim().replace(/\s+/g, ' '))
      .join('|')
      .replace(/[^a-z0-9| ]/g, '')
      .replace(/\s+/g, '_');
  }

  // ─── Fetch saved mapping for an account + headers ───
  async function fetchSavedMapping(accountId: string, headers: string[]): Promise<SavedMapping | null> {
    try {
      const sig = buildHeaderSignature(headers);
      const res = await fetchWithTenantHeaders(
        `/api/column-mappings?accountId=${encodeURIComponent(accountId)}&headers=${encodeURIComponent(sig)}`
      );
      const json = await res.json();
      if (json.data?.length > 0) return json.data[0] as SavedMapping;
      return null;
    } catch {
      return null;
    }
  }

  // ─── Apply a saved mapping to wizardMappings (column header → role) ───
  function applyMappingToWizard(saved: SavedMapping, headers: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    // Initialize all to 'ignore'
    for (const h of headers) {
      result[h] = 'ignore';
    }

    // Apply from the saved mapping columns
    if (saved.dateColumn && headers.includes(saved.dateColumn)) result[saved.dateColumn] = 'date';
    if (saved.descriptionColumn && headers.includes(saved.descriptionColumn)) result[saved.descriptionColumn] = 'description';
    if (saved.amountColumn && headers.includes(saved.amountColumn)) result[saved.amountColumn] = 'signed_amount';
    if (saved.debitColumn && headers.includes(saved.debitColumn)) {
      result[saved.debitColumn] = wizardImportType === 'credit_card' ? 'card_charge' : 'money_out';
    }
    if (saved.creditColumn && headers.includes(saved.creditColumn)) {
      result[saved.creditColumn] = wizardImportType === 'credit_card' ? 'card_payment' : 'money_in';
    }
    if (saved.balanceColumn && headers.includes(saved.balanceColumn)) result[saved.balanceColumn] = 'balance';

    // Also try mappingsJson if available (more precise mapping)
    if (saved.mappingsJson) {
      for (const [header, role] of Object.entries(saved.mappingsJson)) {
        if (headers.includes(header)) {
          result[header] = role;
        }
      }
    }

    return result;
  }

  // ─── Import wizard ───

  function openWizard() {
    setWizardStep('account');
    setWizardCoaAccountId('');          // Start BLANK — no preselection
    setWizardFinancialAccountId('');
    setWizardImportType('bank');
    setWizardFiles([]);
    setWizardParsed(null);
    setWizardMappings({});
    setWizardPreview([]);
    setWizardPdfAmbiguousSign(false);
    setWizardSaveMapping(true);
    setWizardSavedMapping(null);
    setWizardNewAccountName('');
    setWizardNewAccountKind('checking');
    setWizardCreatingAccount(false);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardOpen(false);
  }

  function handleCoaAccountSelect(coaId: string) {
    setWizardCoaAccountId(coaId);
    const coa = chartAccounts.find((a) => a.id === coaId);
    if (coa) {
      const importType = resolveImportType(coa);
      setWizardImportType(importType);
      setWizardSignDirection(importType === 'credit_card' ? 'inverted' : 'normal');

      // Check if a FinancialAccount is linked
      const linked = accounts.find((a) => a.glAccountCode === coa.code);
      if (linked) {
        setWizardFinancialAccountId(linked.id);
        setWizardNewAccountKind(linked.kind);
        setWizardNewAccountName(linked.name);
      } else {
        setWizardFinancialAccountId('');
        setWizardNewAccountName(coa.name);
        setWizardNewAccountKind(importType === 'credit_card' ? 'creditcard' : 'checking');
      }
    }
  }

  function handleContinueToUpload() {
    if (!wizardCoaAccountId) {
      setToast({ message: 'Please select a bank or credit card account before uploading a statement.', type: 'danger' });
      return;
    }
    setWizardStep('upload');
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

      // Combine results — trim headers for consistent matching
      const first = allResults[0];
      const rawHeaders: string[] = first.headers || [];
      const combinedHeaders: string[] = [];
      for (const h of rawHeaders) {
        const trimmed = h.trim();
        combinedHeaders.push(trimmed || '(empty)');
      }

      // Debug: log headers so we can verify all columns were detected
      console.log('[Import Wizard] Raw headers from parser:', rawHeaders);
      console.log('[Import Wizard] Trimmed headers:', combinedHeaders);
      console.log('[Import Wizard] Column count:', combinedHeaders.length);
      const combinedRows: any[] = [];

      for (const result of allResults) {
        for (const row of (result.rows || [])) {
          // Re-key raw data with trimmed headers so lookups match
          const trimmedRaw: Record<string, string> = {};
          if (row.raw) {
            for (const [key, value] of Object.entries(row.raw)) {
              trimmedRaw[key.trim()] = String(value ?? '');
            }
          }
          combinedRows.push({ ...row, raw: trimmedRaw });
        }
      }

      const firstColumnMeta = allResults.find((r: any) => r.columnMeta)?.columnMeta || null;

      const combined = {
        headers: combinedHeaders,
        rows: combinedRows,
        totalRows: combinedRows.length,
        fileType: combinedFileType,
        errors: allErrors,
        _fileCount: allResults.length,
        columnMeta: firstColumnMeta,
      };

      // Normalize: convert all formats to a standardized CSV-like representation
      // so the original statement preview always shows meaningful column names.
      const normalized = normalizeParsedStatement(combined);
      setWizardParsed(normalized);

      // Determine the financial account to check for saved mappings
      const finAcctId = wizardFinancialAccountId || linkedFinancialAccount?.id;
      let savedMapping: SavedMapping | null = null;

      if (finAcctId) {
        savedMapping = await fetchSavedMapping(finAcctId, combinedHeaders);
        setWizardSavedMapping(savedMapping);
      }

      // Use normalized headers (PDF Amount_N columns have been renamed to
      // descriptive labels like "Withdrawals / Debits", "Deposits / Credits", "Balance")
      const headers = normalized.headers;
      const rows = combinedRows;
      const isPdf = combinedFileType === 'pdf';

      // Initialize all columns to 'ignore'
      const initMappings: Record<string, string> = {};
      for (const h of headers) {
        initMappings[h] = 'ignore';
      }

      if (savedMapping) {
        // Apply saved mapping
        const applied = applyMappingToWizard(savedMapping, headers);
        Object.assign(initMappings, applied);
      } else {
        // Auto-detect common column names
        for (const h of headers) {
          const lower = h.toLowerCase().trim();
          if ((lower.includes('date') || lower === 'dt') && !Object.values(initMappings).includes('date')) initMappings[h] = 'date';
          else if ((lower.includes('description') || lower.includes('narrative') || lower.includes('name') || lower.includes('memo') || lower.includes('particulars') || lower.includes('details') || lower.includes('merchant') || lower.includes('payee') || lower.includes('text')) && !Object.values(initMappings).includes('description')) initMappings[h] = 'description';
          else if ((lower.includes('balance') || lower === 'bal') && !Object.values(initMappings).includes('balance')) initMappings[h] = 'balance';
          else if ((lower.includes('reference') || lower.includes('check') || lower.includes('cheque') || lower.includes('ref') || lower === 'chq') && !Object.values(initMappings).includes('reference')) initMappings[h] = 'reference';
        }

        // Handle amount columns — robust patterns for common global bank formats
        const auto: Record<string, string> = {};
        for (const h of headers) {
          const lower = h.toLowerCase().trim();
          // Single signed amount column
          if ((lower.includes('amount') || lower.includes('value') || lower.includes('sum') || lower === 'amt') && !auto.amount && !lower.includes('balance')) {
            auto.amount = h;
          }
          // Money-out patterns: withdrawals, debits, payments, charges, money out
          else if ((lower.includes('withdrawal') || lower.includes('withdrawn') || lower.includes('debit') || lower.includes('dr') || lower.includes('payment') || lower.includes('money out') || lower.includes('outflow') || lower.includes('charge') || lower.includes('purchase') || lower.includes('paid out') || lower === 'dr') && !auto.debit) {
            auto.debit = h;
          }
          // Money-in patterns: deposits, credits, receipts, money in
          else if ((lower.includes('deposit') || lower.includes('deposited') || lower.includes('credit') || lower.includes('cr') || lower.includes('receipt') || lower.includes('money in') || lower.includes('inflow') || lower.includes('paid in') || lower.includes('refund') || lower.includes('income') || lower === 'cr') && !auto.credit) {
            auto.credit = h;
          }
        }

        let pdfAmbiguousSign = false;
        if (isPdf) {
          const amountCols = headers.filter((h: string) => /^Amount_\d+$/i.test(h));
          let negCounts: Record<string, number> = {};
          let posCounts: Record<string, number> = {};
          let popCounts: Record<string, number> = {};
          let magSums: Record<string, number> = {};

          const serverColumnMeta: Array<{name: string; kind: string; populatedCount: number; avgMagnitude: number; samples: number[]}> | null =
            combined.columnMeta || null;

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

          const totalRows = rows.length || 1;
          const avgMag = (c: string) => (popCounts[c] ? magSums[c] / popCounts[c] : 0);
          let balanceCol: string | undefined;

          if (serverColumnMeta) {
            const serverBalance = serverColumnMeta.find(m => m.kind === 'balance');
            if (serverBalance && amountCols.includes(serverBalance.name)) {
              balanceCol = serverBalance.name;
            }
          }

          if (!balanceCol && amountCols.length >= 2) {
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

          if (serverColumnMeta && splitCols.length >= 2 && !hasAnyNegative) {
            const positiveOnlyCols = serverColumnMeta
              .filter(m => m.kind === 'positive-only' && splitCols.includes(m.name))
              .map(m => m.name);

            if (positiveOnlyCols.length >= 2) {
              const byPop = positiveOnlyCols.sort((a, b) => (popCounts[b] || 0) - (popCounts[a] || 0));
              auto.debit = byPop[0];
              auto.credit = byPop[1];
            } else {
              auto.debit = splitCols[0];
              auto.credit = splitCols[1];
              pdfAmbiguousSign = true;
            }
          } else if (hasAnyNegative) {
            auto.debit = sortedByNeg[0];
            const creditCandidate = sortedByPos.find((c: string) => c !== auto.debit);
            if (creditCandidate) auto.credit = creditCandidate;
          } else if (splitCols.length >= 2) {
            auto.debit = splitCols[0];
            auto.credit = splitCols[1];
            pdfAmbiguousSign = true;
          } else if (splitCols.length === 1) {
            auto.amount = splitCols[0];
            pdfAmbiguousSign = true;
          }
          if (balanceCol) auto.balance = balanceCol;
        }

        // Apply auto-mapped roles
        if (auto.date && headers.includes(auto.date)) initMappings[auto.date] = 'date';
        if (auto.description && headers.includes(auto.description)) initMappings[auto.description] = 'description';
        if (auto.amount && headers.includes(auto.amount)) initMappings[auto.amount] = 'signed_amount';
        if (auto.debit && headers.includes(auto.debit)) {
          initMappings[auto.debit] = wizardImportType === 'credit_card' ? 'card_charge' : 'money_out';
        }
        if (auto.credit && headers.includes(auto.credit)) {
          initMappings[auto.credit] = wizardImportType === 'credit_card' ? 'card_payment' : 'money_in';
        }
        if (auto.balance && headers.includes(auto.balance)) initMappings[auto.balance] = 'balance';

        setWizardPdfAmbiguousSign(pdfAmbiguousSign);
      }

      setWizardMappings(initMappings);
      setWizardStep('map');

      if (allErrors.length > 0) {
        setToast({ message: `${allResults.length} files parsed, ${allErrors.length} had warnings.`, type: 'success' });
      }
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Failed to parse files', type: 'danger' });
    }
  }

  function generatePreviewFromMappings() {
    const parsed = wizardParsed;
    if (!parsed) return;

    const { rows } = parsed;
    const mappings = wizardMappings; // header → role

    // Find which columns map to each role
    const dateCol = Object.entries(mappings).find(([, role]) => role === 'date')?.[0];
    const descCol = Object.entries(mappings).find(([, role]) => role === 'description')?.[0];
    const moneyOutCol = Object.entries(mappings).find(([, role]) => role === 'money_out')?.[0];
    const moneyInCol = Object.entries(mappings).find(([, role]) => role === 'money_in')?.[0];
    const chargeCol = Object.entries(mappings).find(([, role]) => role === 'card_charge')?.[0];
    const paymentCol = Object.entries(mappings).find(([, role]) => role === 'card_payment')?.[0];
    const signedAmountCol = Object.entries(mappings).find(([, role]) => role === 'signed_amount')?.[0];
    const balanceCol = Object.entries(mappings).find(([, role]) => role === 'balance')?.[0];
    const referenceCol = Object.entries(mappings).find(([, role]) => role === 'reference')?.[0];

    const isCreditCard = wizardImportType === 'credit_card';

    const preview = rows.slice(0, 10).map((row: any) => {
      let amt = 0;
      let rawMoneyOut: number | undefined;
      let rawMoneyIn: number | undefined;
      let rawCharge: number | undefined;
      let rawPayment: number | undefined;

      if (moneyOutCol && row.raw[moneyOutCol] !== undefined) {
        rawMoneyOut = parseFloat(String(row.raw[moneyOutCol]).replace(/[$,]/g, '')) || 0;
      }
      if (moneyInCol && row.raw[moneyInCol] !== undefined) {
        rawMoneyIn = parseFloat(String(row.raw[moneyInCol]).replace(/[$,]/g, '')) || 0;
      }
      if (chargeCol && row.raw[chargeCol] !== undefined) {
        rawCharge = parseFloat(String(row.raw[chargeCol]).replace(/[$,]/g, '')) || 0;
      }
      if (paymentCol && row.raw[paymentCol] !== undefined) {
        rawPayment = parseFloat(String(row.raw[paymentCol]).replace(/[$,]/g, '')) || 0;
      }

      if (signedAmountCol && row.raw[signedAmountCol]) {
        amt = parseFloat(String(row.raw[signedAmountCol]).replace(/[$,]/g, '')) || 0;
      } else if (isCreditCard && rawCharge !== undefined && rawPayment !== undefined) {
        amt = rawPayment - rawCharge;
      } else if (!isCreditCard && rawMoneyOut !== undefined && rawMoneyIn !== undefined) {
        amt = rawMoneyIn - rawMoneyOut;
      } else if (rawMoneyOut !== undefined) {
        amt = -Math.abs(rawMoneyOut);
      } else if (rawCharge !== undefined) {
        amt = -Math.abs(rawCharge);
      } else if (rawMoneyIn !== undefined) {
        amt = Math.abs(rawMoneyIn);
      } else if (rawPayment !== undefined) {
        amt = Math.abs(rawPayment);
      }

      if (wizardSignDirection === 'inverted') amt = -amt;

      const balRaw = balanceCol ? row.raw[balanceCol] : undefined;
      const bal = balRaw ? parseFloat(String(balRaw).replace(/[$,]/g, '')) || undefined : undefined;

      return {
        date: dateCol ? (row.raw[dateCol] ?? '') : '',
        description: descCol ? (row.raw[descCol] ?? '') : '',
        amount: amt,
        balance: bal,
        reference: referenceCol ? (row.raw[referenceCol] ?? '') : '',
        moneyOut: rawMoneyOut,
        moneyIn: rawMoneyIn,
        charge: rawCharge,
        payment: rawPayment,
      };
    });

    setWizardPreview(preview);
    setWizardStep('review');
  }

  async function confirmImport() {
    if (!wizardParsed) return;
    if (!wizardCoaAccountId) {
      setToast({ message: 'Please select an account before importing.', type: 'danger' });
      return;
    }

    // Must have a FinancialAccount to import into
    let finAcctId = wizardFinancialAccountId || linkedFinancialAccount?.id;
    if (!finAcctId) {
      // Auto-create one if needed
      const created = await createWizardFinancialAccount();
      if (!created) return;
      finAcctId = created.id;
    }

    setWizardImporting(true);

    const { rows } = wizardParsed;
    const mappings = wizardMappings;

    const dateCol = Object.entries(mappings).find(([, role]) => role === 'date')?.[0];
    const descCol = Object.entries(mappings).find(([, role]) => role === 'description')?.[0];
    const moneyOutCol = Object.entries(mappings).find(([, role]) => role === 'money_out')?.[0];
    const moneyInCol = Object.entries(mappings).find(([, role]) => role === 'money_in')?.[0];
    const chargeCol = Object.entries(mappings).find(([, role]) => role === 'card_charge')?.[0];
    const paymentCol = Object.entries(mappings).find(([, role]) => role === 'card_payment')?.[0];
    const signedAmountCol = Object.entries(mappings).find(([, role]) => role === 'signed_amount')?.[0];
    const balanceCol = Object.entries(mappings).find(([, role]) => role === 'balance')?.[0];

    const isCreditCard = wizardImportType === 'credit_card';

    const mappedRows = rows.map((row: any) => {
      let amt = 0;
      let rawMoneyOut: number | undefined;
      let rawMoneyIn: number | undefined;
      let rawCharge: number | undefined;
      let rawPayment: number | undefined;

      if (moneyOutCol && row.raw[moneyOutCol] !== undefined) {
        rawMoneyOut = parseFloat(String(row.raw[moneyOutCol]).replace(/[$,]/g, '')) || 0;
      }
      if (moneyInCol && row.raw[moneyInCol] !== undefined) {
        rawMoneyIn = parseFloat(String(row.raw[moneyInCol]).replace(/[$,]/g, '')) || 0;
      }
      if (chargeCol && row.raw[chargeCol] !== undefined) {
        rawCharge = parseFloat(String(row.raw[chargeCol]).replace(/[$,]/g, '')) || 0;
      }
      if (paymentCol && row.raw[paymentCol] !== undefined) {
        rawPayment = parseFloat(String(row.raw[paymentCol]).replace(/[$,]/g, '')) || 0;
      }

      if (signedAmountCol && row.raw[signedAmountCol]) {
        amt = parseFloat(String(row.raw[signedAmountCol]).replace(/[$,]/g, '')) || 0;
      } else if (isCreditCard && rawCharge !== undefined && rawPayment !== undefined) {
        amt = rawPayment - rawCharge;
      } else if (!isCreditCard && rawMoneyOut !== undefined && rawMoneyIn !== undefined) {
        amt = rawMoneyIn - rawMoneyOut;
      } else if (rawMoneyOut !== undefined) {
        amt = -Math.abs(rawMoneyOut);
      } else if (rawCharge !== undefined) {
        amt = -Math.abs(rawCharge);
      } else if (rawMoneyIn !== undefined) {
        amt = Math.abs(rawMoneyIn);
      } else if (rawPayment !== undefined) {
        amt = Math.abs(rawPayment);
      }
      if (wizardSignDirection === 'inverted') amt = -amt;

      return {
        date: dateCol ? (row.raw[dateCol] ?? row.date ?? '') : (row.date ?? ''),
        description: descCol ? (row.raw[descCol] ?? row.description ?? '') : (row.description ?? ''),
        amount: String(amt),
      };
    });

    try {
      const res = await fetchWithTenantHeaders('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: finAcctId,
          mappedRows,
          fileType: wizardParsed.fileType,
          skipDuplicates: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      if (!json.data) throw new Error('Import failed');

      // Save column mapping if enabled
      if (wizardSaveMapping) {
        try {
          const headers = wizardParsed.headers || [];
          const headerSig = buildHeaderSignature(headers);

          // Build the mappingsJson and column references
          const mappingsJson: Record<string, string> = {};
          for (const [header, role] of Object.entries(mappings)) {
            if (role !== 'ignore') mappingsJson[header] = role;
          }

          await fetchWithTenantHeaders('/api/column-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              financialAccountId: finAcctId,
              dateColumn: dateCol || '',
              descriptionColumn: descCol || '',
              amountColumn: signedAmountCol || null,
              debitColumn: moneyOutCol || chargeCol || null,
              creditColumn: moneyInCol || paymentCol || null,
              balanceColumn: balanceCol || null,
              signDirection: wizardSignDirection,
              headerSignature: headerSig,
              mappingsJson,
              profileName: wizardSavedMapping?.profileName || null,
            }),
          });
        } catch {
          // Non-critical — mapping save failed but import succeeded
        }
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

  // Get the available roles for the current import type
  const availableRoles = useMemo(() => {
    return wizardImportType === 'credit_card' ? creditCardRoles() : bankRoles();
  }, [wizardImportType]);

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
                        {chartAccounts.length === 0 ? (
                          <option value="" disabled>No categories available</option>
                        ) : chartAccounts.map((cat) => (
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
                            onClick={() => categorizeTransaction(tx.id, chartAccounts[0]?.id || '')}
                            disabled={chartAccounts.length === 0}
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

          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-100 w-full max-w-[800px] max-h-[85vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)] z-10">
              <h2 className="t-h3 flex-1">Import Statement</h2>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  wizardStep === 'account' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>1</span>
                <span className="w-4 h-px bg-[var(--border)]" />
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  wizardStep === 'upload' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>2</span>
                <span className="w-4 h-px bg-[var(--border)]" />
                <span className={cn(
                  'w-8 h-8 rounded-full grid place-items-center text-xs font-bold',
                  (wizardStep === 'map' || wizardStep === 'review') ? 'bg-[var(--primary)] text-white' : 'bg-[var(--neutral-soft)] text-[var(--text-muted)]'
                )}>3</span>
              </div>
              <button onClick={closeWizard}
                className="w-8 h-8 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]">
                <X size={16} />
              </button>
            </div>

            {/* Step 1 — Select Account from Chart of Accounts */}
            {wizardStep === 'account' && (
              <div className="p-5 space-y-4">
                {!hasSelectedCompany && (
                  <Alert variant="danger">
                    Select a company first. The importer cannot create bank accounts or save transactions until the app has an active company.
                  </Alert>
                )}

                <div className="text-sm text-[var(--text-muted)]">
                  Choose the account this statement belongs to.
                </div>

                {/* Importable Chart of Accounts */}
                <div className="field">
                  <label className="text-sm font-medium text-[var(--text-strong)]">
                    Select account from Chart of Accounts
                  </label>
                  {importableCoaAccounts.length === 0 ? (
                    <div className="text-sm text-[var(--text-muted)] mt-2">
                      No bank or credit card accounts found in your Chart of Accounts.
                      Set up accounts in Chart of Accounts first (e.g. 1010 - Business Checking, 2110 - Business Credit Card).
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1 max-h-[240px] overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                      {importableCoaAccounts.map((coa) => {
                        const isSelected = wizardCoaAccountId === coa.id;
                        const linked = accounts.find((a) => a.glAccountCode === coa.code);
                        return (
                          <button
                            key={coa.id}
                            onClick={() => handleCoaAccountSelect(coa.id)}
                            className={cn(
                              'w-full text-left px-4 py-3 transition-colors hover:bg-[var(--surface-2)]',
                              isSelected && 'bg-[var(--primary-soft)] border-l-2 border-l-[var(--primary)]'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className={cn(
                                'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                                isSelected ? 'border-[var(--primary)]' : 'border-[var(--border-strong)]'
                              )}>
                                {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-[var(--text-strong)]">
                                  {coa.code} — {coa.name}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant={coa.type === 'asset' ? 'info' : 'pending'}>
                                    {coa.type === 'asset' ? 'Bank / Cash' : 'Credit Card'}
                                  </Badge>
                                  <span className="text-xs text-[var(--text-muted)] font-mono">
                                    {money(coa.balance ?? 0)}
                                  </span>
                                  {linked && (
                                    <span className="text-xs text-[var(--success)]">
                                      ✓ Linked to {linked.name}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronDown size={16} className={cn(
                                'text-[var(--text-faint)] transition-transform',
                                isSelected && 'rotate-180'
                              )} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* If a COA account is selected and linked, show it */}
                {wizardCoaAccountId && linkedFinancialAccount && (
                  <div className="bg-[var(--success-soft)] border border-[var(--success)]/20 rounded-lg p-3 text-sm">
                    <span className="font-medium">Linked account:</span> {linkedFinancialAccount.name}
                    {' '}({linkedFinancialAccount.kind}) · Balance: {money(linkedFinancialAccount.currentBalance)}
                  </div>
                )}

                {/* If COA selected but NOT linked, offer to create one */}
                {wizardCoaAccountId && !linkedFinancialAccount && !wizardFinancialAccountId && (
                  <Alert variant="warning">
                    <div className="space-y-3">
                      <div className="text-sm">
                        No bank account is linked to {selectedCoaAccount?.code} — {selectedCoaAccount?.name}.
                        Create one now.
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="field">
                          <label>Account name</label>
                          <input
                            className="input"
                            value={wizardNewAccountName}
                            onChange={(e) => setWizardNewAccountName(e.target.value)}
                            placeholder={selectedCoaAccount?.name || 'Account name'}
                          />
                        </div>
                        <div className="field">
                          <label>Account type</label>
                          <select
                            className="select"
                            value={wizardNewAccountKind}
                            onChange={(e) => setWizardNewAccountKind(e.target.value as FinancialAccount['kind'])}
                          >
                            {wizardImportType === 'credit_card' ? (
                              <option value="creditcard">Credit card</option>
                            ) : (
                              <>
                                <option value="checking">Checking</option>
                                <option value="savings">Savings</option>
                              </>
                            )}
                          </select>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button onClick={createWizardFinancialAccount} disabled={wizardCreatingAccount || !hasSelectedCompany}>
                          {wizardCreatingAccount ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                          Create account
                        </Button>
                      </div>
                    </div>
                  </Alert>
                )}

                <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
                  <Button variant="secondary" onClick={closeWizard}>
                    Cancel
                  </Button>
                  <div className="flex-1" />
                  <Button onClick={handleContinueToUpload} disabled={!wizardCoaAccountId}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 — Upload Statement */}
            {wizardStep === 'upload' && (
              <div className="p-5 space-y-4">
                {/* Selected account info */}
                {selectedCoaAccount && (
                  <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3 text-sm">
                    <span className="text-[var(--text-muted)]">Importing into:</span>{' '}
                    <span className="font-semibold text-[var(--text-strong)]">
                      {selectedCoaAccount.code} — {selectedCoaAccount.name}
                    </span>
                    <Badge variant={wizardImportType === 'credit_card' ? 'pending' : 'info'} className="ml-2">
                      {wizardImportType === 'credit_card' ? 'Credit Card' : 'Bank'}
                    </Badge>
                  </div>
                )}

                <div className="text-sm text-[var(--text-muted)]">
                  Upload your statement file. Supported formats: CSV, OFX, QFX, PDF.
                </div>

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

                <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
                  <Button variant="secondary" onClick={() => setWizardStep('account')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                </div>
              </div>
            )}

            {/* Step 3 — Map Columns & Preview */}
            {wizardStep === 'map' && wizardParsed && (
              <div className="p-5 space-y-4">
                {/* File info bar */}
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  <Badge variant="info">{wizardParsed.fileType?.toUpperCase()}</Badge>
                  <span className="text-[var(--text-muted)]">
                    {wizardParsed.totalRows} rows · {wizardParsed.headers.length} columns
                  </span>
                  {wizardFiles.length > 0 && (
                    <span className="text-[var(--text-muted)] text-xs truncate max-w-[250px]">
                      {wizardFiles.map(f => f.name).join(', ')}
                    </span>
                  )}
                </div>

                {/* Saved mapping banner */}
                {wizardSavedMapping && (
                  <Alert variant="info">
                    <div className="flex items-center gap-2">
                      <Check size={16} />
                      <span>
                        Saved mapping applied from {wizardSavedMapping.profileName || 'previous import'}.
                        You can adjust the mapping below before importing.
                      </span>
                    </div>
                  </Alert>
                )}

                {wizardPdfAmbiguousSign && (
                  <Alert variant="warning">
                    This file's amounts don't have distinguishing signs or separate debit/credit columns —
                    LedgerPro can't reliably tell debits from credits for it. Check the column mapping below
                    against the sample values, and carefully verify each transaction in the review step before importing.
                  </Alert>
                )}

                <div className="text-sm text-[var(--text-muted)]">
                  Select how each statement column should be used.
                </div>

                {/* A. Original Statement Preview with "Treat as" dropdowns above each column */}
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
                    <FileText size={14} className="text-[var(--text-muted)]" />
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      Original Statement Preview
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          {wizardParsed.headers.map((header: string) => (
                            <th key={header} className="px-2 py-1 align-top">
                              <div className="text-[var(--text-faint)] text-[10px] mb-1 truncate max-w-[140px]" title={header}>
                                {header}
                              </div>
                              <select
                                className="w-full h-[28px] px-1 text-[11px] rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-strong)] focus:outline-none focus:border-[var(--border-focus)]"
                                value={wizardMappings[header] || 'ignore'}
                                onChange={(e) =>
                                  setWizardMappings({ ...wizardMappings, [header]: e.target.value })
                                }
                              >
                                {availableRoles.map((role) => (
                                  <option key={role.value} value={role.value} title={role.help}>
                                    {role.label}
                                  </option>
                                ))}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wizardParsed.rows.slice(0, 5).map((row: any, ri: number) => (
                          <tr key={ri} className="border-b border-[var(--border)] last:border-0">
                            {wizardParsed.headers.map((header: string) => (
                              <td key={header} className="px-2 py-1.5 text-[var(--text)] whitespace-nowrap max-w-[140px] truncate font-mono text-[11px]">
                                {row.raw?.[header] ?? row[header] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* B. Normalized Import Preview */}
                {(() => {
                  const dateCol = Object.entries(wizardMappings).find(([, r]) => r === 'date')?.[0];
                  const descCol = Object.entries(wizardMappings).find(([, r]) => r === 'description')?.[0];
                  const moneyOutCol = Object.entries(wizardMappings).find(([, r]) => r === 'money_out')?.[0];
                  const moneyInCol = Object.entries(wizardMappings).find(([, r]) => r === 'money_in')?.[0];
                  const chargeCol = Object.entries(wizardMappings).find(([, r]) => r === 'card_charge')?.[0];
                  const paymentCol = Object.entries(wizardMappings).find(([, r]) => r === 'card_payment')?.[0];
                  const signedAmtCol = Object.entries(wizardMappings).find(([, r]) => r === 'signed_amount')?.[0];
                  const balCol = Object.entries(wizardMappings).find(([, r]) => r === 'balance')?.[0];
                  const refCol = Object.entries(wizardMappings).find(([, r]) => r === 'reference')?.[0];
                  const isCC = wizardImportType === 'credit_card';
                  const normCols = normalizedPreviewColumns(wizardImportType);

                  const previewRows = wizardParsed.rows.slice(0, 5).map((row: any) => {
                    let amt = 0;
                    let rawMoneyOut: number | undefined;
                    let rawMoneyIn: number | undefined;
                    let rawCharge: number | undefined;
                    let rawPayment: number | undefined;

                    // Parse individual column values first
                    if (moneyOutCol && row.raw[moneyOutCol] !== undefined) {
                      rawMoneyOut = parseFloat(String(row.raw[moneyOutCol]).replace(/[$,]/g, '')) || 0;
                    }
                    if (moneyInCol && row.raw[moneyInCol] !== undefined) {
                      rawMoneyIn = parseFloat(String(row.raw[moneyInCol]).replace(/[$,]/g, '')) || 0;
                    }
                    if (chargeCol && row.raw[chargeCol] !== undefined) {
                      rawCharge = parseFloat(String(row.raw[chargeCol]).replace(/[$,]/g, '')) || 0;
                    }
                    if (paymentCol && row.raw[paymentCol] !== undefined) {
                      rawPayment = parseFloat(String(row.raw[paymentCol]).replace(/[$,]/g, '')) || 0;
                    }

                    // Compute net amount in the same way confirmImport does
                    if (signedAmtCol && row.raw[signedAmtCol]) {
                      amt = parseFloat(String(row.raw[signedAmtCol]).replace(/[$,]/g, '')) || 0;
                      if (wizardSignDirection === 'inverted') amt = -amt;
                    } else if (isCC && rawCharge !== undefined && rawPayment !== undefined) {
                      amt = rawPayment - rawCharge;
                    } else if (!isCC && rawMoneyOut !== undefined && rawMoneyIn !== undefined) {
                      amt = rawMoneyIn - rawMoneyOut;
                    } else if (rawMoneyOut !== undefined) {
                      amt = -Math.abs(rawMoneyOut);
                    } else if (rawCharge !== undefined) {
                      amt = -Math.abs(rawCharge);
                    } else if (rawMoneyIn !== undefined) {
                      amt = Math.abs(rawMoneyIn);
                    } else if (rawPayment !== undefined) {
                      amt = Math.abs(rawPayment);
                    }
                    if (wizardSignDirection === 'inverted') amt = -amt;

                    return {
                      date: dateCol ? (row.raw[dateCol] ?? '') : '',
                      description: descCol ? (row.raw[descCol] ?? '') : '',
                      amount: amt,
                      balance: balCol ? parseFloat(String(row.raw[balCol] || '').replace(/[$,]/g, '')) || null : null,
                      reference: refCol ? (row.raw[refCol] ?? '') : '',
                    };
                  });

                  const hasAnyData = previewRows.some((r: any) => r.date || r.description || r.amount !== 0);

                  return (
                    <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg overflow-hidden">
                      <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-2">
                        <ArrowRightLeft size={14} className="text-[var(--text-muted)]" />
                        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                          Normalized Import Preview
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)] ml-auto">
                          {isCC ? 'Credit Card Labels' : 'Bank Labels'}
                        </span>
                      </div>
                      {hasAnyData ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-[var(--border)]">
                                {normCols.map((col) => (
                                  <th key={col} className="text-left px-3 py-2 font-mono text-[10px] uppercase text-[var(--text-muted)] whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewRows.map((row: any, ri: number) => (
                                <tr key={ri} className="border-b border-[var(--border)] last:border-0">
                                  <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">{row.date}</td>
                                  <td className="px-3 py-1.5 text-[11px] truncate max-w-[200px]">{row.description}</td>
                                  {isCC ? (
                                    <>
                                      <td className={cn('px-3 py-1.5 font-mono text-[11px] whitespace-nowrap', row.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                                        {row.amount < 0 ? money(Math.abs(row.amount)) : '—'}
                                      </td>
                                      <td className={cn('px-3 py-1.5 font-mono text-[11px] whitespace-nowrap', row.amount > 0 ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                                        {row.amount > 0 ? money(row.amount) : '—'}
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td className={cn('px-3 py-1.5 font-mono text-[11px] whitespace-nowrap', row.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                                        {row.amount < 0 ? money(Math.abs(row.amount)) : '—'}
                                      </td>
                                      <td className={cn('px-3 py-1.5 font-mono text-[11px] whitespace-nowrap', row.amount > 0 ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                                        {row.amount > 0 ? money(row.amount) : '—'}
                                      </td>
                                    </>
                                  )}
                                  <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap text-[var(--text-muted)]">
                                    {row.balance !== null ? money(row.balance) : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap text-[var(--text-muted)]">
                                    {row.reference || '—'}
                                  </td>
                                  <td className="px-3 py-1.5 whitespace-nowrap">
                                    <Badge variant="pending">Ready</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                          Map at least a Date and Description column to see the normalized preview.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Save mapping checkbox */}
                <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--text-strong)]">
                  <input
                    type="checkbox"
                    checked={wizardSaveMapping}
                    onChange={(e) => setWizardSaveMapping(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--ring)]"
                  />
                  Save this mapping for this account and statement format
                </label>

                {/* Mapping validation errors */}
                {mappingValidation.length > 0 && (
                  <div className="bg-[var(--danger-soft)] border border-[var(--danger)]/20 rounded-lg p-3">
                    <ul className="list-disc ml-4 text-xs text-[var(--danger)] space-y-0.5">
                      {mappingValidation.map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Sign direction */}
                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="field flex-1">
                      <label className="text-xs">Sign Direction</label>
                      <Segmented
                        options={[
                          { value: 'normal', label: wizardImportType === 'credit_card' ? 'Normal (credit card)' : 'Normal (bank)' },
                          { value: 'inverted', label: wizardImportType === 'credit_card' ? 'Inverted (bank)' : 'Inverted (credit card)' },
                        ]}
                        value={wizardSignDirection}
                        onChange={(v) => setWizardSignDirection(v as 'normal' | 'inverted')}
                      />
                    </div>
                    <div className="flex-1 text-xs text-[var(--text-muted)] leading-relaxed">
                      {wizardSignDirection === 'normal' ? (
                        wizardImportType === 'credit_card' ? (
                          <span><strong>Credit card (normal):</strong> Charges are positive on statements but are actually money OUT. Sign is flipped so your books show the expense correctly.</span>
                        ) : (
                          <span><strong>Bank (normal):</strong> Debits = money out (negative). Credits = money in (positive).</span>
                        )
                      ) : (
                        wizardImportType === 'credit_card' ? (
                          <span><strong>Inverted (bank-style):</strong> Amounts are treated like a bank statement. Use this if your credit card statement already has charges as negatives.</span>
                        ) : (
                          <span><strong>Inverted (credit-card-style):</strong> Signs are reversed. Use this if your bank statement uses the opposite sign convention.</span>
                        )
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setWizardStep('upload')}>
                    Back
                  </Button>
                  <div className="flex-1" />
                  <Button
                    onClick={generatePreviewFromMappings}
                    disabled={mappingValidation.some(m => m.includes('Date') || m.includes('Description') || m.includes('least one amount'))}
                  >
                    Preview & Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3b — Review & Confirm */}
            {wizardStep === 'review' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4 text-sm flex-wrap">
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
                  <Badge variant={wizardImportType === 'credit_card' ? 'pending' : 'info'}>
                    {wizardImportType === 'credit_card' ? 'Credit Card' : 'Bank'}
                  </Badge>
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

                {/* Normalized preview table for final review */}
                <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      Final Preview — {wizardImportType === 'credit_card' ? 'Credit Card' : 'Bank'} Labels
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[var(--surface-2)] sticky top-0">
                          {normalizedPreviewColumns(wizardImportType).map((col) => (
                            <th key={col} className="text-left px-3 py-2 font-mono text-micro uppercase text-[var(--text-muted)] whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {wizardPreview.map((row: any, i: number) => {
                          const isCC = wizardImportType === 'credit_card';
                          return (
                            <tr key={i} className="border-t border-[var(--border)]">
                              <td className="px-3 py-2 font-mono text-xs">{row.date}</td>
                              <td className="px-3 py-2 text-xs truncate max-w-[200px]">{row.description}</td>
                              {isCC ? (
                                <>
                                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums text-xs', row.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                                    {row.amount < 0 ? money(Math.abs(row.amount)) : '—'}
                                  </td>
                                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums text-xs', row.amount > 0 ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                                    {row.amount > 0 ? money(row.amount) : '—'}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums text-xs', row.amount < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                                    {row.amount < 0 ? money(Math.abs(row.amount)) : '—'}
                                  </td>
                                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums text-xs', row.amount > 0 ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                                    {row.amount > 0 ? money(row.amount) : '—'}
                                  </td>
                                </>
                              )}
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                                {row.balance !== undefined && row.balance !== null ? money(row.balance) : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">
                                {row.reference || '—'}
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant="pending">Ready</Badge>
                              </td>
                            </tr>
                          );
                        })}
                        {wizardPreview.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
                              No preview available. Go back and map your columns.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Save mapping reminder */}
                {wizardSaveMapping && (
                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Check size={14} className="text-[var(--success)]" />
                    Mapping will be saved for this account and applied to future uploads with matching columns.
                  </div>
                )}

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
