/**
 * Match memory for the reconciliation assistant (Phase 3 item 1).
 *
 * The propose–confirm–learn loop's "learn" half, derived — like the
 * Phase 2 categorization memory — from the company's own confirmed
 * history rather than a separate store: every bank row the existing
 * match flow has settled carries `matchedDocs`, so flattening those
 * rows per normalized payee yields, for each payee, what its lines
 * usually turn out to be (this customer's invoices, loan-payment
 * journal entries, …). Pure functions, no DB.
 */

export type MatchTargetKind = 'invoice' | 'bill' | 'journal';

/** One flattened confirmed match from history, most recent first. */
export interface MatchHistoryFact {
  payeeKey: string | null;
  kind: MatchTargetKind;
  contactId: string | null; // invoice customer / bill vendor (null for journal)
  journalSource: string | null; // JournalEntry.sourceType for journal matches
}

export interface PayeeMatchMemory {
  total: number;
  byKind: Record<string, number>;
  byContact: Map<string, number>;
  /** Most recent facts for this payee, newest first (capped). */
  recent: MatchHistoryFact[];
}

export type MatchMemory = Map<string, PayeeMatchMemory>;

const RECENT_CAP = 10;

export function buildMatchMemory(facts: MatchHistoryFact[]): MatchMemory {
  const memory: MatchMemory = new Map();
  for (const fact of facts) {
    if (!fact.payeeKey) continue;
    let entry = memory.get(fact.payeeKey);
    if (!entry) {
      entry = { total: 0, byKind: {}, byContact: new Map(), recent: [] };
      memory.set(fact.payeeKey, entry);
    }
    entry.total += 1;
    entry.byKind[fact.kind] = (entry.byKind[fact.kind] ?? 0) + 1;
    if (fact.contactId) {
      entry.byContact.set(fact.contactId, (entry.byContact.get(fact.contactId) ?? 0) + 1);
    }
    if (entry.recent.length < RECENT_CAP) entry.recent.push(fact);
  }
  return memory;
}

/**
 * How many of the payee's most recent matches — counting back from the
 * newest — share this exact signature (same kind, and same contact for
 * documents / same journal source for entries). Powers reasons like
 * "You matched the last 3 'Ford Credit' lines to loan payments".
 */
export function recentRunFor(
  entry: PayeeMatchMemory | undefined,
  signature: { kind: MatchTargetKind; contactId?: string | null; journalSource?: string | null }
): number {
  if (!entry) return 0;
  let run = 0;
  for (const fact of entry.recent) {
    if (fact.kind !== signature.kind) break;
    if (signature.kind === 'journal') {
      if ((fact.journalSource ?? null) !== (signature.journalSource ?? null)) break;
    } else if ((fact.contactId ?? null) !== (signature.contactId ?? null)) {
      break;
    }
    run += 1;
  }
  return run;
}
