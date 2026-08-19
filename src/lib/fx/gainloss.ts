/**
 * FX gain/loss report aggregation.
 *
 * Realized = signed movement (credit − debit) on the realized FX account
 * (4310) from `payment` entries in the period, grouped by the line's
 * transaction currency. Unrealized = the same on 4320 from `revaluation`
 * entries — the entry and its reversal both fall in the window naturally, so
 * the period total IS the movement (satisfying AC 20: realized + unrealized
 * equals the movement in 4310 + 4320 for the period).
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface FxMovementLine {
  currency: string | null;
  signedAmount: number; // credit − debit
  entryId: string;
  entryDate: Date;
  documentId: string | null;
  fromRate: number | null;
  toRate: number | null;
  description: string;
  amountForeign: number | null;
  contactName: string | null;
  kind: 'realized' | 'unrealized';
}

export interface FxReport {
  realizedTotal: number;
  unrealizedTotal: number;
  netTotal: number;
  perCurrency: { currency: string; settled: number; realized: number; unrealized: number; net: number }[];
  largestMovements: {
    date: string;
    ref: string | null;
    description: string;
    rates: string | null; // "1.3402 → 1.3610"
    amount: number;
  }[];
}

export function buildFxReport(
  realized: FxMovementLine[],
  unrealized: FxMovementLine[]
): FxReport {
  const realizedTotal = round2(realized.reduce((s, m) => s + m.signedAmount, 0));
  const unrealizedTotal = round2(unrealized.reduce((s, m) => s + m.signedAmount, 0));
  const netTotal = round2(realizedTotal + unrealizedTotal);

  const byCurrency = new Map<string, { settled: number; realized: number; unrealized: number }>();
  for (const m of realized) {
    const ccy = m.currency ?? 'CAD';
    const row = byCurrency.get(ccy) ?? { settled: 0, realized: 0, unrealized: 0 };
    row.realized = round2(row.realized + m.signedAmount);
    if (m.amountForeign) row.settled = round2(row.settled + m.amountForeign);
    byCurrency.set(ccy, row);
  }
  for (const m of unrealized) {
    const ccy = m.currency ?? 'CAD';
    const row = byCurrency.get(ccy) ?? { settled: 0, realized: 0, unrealized: 0 };
    row.unrealized = round2(row.unrealized + m.signedAmount);
    byCurrency.set(ccy, row);
  }

  const perCurrency = [...byCurrency.entries()]
    .map(([currency, row]) => ({ currency, ...row, net: round2(row.realized + row.unrealized) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const largestMovements = realized
    .filter((m) => m.fromRate !== null && m.toRate !== null)
    .sort((a, b) => Math.abs(b.signedAmount) - Math.abs(a.signedAmount))
    .slice(0, 10)
    .map((m) => ({
      date: m.entryDate.toISOString().slice(0, 10),
      ref: m.documentId,
      description: m.description,
      rates: `${m.fromRate!.toFixed(4)} → ${m.toRate!.toFixed(4)}`,
      amount: round2(m.signedAmount),
    }));

  return { realizedTotal, unrealizedTotal, netTotal, perCurrency, largestMovements };
}
