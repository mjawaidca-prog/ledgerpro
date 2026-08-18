'use client';

import { useEffect, useRef, useState } from 'react';

// ── Types (mirror of the server-side contract) ───────────────

export type ConsolidatedStatement =
  | 'balance-sheet'
  | 'profit-loss'
  | 'trial-balance'
  | 'cash-flow'
  | 'gst-summary'
  | 'gifi'
  | 'ar-aging'
  | 'ap-aging';

export const STATEMENTS: { key: ConsolidatedStatement; label: string }[] = [
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'profit-loss', label: 'Profit & Loss' },
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'cash-flow', label: 'Cash Flow' },
  { key: 'gst-summary', label: 'GST/HST/PST summary' },
  { key: 'gifi', label: 'GIFI export' },
  { key: 'ar-aging', label: 'Aged Receivables' },
  { key: 'ap-aging', label: 'Aged Payables' },
];

export interface ManualElimination {
  ref: string;
  description: string;
  appliesTo: ConsolidatedStatement[];
  accounts: { companyId: string; glAccountCode: string; debit: number; credit: number }[];
}

export interface ConsolidatedSetup {
  statement: ConsolidatedStatement;
  companyIds: string[]; // parent first
  asOf: string; // YYYY-MM-DD
  from?: string; // period statements
  compare: 'none' | 'prior_period' | 'prior_year';
  presentationCurrency: string;
  eliminateIntercompany: boolean;
  hideZeroBalances: boolean;
  showEntityColumns: boolean;
  attachWorkingPaper: boolean;
  excludedEliminationIds: string[];
  manualEliminations: ManualElimination[];
}

export type RunStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EntityColumn {
  companyId: string;
  code: string;
  name: string;
  currency: string;
  fxRate: number | null;
  fxRateType: 'closing' | 'average';
  fxSource: 'dated' | 'fallback' | 'none';
  fiscalYearEnd: string | null;
  recut: boolean;
  held: string;
}

export interface ReportLine {
  code: string;
  name: string;
  gifiCode: string | null;
  type: string;
  subType: string | null;
  detailType: string | null;
  byEntity: Record<string, number>;
  elimination: number;
  consolidated: number;
}

export interface ReportSection {
  key: string;
  label: string;
  lines: ReportLine[];
  totals: { byEntity: Record<string, number>; elimination: number; consolidated: number };
}

export interface EliminationRow {
  id: string;
  ref: string;
  description: string;
  source: 'auto' | 'manual';
  amount: number;
  accounts: { companyId: string; glAccountCode: string; debit: number; credit: number }[];
  status: 'matched' | 'break' | 'excluded';
  difference: number;
  appliesTo: ConsolidatedStatement[];
}

export interface ConsolidatedReportData {
  groupName: string;
  presentationCurrency: string;
  statement: ConsolidatedStatement;
  period: { asOf: string; from?: string; label: string };
  generatedAt: string;
  entities: EntityColumn[];
  sections: ReportSection[];
  grandTotal: { byEntity: Record<string, number>; elimination: number; consolidated: number };
  eliminations: EliminationRow[];
  isBalanced: boolean;
  outOfBalanceBy: number;
  notes: string[];
  warnings: { code: string; message: string }[];
}

export interface CompanyOption {
  id: string;
  name: string;
  legalName?: string | null;
  fiscalYearStart?: string | null;
  fiscalYearEnd?: string | null;
  currency?: string;
  role?: string;
}

// ── Defaults & persistence ───────────────────────────────────

export const DEFAULT_SETUP: ConsolidatedSetup = {
  statement: 'balance-sheet',
  companyIds: [],
  asOf: '',
  compare: 'none',
  presentationCurrency: 'CAD',
  eliminateIntercompany: true,
  hideZeroBalances: true,
  showEntityColumns: true,
  attachWorkingPaper: true,
  excludedEliminationIds: [],
  manualEliminations: [],
};

const STORAGE_KEY = 'ledgerpro:consolidated:lastSetup';

export function loadStoredSetup(): ConsolidatedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETUP };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETUP, ...parsed };
  } catch {
    return { ...DEFAULT_SETUP };
  }
}

export function persistSetup(setup: ConsolidatedSetup) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // storage unavailable — ignore
  }
}

/** Signature of the setup that produced the current report (for stale detection). */
export function setupSignature(setup: ConsolidatedSetup): string {
  return JSON.stringify(setup);
}

// ── Dropdown hook (same pattern as the single-company reports) ──

export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ── Number formatting (design prototype conventions) ─────────

export function fmtNum(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

export function fmtCurrency(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}
