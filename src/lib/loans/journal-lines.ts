/**
 * The principal/interest split journal for one loan payment — pure
 * builder, no database. The posting service (server.ts) hands these
 * lines to the app's journal engine (postJournalEntry), which enforces
 * the balance constraint again at posting time.
 *
 * Shape of every loan payment journal:
 *   Dr  Loan payable        principal portion
 *   Dr  Interest expense    interest portion
 *   Cr  Bank                full payment
 * This is the journal the mixed "Motor Vehicle — Ford Credit Payments"
 * expense account was standing in for: the payment is never an expense —
 * only its interest portion is.
 */

import { toDollars } from './engine';

export interface LoanSplitLine {
  glAccountCode: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface SplitPayment {
  interestCents: number;
  principalCents: number;
}

/**
 * Split an ACTUAL payment against a scheduled period. The period's
 * interest is what the schedule says it is (capped at what was actually
 * paid); everything above it is principal. If the borrower paid less
 * than the interest due, the shortfall is not capitalized here — the
 * balance proof (schedule vs GL vs lender statement) is where that
 * difference surfaces.
 */
export function splitActualPayment(
  scheduledInterestCents: number,
  actualAmountCents: number
): SplitPayment {
  if (actualAmountCents <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  const interestCents = Math.min(scheduledInterestCents, actualAmountCents);
  return { interestCents, principalCents: actualAmountCents - interestCents };
}

export function buildSplitJournalLines(input: {
  loanAccountCode: string;
  interestAccountCode?: string | null;
  paymentAccountCode: string;
  principalCents: number;
  interestCents: number;
  description: string;
}): LoanSplitLine[] {
  const { principalCents, interestCents } = input;
  if (principalCents < 0 || interestCents < 0) {
    throw new Error('Loan payment split cannot be negative.');
  }
  if (principalCents + interestCents <= 0) {
    throw new Error('Loan payment split is empty — nothing to post.');
  }
  if (interestCents > 0 && !input.interestAccountCode) {
    throw new Error('This loan has no interest expense account mapped — set one before posting.');
  }

  const lines: LoanSplitLine[] = [];
  if (principalCents > 0) {
    lines.push({
      glAccountCode: input.loanAccountCode,
      description: `${input.description} — principal`,
      debit: toDollars(principalCents),
      credit: 0,
    });
  }
  if (interestCents > 0) {
    lines.push({
      glAccountCode: input.interestAccountCode!,
      description: `${input.description} — interest`,
      debit: toDollars(interestCents),
      credit: 0,
    });
  }
  lines.push({
    glAccountCode: input.paymentAccountCode,
    description: input.description,
    debit: 0,
    credit: toDollars(principalCents + interestCents),
  });
  return lines;
}

/** Debits minus credits, in cents — zero for every well-formed split. */
export function linesBalanceCents(lines: LoanSplitLine[]): number {
  return lines.reduce(
    (sum, l) => sum + Math.round(l.debit * 100) - Math.round(l.credit * 100),
    0
  );
}
