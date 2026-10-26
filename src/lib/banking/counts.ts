/**
 * Phase 0 (P0-3) — ONE transaction-state counting definition.
 *
 * The live bug: on Muja's books the dashboard badge said "165 TO REVIEW",
 * the bank card said "165 TO RECONCILE", and every Banking queue said 0.
 * Three different definitions were in play:
 *   - Banking "To Review" queue: status IN ('toreview','transfer')
 *   - GET /api/transactions summary.toReview: status = 'toreview' only
 *     (transfer rows silently excluded — a different number again)
 *   - Dashboard unreconciledCount: reconciledAt IS NULL AND status !=
 *     'excluded' — which includes every posted row, because Post-to-GL
 *     sets status='reconciled' (posted) without setting reconciledAt
 *     (bank-reconciled). The dashboard then labelled that count
 *     "to review" on the Cash card and "to reconcile" on the bank card.
 *
 * The definitions, now shared:
 *   - toReview:     status is 'toreview' or 'transfer' (imported, not yet
 *                   categorized/posted). Used by the Banking queue, the
 *                   transactions API summary, and anywhere a "review"
 *                   count is shown.
 *   - unreconciled: not excluded AND reconciledAt is null (posted or not,
 *                   the bank statement has not been agreed to it yet).
 *                   Labelled "to reconcile" — never "to review".
 *   - A row is never both counted inconsistently across screens: every
 *                   surface must derive its number from these predicates.
 */

export const TO_REVIEW_STATUSES = ['toreview', 'transfer'] as const;

export type TransactionStateLike = {
  status: string;
  reconciledAt?: Date | string | null;
};

export function isToReview(t: TransactionStateLike): boolean {
  return (TO_REVIEW_STATUSES as readonly string[]).includes(t.status);
}

export function isUnreconciled(t: TransactionStateLike): boolean {
  return t.status !== 'excluded' && (t.reconciledAt === null || t.reconciledAt === undefined);
}

export interface TransactionCounts {
  total: number;
  toReview: number;
  categorized: number;
  excluded: number;
  transfers: number;
  posted: number;
  unreconciled: number;
}

export function countTransactions(rows: TransactionStateLike[]): TransactionCounts {
  const counts: TransactionCounts = {
    total: rows.length,
    toReview: 0,
    categorized: 0,
    excluded: 0,
    transfers: 0,
    posted: 0,
    unreconciled: 0,
  };
  for (const r of rows) {
    if (isToReview(r)) counts.toReview += 1;
    if (r.status === 'categorized') counts.categorized += 1;
    if (r.status === 'excluded') counts.excluded += 1;
    if (r.status === 'transfer') counts.transfers += 1;
    // 'reconciled' is the status Post-to-GL assigns — it means POSTED to
    // the ledger. It does not mean bank-reconciled (see reconciledAt).
    if (r.status === 'reconciled') counts.posted += 1;
    if (isUnreconciled(r)) counts.unreconciled += 1;
  }
  return counts;
}

export interface ImportListLike {
  id: string;
  date: string;
  fileName: string;
  accountId?: string | null;
  accountName?: string | null;
  rows: number;
  imported?: number | null;
  status: string;
  reversedAt?: string | Date | null;
}

/**
 * De-duplicate the Recent Imports list for DISPLAY.
 *
 * The live list showed the same import twice (same file, same account,
 * same row counts, same day) while the import notification said the file
 * was imported once. Two StatementImport rows with identical
 * (file, account, date, rowsTotal, rowsImported) are the same import
 * event for display purposes. A genuine re-import of the same file on the
 * same day produces a DIFFERENT rowsImported (0 / all_duplicates when
 * everything is skipped), so it is kept.
 */
export function dedupeImportsForDisplay<T extends ImportListLike>(imports: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const imp of imports) {
    const key = [
      imp.fileName,
      imp.accountId ?? imp.accountName ?? '',
      imp.date,
      imp.rows,
      imp.imported ?? '',
      imp.reversedAt ? 'reversed' : 'live',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(imp);
  }
  return out;
}
