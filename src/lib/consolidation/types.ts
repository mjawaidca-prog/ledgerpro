/**
 * Shared types for consolidated (multi-company) reports.
 *
 * A consolidated report is built from per-entity GL activity (never from
 * ChartOfAccount.balance), translated into one presentation currency, merged
 * on account code, and reduced by intercompany eliminations. All money
 * values in the final report are rounded at presentation only.
 */

export type ConsolidatedStatement =
  | 'balance-sheet'
  | 'profit-loss'
  | 'trial-balance'
  | 'cash-flow'
  | 'gst-summary'
  | 'gifi'
  | 'ar-aging'
  | 'ap-aging';

export const CONSOLIDATED_STATEMENTS: ConsolidatedStatement[] = [
  'balance-sheet',
  'profit-loss',
  'trial-balance',
  'cash-flow',
  'gst-summary',
  'gifi',
  'ar-aging',
  'ap-aging',
];

/** A manual elimination passed by the client (transport: URL-encoded JSON `manualElims`). */
export interface ManualElimination {
  ref: string;
  description: string;
  appliesTo: ConsolidatedStatement[];
  accounts: { companyId: string; glAccountCode: string; debit: number; credit: number }[];
}

/** One translated GL line for one entity (presentation currency, normal-balance sign). */
export interface EntityLine {
  code: string;
  name: string;
  gifiCode: string | null;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType: string | null;
  detailType: string | null;
  /** true when this account is an intercompany control account (isControlAccount). */
  isControlAccount: boolean;
  /** company the control account points at (relatedPartyCompanyId), if any. */
  relatedPartyCompanyId: string | null;
  /** translated normal-balance amount in the presentation currency. */
  amount: number;
}

/** Per-entity metadata for the run. */
export interface EntityInfo {
  companyId: string;
  code: string; // short column-head code, e.g. NHL
  name: string;
  currency: string;
  fxRate: number | null; // closing rate used (null when currency === presentation)
  fxRateType: 'closing' | 'average';
  fxSource: 'dated' | 'fallback' | 'none';
  fiscalYearEnd: string | null; // 'YYYY-MM-DD'
  recut: boolean; // true when its year end differs from the parent's
  held: string; // 'Parent' or ownership %
}

/** A merged report line — one row in the statement. */
export interface ConsolidatedLine {
  code: string;
  name: string;
  gifiCode: string | null;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType: string | null;
  detailType: string | null;
  byEntity: Record<string, number>; // companyId → rounded amount
  elimination: number; // signed, usually negative
  consolidated: number;
}

export interface EliminationAccountsEntry {
  companyId: string;
  glAccountCode: string;
  debit: number;
  credit: number;
}

export interface EliminationEntry {
  id: string;
  ref: string; // ELIM-01, ADJ-01
  description: string;
  source: 'auto' | 'manual';
  amount: number; // positive magnitude eliminated
  accounts: EliminationAccountsEntry[];
  status: 'matched' | 'break' | 'excluded';
  difference: number; // non-zero only when status === 'break'
  appliesTo: ConsolidatedStatement[];
}

export interface ReportSection {
  key: string;
  label: string;
  lines: ConsolidatedLine[];
  totals: { byEntity: Record<string, number>; elimination: number; consolidated: number };
}

export interface ConsolidatedReport {
  groupName: string;
  presentationCurrency: string;
  statement: ConsolidatedStatement;
  period: { asOf: string; from?: string; label: string };
  generatedAt: string;
  entities: EntityInfo[];
  sections: ReportSection[];
  grandTotal: { byEntity: Record<string, number>; elimination: number; consolidated: number };
  eliminations: EliminationEntry[];
  isBalanced: boolean;
  outOfBalanceBy: number;
  notes: string[];
  warnings: { code: string; message: string }[];
}

export interface ConsolidationWarning {
  code: string;
  message: string;
}
