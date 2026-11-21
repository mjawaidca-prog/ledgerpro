/**
 * Reconciliation assistant — server loader (Phase 3 item 1).
 *
 * Thin DB layer over the pure engine (engine.ts) and memory
 * (memory.ts): loads the bank row, the open documents (the same sets
 * the suggested-matches route uses), existing journal entries whose
 * bank-GL line equals the row amount, the company's confirmed-match
 * history (from Transaction.matchedDocs — written by the existing
 * match flow), and the reviewer's rejected pairings for this row.
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { OpenDocument } from '@/lib/banking/matching';
import { payeeKeyFor, payeeDisplayName } from '@/lib/ai/payee-normalize';
import {
  proposeMatches,
  pairingKeyFor,
  splitKeyFor,
  type EntryCandidate,
  type MatchProposal,
} from './engine';
import { buildMatchMemory, type MatchHistoryFact } from './memory';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface LoadedProposals {
  proposals: MatchProposal[];
  payeeKey: string | null;
  alreadyPosted: boolean;
}

export async function loadMatchProposals(
  companyId: string,
  transactionId: string
): Promise<LoadedProposals | null> {
  const tx = await db.transaction.findUnique({
    where: { id: transactionId, companyId },
    include: { account: { select: { glAccountCode: true } } },
  });
  if (!tx) return null;
  if (tx.status === 'reconciled') return { proposals: [], payeeKey: null, alreadyPosted: true };

  const isInflow = Number(tx.amount) > 0;
  const rowAmount = Math.abs(Number(tx.amount));
  const rowDate = tx.date.toISOString().slice(0, 10);
  const contacts = await db.contact.findMany({
    where: { companyId },
    select: { id: true, name: true, companyName: true },
  });

  // Open documents — the same sets the review queue's suggested
  // matches use (inflow settles invoices, outflow settles bills).
  const docs: OpenDocument[] = isInflow
    ? (
        await db.invoice.findMany({
          where: { companyId, status: { in: ['sent', 'overdue'] } },
          include: { customer: { select: { id: true, name: true, companyName: true } } },
        })
      ).map((inv) => ({
        type: 'invoice' as const,
        id: inv.id,
        ref: inv.id,
        contactId: inv.customerId,
        contactName: inv.customer.companyName || inv.customer.name,
        total: Number(inv.total),
        outstanding: Number(inv.total) - Number(inv.paidAmount),
        dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
      }))
    : (
        await db.bill.findMany({
          where: { companyId, status: { in: ['open', 'overdue'] } },
          include: { vendor: { select: { id: true, name: true, companyName: true } } },
        })
      ).map((bill) => ({
        type: 'bill' as const,
        id: bill.id,
        ref: bill.id,
        contactId: bill.vendorId,
        contactName: bill.vendor.companyName || bill.vendor.name,
        total: Number(bill.total),
        outstanding: Number(bill.total) - Number(bill.paidAmount),
        dueDate: bill.dueDate ? bill.dueDate.toISOString().slice(0, 10) : null,
      }));

  // Existing journal entries whose bank-GL line equals the row amount
  // (a loan payment the loan tool already posted, a manual entry, …).
  // Window: 45 days before to 10 days after the bank line.
  const bankCode = tx.account?.glAccountCode ?? null;
  let entries: EntryCandidate[] = [];
  if (bankCode) {
    const from = new Date(tx.date.getTime() - 45 * 86400000);
    const to = new Date(tx.date.getTime() + 10 * 86400000);
    const openDocIds = new Set(docs.map((d) => d.id));
    const candidates = await db.journalEntry.findMany({
      where: {
        companyId,
        voidedAt: null,
        entryDate: { gte: from, lte: to },
        lines: { some: { glAccountCode: bankCode } },
      },
      include: { lines: { where: { glAccountCode: bankCode } } },
      take: 100,
    });
    // Entries already claimed as another row's match are spoken for.
    const claimed = new Set(
      (
        await db.transaction.findMany({
          where: { companyId, status: 'reconciled', matchRef: { in: candidates.map((c) => c.id) } },
          select: { matchRef: true },
        })
      ).map((t) => t.matchRef)
    );
    entries = candidates
      .filter((e) => !claimed.has(e.id))
      // A payment entry FOR one of the open documents duplicates the
      // document proposal — the document is the better target.
      .filter((e) => !(e.sourceId && openDocIds.has(e.sourceId)))
      .filter((e) => e.sourceType !== 'invoice' && e.sourceType !== 'bill')
      .map((e) => {
        const line = e.lines[0];
        const amount = isInflow ? Number(line?.debit ?? 0) : Number(line?.credit ?? 0);
        return {
          id: e.id,
          date: e.entryDate.toISOString().slice(0, 10),
          description: e.description,
          sourceType: e.sourceType,
          amount: round2(amount),
        };
      })
      .filter((e) => Math.abs(e.amount - rowAmount) <= 0.005);
  }

  // Confirmed-match history → memory. matchedDocs is written by the
  // existing match flow for both document and journal matches.
  const history = await db.transaction.findMany({
    where: { companyId, status: 'reconciled', matchedDocs: { not: Prisma.DbNull }, id: { not: tx.id } },
    orderBy: { date: 'desc' },
    take: 200,
    select: { description: true, payeeGuess: true, matchedDocs: true },
  });
  const journalIds = new Set<string>();
  const docContact = new Map<string, string>();
  for (const h of history) {
    for (const d of (h.matchedDocs as any[]) ?? []) {
      if (d?.type === 'journal' && d?.id) journalIds.add(d.id);
    }
  }
  const journalSources = new Map<string, string>();
  if (journalIds.size) {
    const js = await db.journalEntry.findMany({
      where: { id: { in: [...journalIds] }, companyId },
      select: { id: true, sourceType: true },
    });
    for (const j of js) journalSources.set(j.id, j.sourceType);
  }
  const historyDocIds = new Set<string>();
  for (const h of history) {
    for (const d of (h.matchedDocs as any[]) ?? []) {
      if ((d?.type === 'invoice' || d?.type === 'bill') && d?.id) historyDocIds.add(d.id);
    }
  }
  if (historyDocIds.size) {
    const invs = await db.invoice.findMany({
      where: { id: { in: [...historyDocIds] }, companyId },
      select: { id: true, customerId: true },
    });
    for (const i of invs) docContact.set(i.id, i.customerId);
    const bills = await db.bill.findMany({
      where: { id: { in: [...historyDocIds] }, companyId },
      select: { id: true, vendorId: true },
    });
    for (const b of bills) docContact.set(b.id, b.vendorId);
  }
  const facts: MatchHistoryFact[] = [];
  for (const h of history) {
    const key = payeeKeyFor(h.description, h.payeeGuess);
    for (const d of (h.matchedDocs as any[]) ?? []) {
      if (!d?.type || !d?.id) continue;
      facts.push({
        payeeKey: key,
        kind: d.type,
        contactId: d.type === 'journal' ? null : (docContact.get(d.id) ?? null),
        journalSource: d.type === 'journal' ? (journalSources.get(d.id) ?? null) : null,
      });
    }
  }
  const memory = buildMatchMemory(facts);

  // Rejected pairings for this row.
  const rejections = await db.reconRejectedPairing.findMany({
    where: { companyId, transactionId: tx.id },
    select: { targetType: true, targetId: true },
  });
  const rejectedSingles = new Set<string>();
  const rejectedSplits = new Set<string>();
  for (const r of rejections) {
    if (r.targetType === 'split') rejectedSplits.add(r.targetId);
    else rejectedSingles.add(pairingKeyFor(r.targetType, r.targetId));
  }

  const payeeKey = payeeKeyFor(tx.description, tx.payeeGuess);
  const proposals = proposeMatches({
    row: {
      id: tx.id,
      date: rowDate,
      description: tx.description,
      amount: Number(tx.amount),
      payeeGuess: tx.payeeGuess,
      reference: tx.reference,
    },
    docs,
    entries,
    contacts,
    payeeKey,
    payeeDisplay: payeeKey ? payeeDisplayName(payeeKey, tx.payeeGuess) : (tx.payeeGuess ?? 'This payee'),
    memory,
    rejectedSingles,
    rejectedSplits,
  });

  return { proposals, payeeKey, alreadyPosted: false };
}

/** Record a reviewer rejection so the pairing is never re-proposed. */
export async function recordRejection(opts: {
  companyId: string;
  transactionId: string;
  kind: 'single' | 'split' | 'doc_remainder';
  targets: { type: string; id: string; ref?: string | null }[];
  reason?: string | null;
  userId?: string | null;
}): Promise<void> {
  if (opts.kind === 'split') {
    await db.reconRejectedPairing.upsert({
      where: {
        transactionId_targetType_targetId: {
          transactionId: opts.transactionId,
          targetType: 'split',
          targetId: splitKeyFor(opts.targets),
        },
      },
      create: {
        companyId: opts.companyId,
        transactionId: opts.transactionId,
        targetType: 'split',
        targetId: splitKeyFor(opts.targets),
        targetRef: opts.targets.map((t) => t.ref ?? t.id).join(' + '),
        reason: opts.reason ?? null,
        decidedBy: opts.userId ?? null,
      },
      update: {},
    });
    return;
  }
  for (const t of opts.targets) {
    await db.reconRejectedPairing.upsert({
      where: {
        transactionId_targetType_targetId: {
          transactionId: opts.transactionId,
          targetType: t.type,
          targetId: t.id,
        },
      },
      create: {
        companyId: opts.companyId,
        transactionId: opts.transactionId,
        targetType: t.type,
        targetId: t.id,
        targetRef: t.ref ?? null,
        reason: opts.reason ?? null,
        decidedBy: opts.userId ?? null,
      },
      update: {},
    });
  }
}
