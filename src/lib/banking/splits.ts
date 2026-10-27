/**
 * Splits & tax math — pure functions.
 *
 * Inclusive tax backout: taxAmount = gross − gross/(1 + rate), rounded
 * half-up to the cent; the LAST split absorbs any rounding difference so
 * Σ splits always ties to the transaction to the cent.
 */

import { computeSimpleLineTax, SIMPLE_TAX_ACCOUNT_CODES, type ResolvedTaxAccounts } from '@/lib/tax/simple';
import type { Province } from '@/lib/taxes';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function inclusiveTaxAmount(gross: number, ratePct: number): number {
  if (!ratePct) return 0;
  const rate = ratePct / 100;
  return round2(gross - gross / (1 + rate));
}

export function netOfInclusiveTax(gross: number, ratePct: number): number {
  return round2(gross - inclusiveTaxAmount(gross, ratePct));
}

export function exclusiveTaxAmount(net: number, ratePct: number): number {
  if (!ratePct) return 0;
  return round2(net * (ratePct / 100));
}

export function allocation(splits: { amount: number }[], total: number): { allocated: number; remainder: number } {
  const allocated = round2(splits.reduce((s, x) => s + x.amount, 0));
  return { allocated, remainder: round2(total - allocated) };
}

export interface SplitLine {
  categoryCode: string;
  amount: number;
  taxCode: string | null;
  taxRate: number | null; // percent
  taxInclusive: boolean;
  memo?: string;
  /**
   * Phase 1 simple-path tax (takes precedence over the legacy single-rate
   * fields when present): province of supply; the engine computes the
   * province's components (GST/HST ± PST/RST/QST) with recoverability.
   */
  taxProvince?: string | null;
  /** Purchases: claim GST/HST (and QST) as ITC/ITR. Default true. PST/RST are never recoverable. */
  taxRecoverable?: boolean;
  /**
   * Purchases: fractional recovery 0–100 (e.g. 50 for meals). When present
   * it wins over `taxRecoverable` (see SimpleTaxSpec.recoveryPercent in
   * src/lib/tax/simple.ts); the recoverable fraction goes to the ITC/ITR
   * account(s) and the rest is expensed as non-recoverable.
   */
  taxRecoveryPercent?: number | null;
}

/** Where each dollar of a split's tax belongs in the GL. All zero for untaxed splits. */
export interface SplitTaxBreakdown {
  recoverableGstHst: number; // purchase ITC → recoverable (asset) account
  recoverableQst: number; // purchase ITR → QST recoverable account
  nonrecoverable: number; // expensed into the category account
  outputGstHst: number; // sale → GST/HST output (payable) account
  outputPstRst: number; // sale → PST/RST payable account
  outputQst: number; // sale → QST output account
}

export const emptyTaxBreakdown = (): SplitTaxBreakdown => ({
  recoverableGstHst: 0,
  recoverableQst: 0,
  nonrecoverable: 0,
  outputGstHst: 0,
  outputPstRst: 0,
  outputQst: 0,
});

export interface ComputedSplit {
  categoryCode: string;
  gross: number;
  net: number;
  taxAmount: number;
  taxCode: string | null;
  taxRate: number | null;
  taxInclusive: boolean;
  memo?: string;
  taxProvince?: string | null;
  taxRecoverable?: boolean;
  taxRecoveryPercent?: number | null;
  tax: SplitTaxBreakdown;
}

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

