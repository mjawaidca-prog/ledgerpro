'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { money, moneySigned } from '@/lib/money';
import { useRouter } from 'next/navigation';
import { Search, Download, Loader2, ChevronDown, ChevronRight, ExternalLink, Plus, X, Pencil } from 'lucide-react';
import { exportChartOfAccounts } from '@/lib/export';
import { GifiDecisionField } from '@/components/coa/GifiDecisionField';
import { GifiReadinessPanel } from '@/components/coa/GifiReadinessPanel';
import { hasValidGifiCode } from '@/lib/gifi';
import { hasGifiDecision, type GifiReadinessAccountInput } from '@/lib/gifi-readiness';
import type { GifiLearningContext } from '@/lib/gifi-learning';
import { activeCompanyFromCompaniesResponse, companyDisplayName } from '@/lib/active-company';
import type { Column } from '@/components/ui/DataTable';

interface COAEntry {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType: string | null;
  gifiCode: string | null;
  gifiUnmappedByChoice: boolean;
  detailType: string | null;
  parentCode: string | null;
  description: string | null;
  balance: number;
  active: boolean;
  financialAccounts: { id: string; name: string; currentBalance: number; kind: string }[];
}

const SUBTYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  asset: [
    { value: '', label: '— Not classified —' },
    { value: 'current_asset', label: 'Current Asset' },
    { value: 'fixed_asset', label: 'Fixed Asset' },
    { value: 'other_asset', label: 'Other Asset' },
  ],
  liability: [
    { value: '', label: '— Not classified —' },
    { value: 'current_liability', label: 'Current Liability' },
    { value: 'long_term_liability', label: 'Long-Term Liability' },
  ],
  equity: [
    { value: '', label: '— Not classified —' },
    { value: 'common_shares', label: 'Common Shares' },
    { value: 'retained_earnings', label: 'Retained Earnings' },
    { value: 'owners_equity', label: "Owner's Equity" },
    { value: 'other_equity', label: 'Other Equity' },
  ],
  income: [],
  expense: [],
};

interface Summary {
  assets: number;
  liabilities: number;
  equity: number;
  income: number;
  expenses: number;
}

const typeLabels: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
};

const typeColors: Record<string, string> = {
  asset: 'green', liability: 'amber', equity: 'blue', income: 'green', expense: 'red',
};

