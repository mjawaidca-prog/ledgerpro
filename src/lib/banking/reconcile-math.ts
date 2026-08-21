/**
 * Reconciliation math — pure functions.
 *
 * ledgerBalance = opening reconciled balance + Σ ticked amounts + Σ known
 * unrecorded statement items (the prototype's convention — the displayed
 * ledger includes statement charges that were never entered, so the
 * difference equals exactly the named causes).
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function ledgerBalanceFor(opts: {
  openingReconciledBalance: number;
  tickedAmounts: number[];
  unrecordedItems: { amount: number }[];
}): number {
  return round2(
    opts.openingReconciledBalance +
      opts.tickedAmounts.reduce((s, a) => s + a, 0) +
      opts.unrecordedItems.reduce((s, u) => s + u.amount, 0)
  );
}

export function reconcileVerdict(opts: {
  statementClosingBalance: number;
  openingReconciledBalance: number;
  tickedAmounts: number[];
  unticked: { description: string; amount: number }[];
  unrecordedItems: { description: string; amount: number }[];
}): { ledgerBalance: number; difference: number; inBalance: boolean; causes: string[] } {
  const ledgerBalance = ledgerBalanceFor({
    openingReconciledBalance: opts.openingReconciledBalance,
    tickedAmounts: opts.tickedAmounts,
    unrecordedItems: opts.unrecordedItems,
  });
  const difference = round2(opts.statementClosingBalance - ledgerBalance);
  const inBalance = Math.abs(difference) < 0.01;

  const fmt = (n: number) =>
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const causes: string[] = [];
  for (const u of opts.unticked) {
    causes.push(`${u.description} for ${fmt(u.amount)} is unticked`);
  }
  for (const item of opts.unrecordedItems) {
    causes.push(`a bank charge of ${fmt(item.amount)} on the statement was never entered`);
  }

  return { ledgerBalance, difference, inBalance, causes };
}

/** Lock advances monotonically — never regresses. */
export function nextLockedThrough(priorLockedThrough: string | null, periodEnd: string): string | null {
  if (!periodEnd) return priorLockedThrough;
  if (!priorLockedThrough) return periodEnd;
  return periodEnd > priorLockedThrough ? periodEnd : priorLockedThrough;
}

/** Reopen rolls the lock back to the previous locked reconciliation's end. */
export function rolledBackLockedThrough(current: string, priorLockedPeriodEnd: string | null): string | null {
  return priorLockedPeriodEnd && priorLockedPeriodEnd < current ? priorLockedPeriodEnd : null;
}
