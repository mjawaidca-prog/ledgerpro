/**
 * Phase 0 (P0-3) — one banking count definition everywhere.
 *
 * Live bug (Muja): dashboard "165 TO REVIEW" (Cash card) vs Banking queues
 * 0 vs reconcile 165 rows. The dashboard count was unreconciled rows
 * (reconciledAt null) mislabelled as review; the API summary counted only
 * 'toreview' while its own queue filter included 'transfer'.
 */
import { isToReview, isUnreconciled, countTransactions, dedupeImportsForDisplay } from '@/lib/banking/counts';

describe('Phase 0 — transaction counts', () => {
  test('Muja after posting: 0 to review, 165 posted, 165 unreconciled — three different facts, three different labels', () => {
    const rows = Array.from({ length: 165 }, () => ({ status: 'reconciled', reconciledAt: null }));
    const c = countTransactions(rows);
    expect(c.toReview).toBe(0);
    expect(c.posted).toBe(165);
    expect(c.unreconciled).toBe(165);
  });

  test('fresh import: toreview AND transfer rows both count as to-review (queue and summary agree)', () => {
    const rows = [
      { status: 'toreview', reconciledAt: null },
      { status: 'toreview', reconciledAt: null },
      { status: 'transfer', reconciledAt: null },
      { status: 'categorized', reconciledAt: null },
      { status: 'excluded', reconciledAt: null },
    ];
    const c = countTransactions(rows);
    expect(c.toReview).toBe(3);
    expect(c.transfers).toBe(1);
    expect(c.categorized).toBe(1);
    // excluded rows are not "unreconciled work" — they were deliberately set aside
    expect(c.unreconciled).toBe(4);
  });

  test('a bank-reconciled row (reconciledAt set) leaves the unreconciled count', () => {
    expect(isUnreconciled({ status: 'reconciled', reconciledAt: new Date() })).toBe(false);
    expect(isToReview({ status: 'toreview' })).toBe(true);
    expect(isToReview({ status: 'reconciled' })).toBe(false);
  });
});

describe('Phase 0 — recent imports de-duplication', () => {
  const base = { date: '2026-10-25', fileName: 'download-transactions_(4).csv', accountId: 'acct-1', accountName: 'TD Chequing', rows: 165, imported: 165, status: 'imported', reversedAt: null };

  test('identical import events collapse to one row', () => {
    const list = [{ id: 'imp-1', ...base }, { id: 'imp-2', ...base }];
    const out = dedupeImportsForDisplay(list);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('imp-1');
  });

  test('a genuine same-day re-import (0 imported, all duplicates) is NOT hidden', () => {
    const list = [
      { id: 'imp-1', ...base },
      { id: 'imp-2', ...base, imported: 0, status: 'all_duplicates' },
    ];
    expect(dedupeImportsForDisplay(list)).toHaveLength(2);
  });

  test('same file on a different day or account stays listed', () => {
    const list = [
      { id: 'imp-1', ...base },
      { id: 'imp-2', ...base, date: '2026-10-26' },
      { id: 'imp-3', ...base, accountId: 'acct-2' },
    ];
    expect(dedupeImportsForDisplay(list)).toHaveLength(3);
  });
});
