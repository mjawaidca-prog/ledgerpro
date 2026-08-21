/**
 * Splits & tax math — pure functions.
 *
 * Inclusive tax backout: taxAmount = gross − gross/(1 + rate), rounded
 * half-up to the cent; the LAST split absorbs any rounding difference so
 * Σ splits always ties to the transaction to the cent.
 */

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
}

export interface ComputedSplit {
  categoryCode: string;
  gross: number;
  net: number;
  taxAmount: number;
  taxCode: string | null;
  taxRate: number | null;
  taxInclusive: boolean;
  memo?: string;
}

export function computeSplitTaxes(splits: SplitLine[]): ComputedSplit[] {
  const out: ComputedSplit[] = splits.map((s) => ({
    categoryCode: s.categoryCode,
    gross: round2(s.amount),
    net: round2(s.amount),
    taxAmount: 0,
    taxCode: s.taxCode,
    taxRate: s.taxRate,
    taxInclusive: s.taxInclusive,
    memo: s.memo,
  }));

  for (let i = 0; i < out.length; i++) {
    const s = splits[i];
    const c = out[i];
    if (s.taxRate) {
      if (s.taxInclusive) {
        c.net = netOfInclusiveTax(c.gross, s.taxRate);
        c.taxAmount = inclusiveTaxAmount(c.gross, s.taxRate);
      } else {
        c.taxAmount = exclusiveTaxAmount(c.net, s.taxRate);
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
export function buildPostingLines(input: {
  splits: { categoryCode: string; net: number; taxAmount: number; taxCode: string | null }[];
  direction: 'in' | 'out';
  bankAccountCode: string;
  total: number;
  description: string;
  currency?: string;
  fxRate?: number;
  amountForeign?: number;
}): JournalLineLike[] {
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
    if (input.direction === 'out') {
      if (s.net > 0) {
        lines.push({ glAccountCode: s.categoryCode, description: input.description, debit: round2(s.net), credit: 0 });
      }
      if (s.taxAmount > 0) {
        lines.push({ glAccountCode: '2300', description: `Tax on ${input.description}`, debit: round2(s.taxAmount), credit: 0 });
      }
    } else {
      if (s.net > 0) {
        lines.push({ glAccountCode: s.categoryCode, description: `Revenue — ${input.description}`, debit: 0, credit: round2(s.net) });
      }
      if (s.taxAmount > 0) {
        lines.push({ glAccountCode: '2300', description: `Tax on ${input.description}`, debit: 0, credit: round2(s.taxAmount) });
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
