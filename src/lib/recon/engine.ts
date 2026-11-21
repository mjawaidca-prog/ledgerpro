/**
 * Reconciliation assistant — match-proposal engine (Phase 3 item 1).
 *
 * For one unreconciled bank row, produce RANKED proposals for what the
 * row settles, each with a confidence and plain-language reasons:
 *
 *   single         one open invoice/bill, or one existing journal entry
 *   split          2–3 open documents whose outstanding amounts sum
 *                  EXACTLY to the row (one deposit, several invoices)
 *   doc_remainder  one document plus an explicit remainder (a payment
 *                  covering a bill + a fee) — confirming holds the
 *                  remainder on account via the existing match route
 *
 * Hard gate: a proposal's components must reconcile to the cent.
 * Exact-sum proposals always outrank the fuzzy doc_remainder kind.
 * Nothing here posts or clears anything — v1 is propose-only; a human
 * confirms through the existing match write path.
 *
 * Signals, cheapest and most reliable first: exact amount (the gate) →
 * reference named in the statement text → payee/contact resolution →
 * date proximity → this company's own match memory for the payee.
 *
 * Pure: plain data in, proposals out. The DB loader lives in server.ts.
 */

import { resolveContact } from '@/lib/banking/payee';
import type { OpenDocument } from '@/lib/banking/matching';
import {
  recentRunFor,
  type MatchMemory,
  type MatchTargetKind,
  type PayeeMatchMemory,
} from './memory';

export interface ReconBankRow {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed: inflow > 0, outflow < 0
  payeeGuess: string | null;
  reference: string | null; // cheque no / FITID, when present
}

/** An existing journal entry whose bank-GL line equals the row amount. */
export interface EntryCandidate {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  sourceType: string; // JournalSource: 'loan' | 'manual' | 'payroll' | …
  amount: number; // absolute amount on the bank account's GL line
}

export interface MatchTarget {
  type: MatchTargetKind;
  id: string;
  ref: string;
  contactName: string | null;
  amount: number;
}

export type ProposalKind = 'single' | 'split' | 'doc_remainder';

export interface MatchProposal {
  kind: ProposalKind;
  targets: MatchTarget[];
  /** Amount left over by a doc_remainder proposal (0 otherwise). */
  remainder: number;
  score: number;
  confidence: number; // 0–1, mirrors score
  tier: 'high' | 'likely';
  reasons: string[];
}

export interface ProposeInput {
  row: ReconBankRow;
  docs: OpenDocument[];
  entries: EntryCandidate[];
  contacts: { id: string; name: string; companyName?: string | null }[];
  payeeKey: string | null;
  payeeDisplay: string; // human name for reasons ("Ford Credit")
  memory: MatchMemory;
  /** Pairings the reviewer already rejected for this row — never re-propose. */
  rejectedSingles: Set<string>; // "invoice:<id>" etc.
  rejectedSplits: Set<string>; // split combination keys (see splitKeyFor)
  maxProposals?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const cents = (n: number): number => Math.round(n * 100);
const fmt = (n: number): string =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pairingKeyFor = (type: string, id: string): string => `${type}:${id}`;

export function splitKeyFor(targets: { type: string; id: string }[]): string {
  return targets.map((t) => pairingKeyFor(t.type, t.id)).sort().join('+');
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}

function tokenOverlap(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3));
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

const KIND_ORDER: Record<ProposalKind, number> = { single: 0, split: 1, doc_remainder: 2 };

const JOURNAL_SOURCE_LABEL: Record<string, string> = {
  loan: 'loan payments',
  payroll: 'payroll entries',
  manual: 'journal entries',
  fixed_asset: 'asset entries',
  transfer: 'transfer entries',
  revaluation: 'revaluation entries',
};

interface MemoryBoost {
  boost: number;
  reason: string | null;
}

