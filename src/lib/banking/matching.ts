/**
 * Suggested document matching for bank rows — signal engine.
 *
 * Three signals, all required for High confidence:
 *   1. amount equality (exact or within 0.01)
 *   2. payee/contact resolution from the description
 *   3. due-date proximity within ±10 days
 * Two of three → Likely. One or none → no suggestion (send to Find & match).
 */

import { resolveContact } from './payee';

export interface OpenDocument {
  type: 'invoice' | 'bill';
  id: string;
  ref: string; // "INV-1044"
  contactId: string;
  contactName: string;
  total: number;
  outstanding: number;
  dueDate: string | null; // YYYY-MM-DD
}

export interface MatchSignal {
  name: 'amount' | 'payee' | 'due_date';
  matched: boolean;
  detail: string;
}

export interface SuggestedMatch {
  doc: OpenDocument;
  confidence: 'high' | 'likely' | null;
  signals: MatchSignal[];
  journalPreview: { code: string; name: string; memo: string; debit: number; credit: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function evaluateMatch(opts: {
  row: { description: string; amount: number; date: string; payeeGuess: string | null };
  docs: OpenDocument[];
  contacts: { id: string; name: string; companyName?: string | null }[];
}): SuggestedMatch[] {
  const resolvedContact = resolveContact(opts.row.payeeGuess, opts.contacts);
  const rowAmount = Math.abs(opts.row.amount);

  const candidates: SuggestedMatch[] = [];

  for (const doc of opts.docs) {
    const signals: MatchSignal[] = [];

    const amountMatches = Math.abs(doc.outstanding - rowAmount) <= 0.01;
    signals.push({
      name: 'amount',
      matched: amountMatches,
      detail: amountMatches ? `Same amount — ${doc.outstanding.toFixed(2)} ${doc.outstanding.toFixed(2)}` : `Invoice total ${doc.outstanding.toFixed(2)} differs from ${rowAmount.toFixed(2)}`,
    });

    const payeeMatches = resolvedContact !== null && resolvedContact.id === doc.contactId;
    signals.push({
      name: 'payee',
      matched: payeeMatches,
      detail: payeeMatches ? `Payee name in the description — ${resolvedContact.name}` : 'Payee does not resolve to this contact',
    });

    let dueMatches = false;
    if (doc.dueDate && opts.row.date) {
      const due = new Date(doc.dueDate + 'T00:00:00Z').getTime();
      const rowDate = new Date(opts.row.date + 'T00:00:00Z').getTime();
      const diff = Math.abs(Math.round((due - rowDate) / 86400000));
      dueMatches = diff <= 10;
      signals.push({
        name: 'due_date',
        matched: dueMatches,
        detail: dueMatches ? `Due within 10 days of the payment — ${doc.dueDate}` : `Due date ${doc.dueDate} is more than 10 days away`,
      });
    } else {
      signals.push({ name: 'due_date', matched: false, detail: 'No due date to compare' });
    }

    const hitCount = signals.filter((s) => s.matched).length;
    const confidence = hitCount >= 3 ? 'high' : hitCount === 2 ? 'likely' : null;
    if (!confidence) continue;

    candidates.push({
      doc,
      confidence,
      signals,
      journalPreview: [
        {
          code: '1010',
          name: 'Bank account',
          memo: `${rowAmount.toFixed(2)} received`,
          debit: opts.row.amount > 0 ? round2(rowAmount) : 0,
          credit: opts.row.amount > 0 ? 0 : round2(rowAmount),
        },
        {
          code: doc.type === 'invoice' ? '1100' : '2200',
          name: doc.type === 'invoice' ? 'Accounts receivable' : 'Accounts payable',
          memo: 'Relieved against this payment',
          debit: opts.row.amount > 0 ? 0 : round2(rowAmount),
          credit: opts.row.amount > 0 ? round2(rowAmount) : 0,
        },
      ],
    });
  }

  return candidates.sort((a, b) => (a.confidence === 'high' ? -1 : 1));
}