export function computeSplitTaxes(splits: SplitLine[], direction: 'in' | 'out' = 'out'): ComputedSplit[] {
  const out: ComputedSplit[] = splits.map((s) => ({
    categoryCode: s.categoryCode,
    gross: round2(s.amount),
    net: round2(s.amount),
    taxAmount: 0,
    taxCode: s.taxCode,
    taxRate: s.taxRate,
    taxInclusive: s.taxInclusive,
    memo: s.memo,
    taxProvince: s.taxProvince ?? null,
    taxRecoverable: s.taxRecoverable,
    taxRecoveryPercent: s.taxRecoveryPercent ?? null,
    tax: emptyTaxBreakdown(),
  }));

  for (let i = 0; i < out.length; i++) {
    const s = splits[i];
    const c = out[i];
    if (s.taxProvince && (PROVINCES as readonly string[]).includes(s.taxProvince)) {
      // Phase 1 province path — engine math with component recoverability.
      const r = computeSimpleLineTax(c.gross, {
        province: s.taxProvince as Province,
        priceMode: s.taxInclusive ? 'inclusive' : 'exclusive',
        direction: direction === 'in' ? 'sale' : 'purchase',
        recoverable: s.taxRecoverable ?? true,
        recoveryPercent: s.taxRecoveryPercent ?? undefined,
      });
      c.net = r.net;
      c.taxAmount = r.tax;
      if (direction === 'in') {
        c.tax.outputGstHst = r.outputGstHst;
        c.tax.outputPstRst = r.outputPstRst;
        c.tax.outputQst = r.outputQst;
      } else {
        for (const comp of r.components) {
          if (comp.kind === 'QST') c.tax.recoverableQst = round2(c.tax.recoverableQst + comp.recoverable);
          else if (comp.kind === 'GST' || comp.kind === 'HST') c.tax.recoverableGstHst = round2(c.tax.recoverableGstHst + comp.recoverable);
        }
        c.tax.nonrecoverable = r.nonrecoverableTax;
      }
      continue;
    }
    if (s.taxRate) {
      if (s.taxInclusive) {
        c.net = netOfInclusiveTax(c.gross, s.taxRate);
        c.taxAmount = inclusiveTaxAmount(c.gross, s.taxRate);
      } else {
        c.taxAmount = exclusiveTaxAmount(c.net, s.taxRate);
      }
      // Legacy single-rate routing (Phase 1 fix): a purchase's GST/HST is an
      // ITC in the recoverable account — NOT a debit against 2300 payable.
      // A single-rate label naming PST/RST cannot be split into components,
      // so it is treated as non-recoverable and expensed (conservative).
      const label = (s.taxCode ?? '').toUpperCase();
      if (direction === 'in') {
        if (label.includes('PST') || label.includes('RST')) c.tax.outputPstRst = c.taxAmount;
        else if (label.includes('QST')) c.tax.outputQst = c.taxAmount;
        else c.tax.outputGstHst = c.taxAmount;
      } else {
        if (label.includes('PST') || label.includes('RST')) c.tax.nonrecoverable = c.taxAmount;
        else if (label.includes('QST')) c.tax.recoverableQst = c.taxAmount;
        else c.tax.recoverableGstHst = c.taxAmount;
      }
    }
  }

  // The last split absorbs any cent-level drift so the lines sum exactly.
  const totalGross = round2(out.reduce((sum, c) => sum + c.gross, 0));
  const netAndTaxSum = round2(out.reduce((sum, c) => sum + c.net + c.taxAmount, 0));
  const drift = round2(totalGross - netAndTaxSum);
  if (Math.abs(drift) >= 0.005 && out.length > 0) {
    out[out.length - 1].net = round2(out[out.length - 1].net + drift);
  }

  return out;
}

export interface JournalLineLike {
  glAccountCode: string;
  description: string;
  debit: number;
  credit: number;
  currency?: string;
  fxRate?: number;
  debitForeign?: number;
  creditForeign?: number;
}

/**
 * Build posting lines for a split transaction. Outflow: DR each category
 * (net) + DR 2300 (tax) / CR bank (total). Inflow mirrored. Bank line carries
 * the FX columns when the account is foreign-currency.
 */
const DEFAULT_TAX_ACCOUNTS: ResolvedTaxAccounts = {
  output: SIMPLE_TAX_ACCOUNT_CODES.output,
  recoverable: SIMPLE_TAX_ACCOUNT_CODES.recoverable,
  pstPayable: SIMPLE_TAX_ACCOUNT_CODES.pstPayable,
  qstOutput: SIMPLE_TAX_ACCOUNT_CODES.qstOutput,
  qstRecoverable: SIMPLE_TAX_ACCOUNT_CODES.qstRecoverable,
};

