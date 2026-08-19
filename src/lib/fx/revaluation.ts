/**
 * Month-end revaluation — pure computation, no DB.
 *
 * Monetary items only: cash, AR, AP, FX loans. Non-monetary items (prepaids,
 * inventory, fixed assets bought in FX) stay at their historical rate and are
 * excluded. For liabilities the sign inverts: a higher closing rate is a loss
 * (you owe more home currency).
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface RevaluationInputAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType: string | null;
  detailType: string | null;
}

export interface ForeignBalance {
  accountCode: string;
  accountName: string;
  type: 'asset' | 'liability';
  currency: string;
  balanceForeign: number; // Σ debitForeign − creditForeign
  carryingHome: number; // Σ debit − credit (home columns at each document's frozen rate)
}

export interface RevaluationRow {
  code: string;
  account: string;
  ccy: string;
  balanceForeign: number;
  rate: number;
  carryingHome: number;
  revaluedHome: number;
  unrealized: number;
  liability: boolean;
}

/**
 * Monetary iff type is asset/liability, subtype is current/long-term (not
 * fixed), and the account is not a prepaid/inventory account. Verified
 * against the default COA: 1200 = Prepaid Expenses, 1500 = fixed_asset.
 */
export function isMonetaryAccount(acct: RevaluationInputAccount): boolean {
  if (acct.type !== 'asset' && acct.type !== 'liability') return false;
  if (acct.subType === 'fixed_asset' || acct.subType === 'other_asset') return false;
  if (acct.subType && !['current_asset', 'current_liability', 'long_term_liability'].includes(acct.subType)) return false;
  if (acct.detailType && /prepaid|inventory/i.test(acct.detailType)) return false;
  return true;
}

export function buildRevaluationRows(opts: {
  balances: ForeignBalance[];
  rates: Record<string, number>; // currency → closing rate
}): { rows: RevaluationRow[]; net: number; missingRates: string[] } {
  const rows: RevaluationRow[] = [];
  const missingRates = new Set<string>();

  for (const b of opts.balances) {
    if (Math.abs(b.balanceForeign) < 0.005) continue;
    const rate = opts.rates[b.currency];
    if (!rate) {
      missingRates.add(b.currency);
      continue;
    }
    const revaluedHome = round2(b.balanceForeign * rate);
    // Liability inversion: a higher closing rate increases what you owe.
    const unrealized = round2(b.type === 'asset' ? revaluedHome - b.carryingHome : b.carryingHome - revaluedHome);
    if (Math.abs(unrealized) < 0.005) continue;
    rows.push({
      code: b.accountCode,
      account: b.accountName,
      ccy: b.currency,
      balanceForeign: round2(b.balanceForeign),
      rate,
      carryingHome: round2(b.carryingHome),
      revaluedHome,
      unrealized,
      liability: b.type === 'liability',
    });
  }

  const net = round2(rows.reduce((s, r) => s + r.unrealized, 0));
  return { rows, net, missingRates: [...missingRates] };
}

export interface RevaluationJournalLine {
  glAccountCode: string;
  description: string;
  debit: number;
  credit: number;
  currency?: string;
  fxRate?: number;
}

/**
 * Journal lines: gain → DR account / CR unrealized account; loss → DR
 * unrealized / CR account. Re-measurement only — no foreign columns.
 */
export function revaluationJournalLines(
  rows: RevaluationRow[],
  unrealizedAccountCode: string,
  asOfLabel: string
): RevaluationJournalLine[] {
  const lines: RevaluationJournalLine[] = [];
  for (const r of rows) {
    const line = {
      glAccountCode: r.code,
      description: `Revaluation of ${r.account} (${r.ccy}) as at ${asOfLabel}`,
      debit: 0,
      credit: 0,
      currency: r.ccy,
      fxRate: r.rate,
    };
    if (r.unrealized > 0) {
      lines.push({ ...line, debit: r.unrealized });
      lines.push({
        glAccountCode: unrealizedAccountCode,
        description: `Unrealized FX gain — ${r.account} (${r.ccy})`,
        debit: 0,
        credit: r.unrealized,
      });
    } else {
      lines.push({ ...line, credit: -r.unrealized });
      lines.push({
        glAccountCode: unrealizedAccountCode,
        description: `Unrealized FX loss — ${r.account} (${r.ccy})`,
        debit: -r.unrealized,
        credit: 0,
      });
    }
  }
  return lines;
}
