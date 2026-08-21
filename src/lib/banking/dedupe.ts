/**
 * Duplicate detection for statement imports — pure functions, no DB.
 *
 * dedupeKey = sha1(date + '|' + amount.toFixed(2) + '|' + normalize(description))
 * (OFX FITID beats the content key when present). Classification:
 *   exact         — same key (default skip)
 *   same_amount   — |amount| within 0.01 AND same normalized description
 *                   within ±3 days, NOT exact (default keep — a repeated fee
 *                   or a second deposit of the same size is legitimate)
 *   locked_period — date <= account.lockedThrough (always skip, never
 *                   overridable)
 * The scan runs against posted AND pending rows of ALL sources, plus rows
 * earlier in the same file.
 */

import { createHash } from 'crypto';

export function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function makeDedupeKey(input: { date: string; amount: number; description: string; fitid?: string | null }): string {
  if (input.fitid) {
    return sha1(`fitid|${input.fitid.trim().toUpperCase()}`);
  }
  const amount = round2(input.amount).toFixed(2);
  return sha1(`${input.date}|${amount}|${normalizeDescription(input.description)}`);
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ExistingRow {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  dedupeHash?: string | null;
  reference?: string | null;
}

export interface FlaggedRow {
  rowIndex: number;
  reason: 'exact' | 'same_amount' | 'locked_period';
  existing?: ExistingRow;
  skip: boolean;
}

export function daysBetweenIso(a: string, b: string): number {
  const da = new Date(a.slice(0, 10) + 'T00:00:00Z').getTime();
  const db = new Date(b.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

export function classifyDuplicates(opts: {
  rows: ExistingRow[]; // candidate rows in file order
  existing: ExistingRow[]; // DB rows: posted AND pending, ALL sources
  lockedThrough: string | null; // account.lockedThrough (YYYY-MM-DD)
}): FlaggedRow[] {
  const flagged: FlaggedRow[] = [];

  // File-internal pass first: a row duplicated earlier in the same file.
  const seenKeys = new Map<string, number>(); // dedupeKey → first row index
  const candidateRows = opts.rows.map((row, rowIndex) => {
    const dedupeKey = row.dedupeHash ?? makeDedupeKey(row);
    return { row, rowIndex, dedupeKey, date: row.date.slice(0, 10) };
  });

  for (const c of candidateRows) {
    const prior = seenKeys.get(c.dedupeKey);
    if (prior !== undefined) {
      flagged.push({
        rowIndex: c.rowIndex,
        reason: 'exact',
        existing: candidateRows[prior].row,
        skip: true,
      });
      continue;
    }
    seenKeys.set(c.dedupeKey, c.rowIndex);
  }

  // DB pass for rows not already flagged internally.
  const alreadyFlagged = new Set(flagged.map((f) => f.rowIndex));
  for (const c of candidateRows) {
    if (alreadyFlagged.has(c.rowIndex)) continue;

    // Locked period — always skipped, never overridable, checked first.
    if (opts.lockedThrough && c.date <= opts.lockedThrough.slice(0, 10)) {
      flagged.push({ rowIndex: c.rowIndex, reason: 'locked_period', skip: true });
      continue;
    }

    // Exact against the DB.
    const exactHit = opts.existing.find((e) => (e.dedupeHash ?? makeDedupeKey(e)) === c.dedupeKey);
    if (exactHit) {
      flagged.push({ rowIndex: c.rowIndex, reason: 'exact', existing: exactHit, skip: true });
      continue;
    }

    // Same amount within ±3 days and same normalized description.
    const sameAmountHit = opts.existing.find((e) => {
      if (Math.abs(Math.abs(e.amount) - Math.abs(c.row.amount)) > 0.01) return false;
      if (normalizeDescription(e.description) !== normalizeDescription(c.row.description)) return false;
      const dayDiff = Math.abs(daysBetweenIso(e.date.slice(0, 10), c.date));
      return dayDiff <= 3;
    });
    if (sameAmountHit) {
      flagged.push({ rowIndex: c.rowIndex, reason: 'same_amount', existing: sameAmountHit, skip: false });
    }
  }

  return flagged;
}