export function buildPostingLines(input: {
  splits: { categoryCode: string; net: number; taxAmount: number; taxCode: string | null; tax?: SplitTaxBreakdown }[];
  direction: 'in' | 'out';
  bankAccountCode: string;
  total: number;
  description: string;
  currency?: string;
  fxRate?: number;
  amountForeign?: number;
  /** Resolved per-company tax accounts; defaults to the Phase 1 default codes. */
  taxAccounts?: ResolvedTaxAccounts;
}): JournalLineLike[] {
  const taxAccounts = input.taxAccounts ?? DEFAULT_TAX_ACCOUNTS;
  const lines: JournalLineLike[] = [];
  const fxCols =
    input.currency && input.fxRate
      ? {
          currency: input.currency,
          fxRate: input.fxRate,
          debitForeign: input.direction === 'in' ? input.amountForeign : undefined,
          creditForeign: input.direction === 'out' ? input.amountForeign : undefined,
        }
      : {};

  for (const s of input.splits) {
    // Splits computed before Phase 1 carry no breakdown: fall back to the
    // legacy single-bucket routing (purchase GST/HST → recoverable account,
    // PST/RST-labelled → expense) so every caller gets the fixed routing.
    const tax: SplitTaxBreakdown = s.tax ?? (() => {
      const b = emptyTaxBreakdown();
      if (s.taxAmount > 0) {
        const label = (s.taxCode ?? '').toUpperCase();
        if (input.direction === 'in') {
          if (label.includes('PST') || label.includes('RST')) b.outputPstRst = s.taxAmount;
          else if (label.includes('QST')) b.outputQst = s.taxAmount;
          else b.outputGstHst = s.taxAmount;
        } else {
          if (label.includes('PST') || label.includes('RST')) b.nonrecoverable = s.taxAmount;
          else if (label.includes('QST')) b.recoverableQst = s.taxAmount;
          else b.recoverableGstHst = s.taxAmount;
        }
      }
      return b;
    })();
    if (input.direction === 'out') {
      // Category carries net + non-recoverable tax (expensed); recoverable
      // GST/HST is an ITC asset — it must not reduce the 2300 payable here.
      const categoryAmount = round2(s.net + tax.nonrecoverable);
      if (categoryAmount > 0) {
        lines.push({ glAccountCode: s.categoryCode, description: input.description, debit: categoryAmount, credit: 0 });
      }
      if (tax.recoverableGstHst > 0) {
        lines.push({ glAccountCode: taxAccounts.recoverable, description: `GST/HST ITC on ${input.description}`, debit: round2(tax.recoverableGstHst), credit: 0 });
      }
      if (tax.recoverableQst > 0) {
        lines.push({ glAccountCode: taxAccounts.qstRecoverable, description: `QST ITR on ${input.description}`, debit: round2(tax.recoverableQst), credit: 0 });
      }
    } else {
      if (s.net > 0) {
        lines.push({ glAccountCode: s.categoryCode, description: `Revenue — ${input.description}`, debit: 0, credit: round2(s.net) });
      }
      if (tax.outputGstHst > 0) {
        lines.push({ glAccountCode: taxAccounts.output, description: `GST/HST on ${input.description}`, debit: 0, credit: round2(tax.outputGstHst) });
      }
      if (tax.outputPstRst > 0) {
        lines.push({ glAccountCode: taxAccounts.pstPayable, description: `PST/RST on ${input.description}`, debit: 0, credit: round2(tax.outputPstRst) });
      }
      if (tax.outputQst > 0) {
        lines.push({ glAccountCode: taxAccounts.qstOutput, description: `QST on ${input.description}`, debit: 0, credit: round2(tax.outputQst) });
      }
    }
  }

  // The bank leg balances the entry to the cent.
  const sumOther = round2(lines.reduce((sum, l) => sum + l.debit - l.credit, 0));
  if (input.direction === 'out') {
    lines.push({ glAccountCode: input.bankAccountCode, description: input.description, debit: 0, credit: round2(sumOther), ...fxCols });
  } else {
    lines.push({ glAccountCode: input.bankAccountCode, description: input.description, debit: round2(-sumOther), credit: 0, ...fxCols });
  }

  return lines;
}
