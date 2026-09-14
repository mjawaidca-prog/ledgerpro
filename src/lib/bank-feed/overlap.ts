// BF-3: statement-overlap detection for feed rows.
//
// Plaid and a statement file can describe the same payment differently, so
// the exact dedupeHash is not enough. This layer compares account-scoped
// candidates — same account, same amount, dates within a small window — and
// classifies them:
//
//   duplicate  — description similarity is high: the feed row is NOT created;
//                the provider link points at the existing row instead.
//   ambiguous  — the amount and window match but the description differs:
//                the feed row IS created (two legitimate identical purchases
//                must remain possible) and the link is flagged overlapCandidate
//                so BF-4's review UI can surface it for a human decision.
//   none       — no overlap; the row is created normally.

import { normalizeDescription } from '@/lib/banking/dedupe';

const DATE_WINDOW_DAYS = 2;
const SIMILARITY_THRESHOLD = 0.75;

/** Sørensen–Dice coefficient over character bigrams (0..1). */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  let overlap = 0;
  for (const g of setA) if (setB.has(g)) overlap += 1;
  return (2 * overlap) / (setA.size + setB.size);
}

export type OverlapVerdict = 'none' | 'duplicate' | 'ambiguous';

export interface OverlapCandidate {
  id: string;
  date: Date;
  amount: number;
  description: string;
}

const DAY_MS = 86_400_000;

/**
 * Classifies a feed row against existing rows on the same account. Amounts
 * are compared in cents to dodge float noise; the date window is ±2 days.
 */
export function classifyOverlap(
  incoming: { date: Date; amount: number; description: string },
  existing: OverlapCandidate[]
): { verdict: OverlapVerdict; matchId: string | null } {
  const amountCents = Math.round(incoming.amount * 100);
  const normIncoming = normalizeDescription(incoming.description);

  let best: { id: string; similarity: number } | null = null;
  for (const row of existing) {
    if (Math.round(row.amount * 100) !== amountCents) continue;
    const diffDays = Math.abs(row.date.getTime() - incoming.date.getTime()) / DAY_MS;
    if (diffDays > DATE_WINDOW_DAYS) continue;
    const similarity = diceCoefficient(normIncoming, normalizeDescription(row.description));
    if (!best || similarity > best.similarity) best = { id: row.id, similarity };
  }

  if (!best) return { verdict: 'none', matchId: null };
  return best.similarity >= SIMILARITY_THRESHOLD
    ? { verdict: 'duplicate', matchId: best.id }
    : { verdict: 'ambiguous', matchId: best.id };
}
