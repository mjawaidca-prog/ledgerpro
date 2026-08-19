/**
 * FX settlement math — pure functions, no DB.
 *
 * Realized gain/loss:
 *   receivables: fxDifference = cashHome − reliefHome  (positive = gain)
 *   payables:    fxDifference = reliefHome − cashHome  (sign flips)
 * Positive posts as a credit to the realized FX account (income), negative
 * as a debit. Rounding happens at each posted amount; sub-cent residue goes
 * to the FX rounding account. Partial settlements relieve pro-rata at the
 * invoice rate — the remainder keeps the original rate.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type SettlementOutcome = 'gain' | 'loss' | 'none';

export interface SettlementJournalLine {
  glAccountCode: string;
  description: string;
  debit: number;
  credit: number;
  currency?: string;
  fxRate?: number;
  debitForeign?: number;
  creditForeign?: number;
}

export interface SettlementComputation {
  amountForeign: number;
  invoiceRate: number;
  settlementRate: number;
  cashHome: number;
  reliefHome: number;
  fxDifference: number;
  outcome: SettlementOutcome;
  residue: number;
  remainingForeign: number;
  remainingHome: number;
}

export function computeSettlement(opts: {
  amountForeign: number;
  invoiceRate: number;
  settlementRate: number;
  remainingForeign: number;
  remainingHome: number;
  isPayable?: boolean;
}): SettlementComputation {
  const { amountForeign, invoiceRate, settlementRate, remainingForeign, remainingHome } = opts;

  const cashHome = round2(amountForeign * settlementRate);
  const reliefHome = round2(amountForeign * invoiceRate);
  const fxDifference = round2(opts.isPayable ? reliefHome - cashHome : cashHome - reliefHome);

  let outcome: SettlementOutcome = 'none';
  if (Math.abs(fxDifference) >= 0.005) outcome = fxDifference > 0 ? 'gain' : 'loss';

  // Sub-cent residue when the journal cannot clear exactly at the cent
  // (only non-zero in edge cases like overpayment splits — the 4390 line
  // absorbs it). Zero by construction for ordinary settlements.
  const residue = round2(
    (opts.isPayable ? reliefHome - cashHome : cashHome - reliefHome) - fxDifference
  );

  const remainingAfter = round2(remainingForeign - amountForeign);
  const remainingHomeAfter = round2(remainingAfter > 0 ? remainingHome - reliefHome : 0);

  return {
    amountForeign,
    invoiceRate,
    settlementRate,
    cashHome,
    reliefHome,
    fxDifference,
    outcome,
    residue,
    remainingForeign: remainingAfter,
    remainingHome: remainingHomeAfter,
  };
}

export interface PaymentJournalSpec {
  cashAccountCode: string;
  receivableAccountCode: string; // 1100 or 2200
  fxAccountCode: string | null; // null → no FX line
  roundingAccountCode: string;
  documentId: string;
  counterpartyName: string;
  currency: string;
}

/**
 * Build the journal lines for a settlement payment.
 * Receivable: DR cash / CR AR. Payable: DR AP / CR cash (signs swap).
 * The FX line posts the difference to the realized FX account; any sub-cent
 * residue posts to the rounding account so the entry balances to the cent.
 */
export function journalLinesForPayment(
  c: SettlementComputation,
  spec: PaymentJournalSpec
): SettlementJournalLine[] {
  const isPayable = spec.receivableAccountCode === '2200';
  const fxCols = {
    currency: spec.currency,
    fxRate: c.settlementRate,
  };

  const lines: SettlementJournalLine[] = [];
  const cashMemo = `Cash received for ${spec.documentId} — ${c.amountForeign.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${spec.currency} @ ${c.settlementRate}`;

  if (isPayable) {
    // Payable settlement: DR AP (relieved at the invoice rate), CR cash.
    lines.push({
      glAccountCode: spec.receivableAccountCode,
      description: `Relieved at the invoice rate ${c.invoiceRate} for ${spec.documentId}`,
      debit: c.reliefHome,
      credit: 0,
      ...fxCols,
      debitForeign: c.amountForeign,
    });
    lines.push({
      glAccountCode: spec.cashAccountCode,
      description: cashMemo,
      debit: 0,
      credit: c.cashHome,
      ...fxCols,
      creditForeign: c.amountForeign,
    });
  } else {
    lines.push({
      glAccountCode: spec.cashAccountCode,
      description: cashMemo,
      debit: c.cashHome,
      credit: 0,
      ...fxCols,
      debitForeign: c.amountForeign,
    });
    lines.push({
      glAccountCode: spec.receivableAccountCode,
      description: `Relieved at the invoice rate ${c.invoiceRate} for ${spec.documentId}`,
      debit: 0,
      credit: c.reliefHome,
      ...fxCols,
      creditForeign: c.amountForeign,
    });
  }

  if (c.outcome !== 'none' && spec.fxAccountCode) {
    const memo = c.fxDifference > 0 ? 'rate moved in your favour' : 'rate moved against you';
    lines.push({
      glAccountCode: spec.fxAccountCode,
      description: `Realized FX ${c.fxDifference > 0 ? 'gain' : 'loss'} for ${spec.documentId} — ${memo}`,
      debit: c.fxDifference > 0 ? 0 : -c.fxDifference,
      credit: c.fxDifference > 0 ? c.fxDifference : 0,
    });
  }

  // Sub-cent residue → rounding account so the entry balances to the cent.
  if (Math.abs(c.residue) >= 0.005) {
    lines.push({
      glAccountCode: spec.roundingAccountCode,
      description: `FX rounding for ${spec.documentId}`,
      debit: c.residue > 0 ? c.residue : 0,
      credit: c.residue < 0 ? -c.residue : 0,
    });
  }

  return lines;
}