function memoryBoostFor(opts: {
  memory: PayeeMatchMemory | undefined;
  payeeDisplay: string;
  kind: MatchTargetKind;
  contactId?: string | null;
  contactName?: string | null;
  journalSource?: string | null;
}): MemoryBoost {
  const { memory, payeeDisplay } = opts;
  if (!memory || memory.total === 0) return { boost: 0, reason: null };

  const run = recentRunFor(memory, {
    kind: opts.kind,
    contactId: opts.contactId ?? null,
    journalSource: opts.journalSource ?? null,
  });
  if (run >= 2) {
    const label =
      opts.kind === 'journal'
        ? (JOURNAL_SOURCE_LABEL[opts.journalSource ?? ''] ?? 'journal entries')
        : opts.kind === 'invoice'
          ? `invoices from ${opts.contactName ?? 'this customer'}`
          : `bills from ${opts.contactName ?? 'this vendor'}`;
    return {
      boost: 0.1,
      reason: `You matched the last ${run} '${payeeDisplay}' lines to ${label}`,
    };
  }

  const kindCount = memory.byKind[opts.kind] ?? 0;
  if (memory.total >= 3 && kindCount / memory.total >= 0.7) {
    const label =
      opts.kind === 'journal'
        ? 'journal entries'
        : opts.kind === 'invoice'
          ? 'customer invoices'
          : 'vendor bills';
    return {
      boost: 0.05,
      reason: `'${payeeDisplay}' lines usually settle ${label} here (${kindCount} of ${memory.total})`,
    };
  }
  return { boost: 0, reason: null };
}