export default function ChartOfAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<COAEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({ assets: 0, liabilities: 0, equity: 0, income: 0, expenses: 0 });
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState<string | null>(null);
  // Unfiltered ACTIVE accounts for the GIFI readiness panel — the
  // export's population, unaffected by the list's search/type filters.
  const [readinessAccounts, setReadinessAccounts] = useState<GifiReadinessAccountInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['asset', 'liability', 'equity', 'income', 'expense']));
  const [showNewModal, setShowNewModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('expense');
  const [newDetailType, setNewDetailType] = useState('');
  const [newParentCode, setNewParentCode] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newGifiCode, setNewGifiCode] = useState('');
  // GIFI-at-creation (Phase 1): the recorded "leave unmapped" decision.
  const [newGifiUnmapped, setNewGifiUnmapped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Non-blocking warnings returned by the API (e.g. a GIFI code whose
  // statement area fights the account type) — shown after a save.
  const [notice, setNotice] = useState<string[]>([]);

  const [editingAccount, setEditingAccount] = useState<COAEntry | null>(null);
  const [editName, setEditName] = useState('');
  const [editDetailType, setEditDetailType] = useState('');
  const [editSubType, setEditSubType] = useState('');
  const [editGifiCode, setEditGifiCode] = useState('');
  const [editGifiUnmapped, setEditGifiUnmapped] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // GIFI v2 learning (Phase 2): the pattern statistics that re-rank
  // suggestions, fetched once from the events aggregate; advisory —
  // when it fails the forms rank rules-only, exactly as v1 did. The
  // shown-list refs carry each form's currently displayed ranked
  // codes into its save payload, where the API records them as a
  // suggestion event (shown vs chosen is the learning signal).
  const [gifiLearning, setGifiLearning] = useState<GifiLearningContext | undefined>(undefined);
  const newShownRef = useRef<string[]>([]);
  const editShownRef = useRef<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/coa/gifi-events');
        if (!res.ok) return;
        const json = await res.json();
        if (json.data && Array.isArray(json.data.company) && Array.isArray(json.data.global)) {
          setGifiLearning(json.data as GifiLearningContext);
        }
      } catch { /* learning context is advisory */ }
    })();
  }, []);

  function openEdit(acct: COAEntry, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingAccount(acct);
    setEditName(acct.name);
    setEditDetailType(acct.detailType || '');
    setEditSubType(acct.subType || '');
    setEditGifiCode(acct.gifiCode || '');
    setEditGifiUnmapped(acct.gifiUnmappedByChoice === true);
    setEditDescription(acct.description || '');
    setEditActive(acct.active);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingAccount) return;
    setEditSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/coa/${editingAccount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          detailType: editDetailType.trim() || null,
          subType: editSubType || null,
          gifiCode: editGifiCode.trim() || null,
          gifiUnmappedByChoice: editGifiUnmapped,
          gifiShownCodes: editShownRef.current,
          description: editDescription.trim() || null,
          active: editActive,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      setNotice(Array.isArray(json.warnings) ? json.warnings : []);
      setEditingAccount(null);
      fetchCOA();
      fetchReadinessAccounts();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setEditSaving(false); }
  }

  async function createAccount() {
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch('/api/coa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCode.trim(),
          name: newName.trim(),
          type: newType,
          detailType: newDetailType.trim() || null,
          parentCode: newParentCode.trim() || null,
          description: newDescription.trim() || null,
          gifiCode: newGifiCode || null,
          gifiUnmappedByChoice: newGifiUnmapped,
          gifiShownCodes: newShownRef.current,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setNotice(Array.isArray(json.warnings) ? json.warnings : []);
      setShowNewModal(false);
      resetForm();
      fetchCOA();
      fetchReadinessAccounts();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to create');
    } finally { setSaving(false); }
  }

  function resetForm() {
    setNewCode(''); setNewName(''); setNewType('expense');
    setNewDetailType(''); setNewParentCode(''); setNewDescription('');
    setNewGifiCode('');
    setNewGifiUnmapped(false);
    setSaveError(null);
  }

  const fetchCOA = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/coa?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setAccounts(Array.isArray(json.data) ? json.data : []);
      setSummary(json.summary);
      setTotalAccounts(json.totalAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setLoading(false); }
  }, [search, typeFilter]);

  useEffect(() => { fetchCOA(); }, [fetchCOA]);

  const fetchReadinessAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/coa');
      if (!res.ok) return;
      const json = await res.json();
      setReadinessAccounts(Array.isArray(json.data) ? json.data : []);
    } catch { /* readiness panel is advisory */ }
  }, []);

  useEffect(() => { fetchReadinessAccounts(); }, [fetchReadinessAccounts]);

  // Phase 0 (P0-1): the heading previously hardcoded a sample company name
  // ("Northwind Trading") regardless of whose chart this is.
  useEffect(() => {
    fetch('/api/companies')
      .then(r => r.json())
      .then(json => {
        const active = activeCompanyFromCompaniesResponse(json) as { id: string; name?: string | null; legalName?: string | null; businessType?: string | null } | null;
        setCompanyName(companyDisplayName(active, ''));
        setBusinessType(active?.businessType ?? null);
      })
      .catch(() => {});
  }, []);

  function toggleGroup(type: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  // GIFI-at-creation (Phase 1): Save stays disabled until the GIFI
  // state is a decision — a valid code, a design exemption, or the
  // recorded "leave unmapped" choice. Mirrors the API rule
  // (gifiDecisionError) so the button, not a 400, teaches the rule.
  const newGifiDecided = hasGifiDecision({
    name: newName, type: newType, detailType: newDetailType || null,
    gifiCode: newGifiCode || null, gifiUnmappedByChoice: newGifiUnmapped,
  });
  const editGifiDecided = !editingAccount || hasGifiDecision({
    name: editName, type: editingAccount.type, detailType: editDetailType || null,
    subType: editSubType || null,
    gifiCode: editGifiCode || null, gifiUnmappedByChoice: editGifiUnmapped,
  });

  // Group by type
  const grouped: Record<string, COAEntry[]> = {};
  for (const acct of accounts) {
    if (!grouped[acct.type]) grouped[acct.type] = [];
    grouped[acct.type].push(acct);
  }

  const typeOrder = ['asset', 'liability', 'equity', 'income', 'expense'];
  const summaryKey: Record<string, keyof Summary> = {
    asset: 'assets', liability: 'liabilities', equity: 'equity', income: 'income', expense: 'expenses',
  };

  const columns: Column<COAEntry>[] = [
    {
      key: 'code', header: 'Code', sortable: true,
      render: (row) => (
        <span className={cn('font-mono text-sm font-medium', row.parentCode && 'pl-6 text-[var(--text-muted)]')}>
          {row.code}
        </span>
      ),
    },
    {
      key: 'name', header: 'Account Name', sortable: true,
      render: (row) => (
        <div className={cn(row.parentCode && 'pl-6')}>
          <div className={cn('text-sm font-medium', row.parentCode ? 'text-[var(--text)]' : 'text-[var(--text-strong)]')}>
            {row.name}
          </div>
          {row.description && (
            <div className="text-xs text-[var(--text-muted)]">{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type', header: 'Type', sortable: true,
      render: (row) => (
        <Badge variant={typeColors[row.type] as any} dot={false}>{typeLabels[row.type]}</Badge>
      ),
    },
    {
      key: 'detailType', header: 'Detail Type', sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--text-muted)]">{row.detailType || '—'}</span>
      ),
    },
    {
      key: 'gifiCode', header: 'GIFI', sortable: true,
      render: (row) => <GifiCell code={row.gifiCode} byChoice={row.gifiUnmappedByChoice} />,
    },
    {
      key: 'balance', header: 'Balance', type: 'num', sortable: true, align: 'right',
      render: (row) => {
        // Phase 0 (P0-2): show the SIGN. money() formats with Math.abs by
        // default, which made a credit-balance asset (e.g. a suspense
        // account) read as a positive balance here while the Balance Sheet
        // and Trial Balance netted it negative — the same account appeared
        // to disagree with itself across screens.
        const bal = Number(row.balance);
        const isZero = bal === 0;
        const isNegative = bal < 0;
        return (
          <span className={cn(
            'font-mono tabular-nums text-sm font-semibold',
            isZero ? 'text-[var(--text-faint)]' : isNegative ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]'
          )}>
            {bal < 0 ? '−' : ''}{money(bal)}
          </span>
        );
      },
    },
    {
      key: 'active', header: 'Status', sortable: true,
      render: (row) => (
        row.active ? <Badge variant="paid" dot={false}>Active</Badge> : <Badge variant="draft" dot={false}>Inactive</Badge>
      ),
    },
  ];

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
      <div className="content-head">
        <div>
          <h1 className="greet">Chart of Accounts</h1>
          <p className="sub">The complete ledger structure for {companyName || 'your company'} — {totalAccounts} accounts.</p>
        </div>
        <div className="spacer" />
        <Button variant="secondary" onClick={() => exportChartOfAccounts(accounts)}><Download size={16} /> Export</Button>
        <Button onClick={() => setShowNewModal(true)}><PlusIcon /> New Account</Button>
      </div>

      {/* GIFI readiness worklist (Slice 3) */}
      <GifiReadinessPanel
        accounts={readinessAccounts}
        businessType={businessType}
        learning={gifiLearning}
        onSaved={() => { fetchCOA(); fetchReadinessAccounts(); }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4 mb-5">
        {typeOrder.map((type) => {
          const val = summary[summaryKey[type]];
          const colorMap: Record<string, { bg: string; text: string }> = {
            asset: { bg: 'bg-[var(--success-soft)]', text: 'text-[var(--success)]' },
            liability: { bg: 'bg-[var(--warning-soft)]', text: 'text-[var(--warning)]' },
            equity: { bg: 'bg-[var(--primary-soft)]', text: 'text-[var(--accent)]' },
            income: { bg: 'bg-[var(--success-soft)]', text: 'text-[var(--success)]' },
            expense: { bg: 'bg-[var(--danger-soft)]', text: 'text-[var(--danger)]' },
          };
          const cm = colorMap[type];
          return (
            <div key={type} className={cn('rounded-xl p-4 border border-[var(--border)] shadow-[var(--shadow-sm)]', cm.bg)}>
              <div className="text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1">{typeLabels[type]}</div>
              {/* Phase 0.1: signed — the summary can legitimately be negative
                  (e.g. debit-balance liabilities) and must match the Balance
                  Sheet's signed totals, not their absolute values. */}
              <div className={cn('font-mono tabular-nums text-xl font-bold', cm.text)}>{moneySigned(val)}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">
                {grouped[type]?.filter(a => !a.parentCode).length || 0} accounts
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input type="text" placeholder="Search by name, number, or details..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-[38px] pl-[34px] pr-3 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--text-strong)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--ring)]"
          />
        </div>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'asset', label: 'Assets' },
            { value: 'liability', label: 'Liabilities' },
            { value: 'equity', label: 'Equity' },
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Expenses' },
          ]}
          value={typeFilter} onChange={setTypeFilter}
        />
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
      {notice.length > 0 && (
        <Alert variant="warning" className="mb-4">
          {notice.map((n, i) => <div key={i}>{n}</div>)}
        </Alert>
      )}

      {/* Grouped account list */}
      <div className="space-y-4">
        {typeOrder.map((type) => {
          const entries = grouped[type];
          if (!entries || entries.length === 0) return null;
          const isExpanded = expandedGroups.has(type);
          const typeTotal = summary[summaryKey[type]];
          const parentEntries = entries.filter(a => !a.parentCode);

          return (
            <div key={type} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
              <button
                onClick={() => toggleGroup(type)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors text-left"
              >
                {isExpanded ? <ChevronDown size={18} className="text-[var(--text-muted)]" /> : <ChevronRight size={18} className="text-[var(--text-muted)]" />}
                <span className="text-sm font-semibold text-[var(--text-strong)]">{typeLabels[type]}</span>
                <span className="text-xs text-[var(--text-muted)] font-mono">{parentEntries.length} accounts</span>
                <div className="flex-1" />
                <span className={cn(
                  'font-mono tabular-nums text-sm font-semibold',
                  typeTotal >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                )}>
                  {money(typeTotal)}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-[var(--border)]">
                  {parentEntries.map((parent) => (
                    <div key={parent.code}>
                      <div
                        onClick={() => router.push(`/reports/general-ledger?code=${parent.code}&name=${encodeURIComponent(parent.name)}`)}
                        className="flex items-center gap-4 px-5 py-2.5 bg-[var(--surface-2)] text-sm cursor-pointer hover:bg-[var(--primary-soft)] transition-colors group"
                      >
                        <span className="font-mono text-[var(--text-muted)] w-[60px]">{parent.code}</span>
                        <span className="font-medium text-[var(--text-strong)] flex-1 group-hover:text-[var(--primary)] transition-colors">{parent.name}</span>
                        <GifiCell code={parent.gifiCode} byChoice={parent.gifiUnmappedByChoice} />
                        <span className="text-xs text-[var(--text-muted)]">{parent.detailType}</span>
                        <button onClick={(e) => openEdit(parent, e)} className="p-1 rounded hover:bg-[var(--surface-3)] opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil size={12} className="text-[var(--text-faint)]" />
                        </button>
                        <ExternalLink size={12} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 mr-1 transition-opacity" />
                        <span className={cn(
                          'font-mono tabular-nums text-sm font-semibold w-[120px] text-right',
                          Number(parent.balance) >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                        )}>
                          {money(Number(parent.balance))}
                        </span>
                      </div>
                      {entries
                        .filter(a => a.parentCode === parent.code)
                        .map((child) => (
                          <div
                            key={child.code}
                            onClick={() => router.push(`/reports/general-ledger?code=${child.code}&name=${encodeURIComponent(child.name)}`)}
                            className="flex items-center gap-4 px-5 py-2.5 border-t border-[var(--border)] hover:bg-[var(--primary-soft)] text-sm cursor-pointer group transition-colors"
                          >
                            <span className="font-mono text-[var(--text-faint)] w-[60px] pl-6">{child.code}</span>
                            <span className="text-[var(--text)] flex-1 group-hover:text-[var(--primary)] transition-colors">{child.name}</span>
                            <GifiCell code={child.gifiCode} byChoice={child.gifiUnmappedByChoice} />
                            <span className="text-xs text-[var(--text-muted)]">{child.detailType}</span>
                            <button onClick={(e) => openEdit(child, e)} className="p-1 rounded hover:bg-[var(--surface-3)] opacity-0 group-hover:opacity-100 transition-opacity">
                              <Pencil size={12} className="text-[var(--text-faint)]" />
                            </button>
                            <ExternalLink size={12} className="text-[var(--text-faint)] opacity-0 group-hover:opacity-100 mr-1 transition-opacity" />
                            <span className={cn(
                              'font-mono tabular-nums text-sm font-semibold w-[120px] text-right',
                              Number(child.balance) >= 0 ? 'text-[var(--text-strong)]' : 'text-[var(--danger)]'
                            )}>
                              {money(Number(child.balance))}
                            </span>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* New Account Modal */}
      {showNewModal && (
        <>
          <div className="fixed inset-0 z-90 bg-black/40 backdrop-blur-sm" onClick={() => { setShowNewModal(false); resetForm(); }} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-100 w-full max-w-[480px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-strong)]">New Account</h2>
              <button onClick={() => { setShowNewModal(false); resetForm(); }} className="w-8 h-8 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]">
                <X size={16} />
              </button>
            </div>

            {saveError && <Alert variant="danger" className="mb-4">{saveError}</Alert>}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label>Account Code *</label>
                  <input className="input" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="e.g. 6150" />
                </div>
                <div className="field">
                  <label>Account Type *</label>
                  <select className="select" value={newType} onChange={e => setNewType(e.target.value)}>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Account Name *</label>
                <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Software Subscriptions" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label>Detail Type</label>
                  <input className="input" value={newDetailType} onChange={e => setNewDetailType(e.target.value)} placeholder="e.g. Operating Expense" />
                </div>
                <div className="field">
                  <label>Parent Code</label>
                  <input className="input" value={newParentCode} onChange={e => setNewParentCode(e.target.value)} placeholder="e.g. 6000" />
                </div>
              </div>
              <div className="field">
                <label>GIFI Code <span className="text-[var(--text-faint)]">(for CRA T2 export — the account code above is a different number)</span></label>
                <GifiDecisionField
                  name={newName}
                  accountType={newType}
                  detailType={newDetailType || null}
                  value={newGifiCode}
                  onChange={setNewGifiCode}
                  unmappedByChoice={newGifiUnmapped}
                  onUnmappedByChoiceChange={setNewGifiUnmapped}
                  learning={gifiLearning}
                  onShownChange={(shown) => { newShownRef.current = shown.map((s) => s.code); }}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input className="input" value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Optional description" />
              </div>
            </div>

            {!newGifiDecided && (
              <p className="text-xs text-[var(--text-muted)] mt-4">
                To save: use the suggested GIFI code, pick a different one, or tick “Leave unmapped”.
              </p>
            )}
            <div className="flex gap-3 mt-6 justify-end">
              <Button variant="secondary" onClick={() => { setShowNewModal(false); resetForm(); }}>Cancel</Button>
              <Button onClick={createAccount} disabled={saving || !newCode.trim() || !newName.trim() || !newGifiDecided}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Create Account
              </Button>
            </div>
          </div>
        </>
      )}
      {/* Edit Account Modal */}
      {editingAccount && (
        <>
          <div className="fixed inset-0 z-90 bg-black/40 backdrop-blur-sm" onClick={() => setEditingAccount(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-100 w-full max-w-[480px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-lg)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-strong)]">Edit Account {editingAccount.code}</h2>
              <button onClick={() => setEditingAccount(null)} className="w-8 h-8 grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)]">
                <X size={16} />
              </button>
            </div>

            {editError && <Alert variant="danger" className="mb-4">{editError}</Alert>}

            <div className="space-y-3">
              <div className="field">
                <label>Account Name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label>Detail Type</label>
                  <input className="input" value={editDetailType} onChange={e => setEditDetailType(e.target.value)} />
                </div>
                {(SUBTYPE_OPTIONS[editingAccount.type] || []).length > 0 && (
                  <div className="field">
                    <label>Classification</label>
                    <select className="select" value={editSubType} onChange={e => setEditSubType(e.target.value)}>
                      {SUBTYPE_OPTIONS[editingAccount.type].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="field">
                <label>GIFI Code <span className="text-[var(--text-faint)]">(for CRA T2 export)</span></label>
                <GifiDecisionField
                  name={editName}
                  accountType={editingAccount.type}
                  detailType={editDetailType || null}
                  subType={editSubType || null}
                  value={editGifiCode}
                  onChange={setEditGifiCode}
                  unmappedByChoice={editGifiUnmapped}
                  onUnmappedByChoiceChange={setEditGifiUnmapped}
                  learning={gifiLearning}
                  onShownChange={(shown) => { editShownRef.current = shown.map((s) => s.code); }}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input className="input" value={editDescription} onChange={e => setEditDescription(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} />
                Active
              </label>
            </div>

            {!editGifiDecided && (
              <p className="text-xs text-[var(--text-muted)] mt-4">
                To save: use the suggested GIFI code, pick a different one, or tick “Leave unmapped”.
              </p>
            )}
            <div className="flex gap-3 mt-6 justify-end">
              <Button variant="secondary" onClick={() => setEditingAccount(null)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={editSaving || !editName.trim() || !editGifiDecided}>
                {editSaving ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={14} />}
                Save Changes
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

/**
 * GIFI cell for the chart list: the code when the account carries a
 * valid assignable one; an amber flag when it is missing or holds a
 * legacy invalid value (both export as unmapped); a quiet "by choice"
 * note when the unmapped state is a recorded decision (Phase 1), so a
 * decided account never reads as a gap.
 */
function GifiCell({ code, byChoice }: { code: string | null; byChoice?: boolean }) {
  if (code && hasValidGifiCode(code)) {
    return <span className="font-mono text-xs text-[var(--text-muted)]" title={`GIFI ${code}`}>GIFI {code}</span>;
  }
  if (code) {
    return (
      <span className="font-mono text-xs text-[var(--warning)]" title={`Stored GIFI value "${code}" is not an assignable CRA code — it exports as unmapped`}>
        GIFI {code} ⚠
      </span>
    );
  }
  if (byChoice) {
    return <span className="text-xs text-[var(--text-faint)]" title="Left unmapped on purpose — a recorded decision, not a gap">No GIFI · by choice</span>;
  }
  return <span className="text-xs text-[var(--warning)]" title="No GIFI code — this account exports unmapped">No GIFI</span>;
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