export function proposeMatches(input: ProposeInput): MatchProposal[] {
  const { row, docs, entries, contacts } = input;
  const rowAmount = Math.abs(row.amount);
  const memory = input.payeeKey ? input.memory.get(input.payeeKey) : undefined;
  const resolvedContact = resolveContact(row.payeeGuess, contacts);
  const haystack = `${row.description} ${row.reference ?? ''}`.toUpperCase();

  const proposals: MatchProposal[] = [];
  const push = (p: Omit<MatchProposal, 'confidence' | 'tier'>) => {
    const score = Math.min(0.98, round2(p.score));
    if (score < 0.5) return;
    proposals.push({ ...p, score, confidence: score, tier: score >= 0.8 ? 'high' : 'likely' });
  };

  // ── Single open documents ──────────────────────────────────────────
  for (const doc of docs) {
    if (cents(doc.outstanding) !== cents(rowAmount)) continue;
    if (input.rejectedSingles.has(pairingKeyFor(doc.type, doc.id))) continue;

    let score = 0.62;
    const reasons = [`Same amount — ${fmt(doc.outstanding)}`];

    if (haystack.includes(doc.ref.toUpperCase())) {
      score += 0.15;
      reasons.push(`The statement names ${doc.ref}`);
    }
    const payeeHit = resolvedContact !== null && resolvedContact.id === doc.contactId;
    if (payeeHit) {
      score += 0.18;
      reasons.push(`Payee name in the description — ${resolvedContact!.name}`);
    }
    if (doc.dueDate) {
      const diff = dayDiff(doc.dueDate, row.date);
      if (diff <= 10) {
        score += 0.08;
        reasons.push(`Due within 10 days of this ${row.amount > 0 ? 'deposit' : 'payment'} — ${doc.dueDate}`);
      }
    }
    const mem = memoryBoostFor({
      memory,
      payeeDisplay: input.payeeDisplay,
      kind: doc.type,
      contactId: doc.contactId,
      contactName: doc.contactName,
    });
    score += mem.boost;
    if (mem.reason) reasons.push(mem.reason);

    push({
      kind: 'single',
      targets: [
        { type: doc.type, id: doc.id, ref: doc.ref, contactName: doc.contactName, amount: round2(doc.outstanding) },
      ],
      remainder: 0,
      score,
      reasons,
    });
  }

  // ── Single journal entries ─────────────────────────────────────────
  for (const entry of entries) {
    if (cents(entry.amount) !== cents(rowAmount)) continue;
    if (input.rejectedSingles.has(pairingKeyFor('journal', entry.id))) continue;

    let score = 0.6;
    const reasons = [`Same amount — ${fmt(entry.amount)}`];

    const diff = dayDiff(entry.date, row.date);
    if (diff <= 3) {
      score += 0.1;
      reasons.push(`Entry dated ${entry.date} — within 3 days of this line`);
    } else if (diff <= 10) {
      score += 0.05;
      reasons.push(`Entry dated ${entry.date}`);
    }
    const overlap = tokenOverlap(row.description, entry.description);
    if (overlap >= 0.5) {
      score += 0.1;
      reasons.push(`The entry description matches this line — "${entry.description}"`);
    }
    const mem = memoryBoostFor({
      memory,
      payeeDisplay: input.payeeDisplay,
      kind: 'journal',
      journalSource: entry.sourceType,
    });
    score += mem.boost;
    if (mem.reason) reasons.push(mem.reason);

    push({
      kind: 'single',
      targets: [
        { type: 'journal', id: entry.id, ref: entry.id, contactName: null, amount: round2(entry.amount) },
      ],
      remainder: 0,
      score,
      reasons,
    });
  }

  // ── Splits: 2–3 open documents summing EXACTLY to the row ─────────
  const splitPool = docs
    .filter((d) => d.outstanding > 0 && cents(d.outstanding) < cents(rowAmount))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 12);

  const considerSplit = (combo: OpenDocument[]) => {
    const sum = combo.reduce((s, d) => s + cents(d.outstanding), 0);
    if (sum !== cents(rowAmount)) return;
    const targets = combo.map((d) => ({
      type: d.type,
      id: d.id,
      ref: d.ref,
      contactName: d.contactName,
      amount: round2(d.outstanding),
    }));
    if (input.rejectedSplits.has(splitKeyFor(targets))) return;
    if (targets.some((t) => input.rejectedSingles.has(pairingKeyFor(t.type, t.id)))) return;

    let score = 0.55;
    const reasons = [
      `${combo.length} open ${combo[0].type === 'invoice' ? 'invoices' : 'bills'} add up to exactly ${fmt(rowAmount)} — ${combo.map((d) => `${d.ref} ${fmt(d.outstanding)}`).join(' + ')}`,
    ];
    const payeeHits = combo.filter(
      (d) => resolvedContact !== null && resolvedContact.id === d.contactId
    ).length;
    if (payeeHits > 0) {
      score += Math.min(0.1, payeeHits * 0.05);
      reasons.push(`${payeeHits} of them ${payeeHits === 1 ? 'is' : 'are'} for ${resolvedContact!.name}`);
    }
    const mem = memoryBoostFor({
      memory,
      payeeDisplay: input.payeeDisplay,
      kind: combo[0].type,
      contactId: combo.length > 0 && combo.every((d) => d.contactId === combo[0].contactId) ? combo[0].contactId : null,
      contactName: combo[0].contactName,
    });
    score += mem.boost;
    if (mem.reason) reasons.push(mem.reason);

    push({ kind: 'split', targets, remainder: 0, score, reasons });
  };

  for (let i = 0; i < splitPool.length; i++) {
    for (let j = i + 1; j < splitPool.length; j++) {
      considerSplit([splitPool[i], splitPool[j]]);
      for (let k = j + 1; k < splitPool.length; k++) {
        considerSplit([splitPool[i], splitPool[j], splitPool[k]]);
      }
    }
  }

  // ── Document + remainder (bill + fee, short-paid invoice) ─────────
  for (const doc of docs) {
    const remainder = round2(rowAmount - doc.outstanding);
    if (remainder <= 0 || cents(doc.outstanding) === cents(rowAmount)) continue;
    if (remainder >= doc.outstanding) continue; // remainder must be the smaller part
    if (input.rejectedSingles.has(pairingKeyFor(doc.type, doc.id))) continue;

    let score = 0.45;
    const reasons = [
      `${doc.ref} covers ${fmt(doc.outstanding)} of this ${row.amount > 0 ? 'deposit' : 'payment'}`,
      `${fmt(remainder)} remains — a fee or short-payment; confirming holds it on account`,
    ];
    const payeeHit = resolvedContact !== null && resolvedContact.id === doc.contactId;
    if (payeeHit) {
      score += 0.18;
      reasons.push(`Payee name in the description — ${resolvedContact!.name}`);
    }
    const mem = memoryBoostFor({
      memory,
      payeeDisplay: input.payeeDisplay,
      kind: doc.type,
      contactId: doc.contactId,
      contactName: doc.contactName,
    });
    score += mem.boost;
    if (mem.reason) reasons.push(mem.reason);

    push({
      kind: 'doc_remainder',
      targets: [
        { type: doc.type, id: doc.id, ref: doc.ref, contactName: doc.contactName, amount: round2(doc.outstanding) },
      ],
      remainder,
      score,
      reasons,
    });
  }

  proposals.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.targets[0].ref.localeCompare(b.targets[0].ref);
  });

  return proposals.slice(0, input.maxProposals ?? 5);
}
