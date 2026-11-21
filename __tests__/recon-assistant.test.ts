/**
 * Reconciliation assistant (Phase 3 item 1) — propose–confirm–learn.
 *
 * Covers: the exact-amount gate (a differing amount never yields a
 * single proposal), exact-beats-fuzzy ranking, exact-sum splits (and
 * the off-by-a-cent rejection), document+remainder proposals, the
 * reference-named-in-statement signal, rejected pairings never being
 * re-proposed (singles, split combinations, split components), and
 * match memory — the leading-run boost with its plain-language reason
 * ("You matched the last 3 'Ford Credit' lines to loan payments").
 */

import {
  proposeMatches,
  pairingKeyFor,
  splitKeyFor,
  type EntryCandidate,
  type ProposeInput,
  type ReconBankRow,
} from '@/lib/recon/engine';
import { buildMatchMemory, recentRunFor, type MatchHistoryFact } from '@/lib/recon/memory';
import type { OpenDocument } from '@/lib/banking/matching';

// ── Fixtures ─────────────────────────────────────────────────────────

const CONTACTS = [
  { id: 'c-acme', name: 'Acme Supplies', companyName: null },
  { id: 'c-globex', name: 'Globex', companyName: null },
  { id: 'c-ford', name: 'Ford Credit', companyName: null },
];

function row(overrides: Partial<ReconBankRow> = {}): ReconBankRow {
  return {
    id: 'tx-1',
    date: '2026-11-15',
    description: 'ACME SUPPLIES PAYMENT',
    amount: -1000,
    payeeGuess: 'Acme Supplies',
    reference: null,
    ...overrides,
  };
}

function invoice(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    type: 'invoice',
    id: 'INV-2001',
    ref: 'INV-2001',
    contactId: 'c-globex',
    contactName: 'Globex',
    total: 1000,
    outstanding: 1000,
    dueDate: '2026-11-14',
    ...overrides,
  };
}

function bill(overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    type: 'bill',
    id: 'BILL-301',
    ref: 'BILL-301',
    contactId: 'c-acme',
    contactName: 'Acme Supplies',
    total: 1000,
    outstanding: 1000,
    dueDate: '2026-11-14',
    ...overrides,
  };
}

function entry(overrides: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    id: 'je-1',
    date: '2026-11-14',
    description: 'Loan payment — Ford Credit',
    sourceType: 'loan',
    amount: 1000,
    ...overrides,
  };
}

function input(overrides: Partial<ProposeInput> = {}): ProposeInput {
  return {
    row: row(),
    docs: [],
    entries: [],
    contacts: CONTACTS,
    payeeKey: 'ACME SUPPLIES',
    payeeDisplay: 'Acme Supplies',
    memory: new Map(),
    rejectedSingles: new Set(),
    rejectedSplits: new Set(),
    ...overrides,
  };
}

// ── The exact-amount gate + exact beats fuzzy ────────────────────────

describe('exact-amount gate', () => {
  test('a document whose amount differs yields NO single proposal', () => {
    const proposals = proposeMatches(input({ docs: [bill({ outstanding: 1000.01, total: 1000.01 })] }));
    expect(proposals.filter((p) => p.kind === 'single')).toEqual([]);
  });

  test('an exact journal entry outranks a payee-matched document+remainder (fuzzy) proposal', () => {
    const proposals = proposeMatches(
      input({
        docs: [bill({ outstanding: 950, total: 950 })], // remainder candidate, payee matches
        entries: [entry({ amount: 1000, date: '2026-11-14' })], // exact, within 3 days
      })
    );
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals[0].targets[0].type).toBe('journal');
    const remainder = proposals.find((p) => p.kind === 'doc_remainder');
    expect(remainder).toBeDefined();
    expect(remainder!.remainder).toBe(50);
  });
});

// ── Splits ───────────────────────────────────────────────────────────

describe('split proposals', () => {
  const deposit = row({ amount: 1000, description: 'DEPOSIT GLOBEX', payeeGuess: 'Globex' });

  test('two invoices summing exactly to the deposit are proposed as a split', () => {
    const proposals = proposeMatches(
      input({
        row: deposit,
        docs: [
          invoice({ id: 'INV-1', ref: 'INV-1', outstanding: 600, total: 600 }),
          invoice({ id: 'INV-2', ref: 'INV-2', outstanding: 400, total: 400 }),
        ],
      })
    );
    const split = proposals.find((p) => p.kind === 'split');
    expect(split).toBeDefined();
    expect(split!.targets.map((t) => t.id).sort()).toEqual(['INV-1', 'INV-2']);
    expect(split!.targets.reduce((s, t) => s + t.amount, 0)).toBe(1000);
    expect(split!.reasons[0]).toMatch(/add up to exactly/);
  });

  test('a split off by one cent is never proposed', () => {
    const proposals = proposeMatches(
      input({
        row: deposit,
        docs: [
          invoice({ id: 'INV-1', ref: 'INV-1', outstanding: 600, total: 600 }),
          invoice({ id: 'INV-2', ref: 'INV-2', outstanding: 399.99, total: 399.99 }),
        ],
      })
    );
    expect(proposals.filter((p) => p.kind === 'split')).toEqual([]);
  });

  test('three invoices summing exactly are proposed; a single exact invoice still ranks first', () => {
    const proposals = proposeMatches(
      input({
        row: deposit,
        docs: [
          invoice({ id: 'INV-1', ref: 'INV-1', outstanding: 500, total: 500 }),
          invoice({ id: 'INV-2', ref: 'INV-2', outstanding: 300, total: 300 }),
          invoice({ id: 'INV-3', ref: 'INV-3', outstanding: 200, total: 200 }),
          invoice({ id: 'INV-9', ref: 'INV-9', outstanding: 1000, total: 1000 }),
        ],
      })
    );
    expect(proposals[0].kind).toBe('single');
    expect(proposals.some((p) => p.kind === 'split' && p.targets.length === 3)).toBe(true);
  });
});

// ── Document + remainder ─────────────────────────────────────────────

describe('document + remainder proposals', () => {
  test('a remainder larger than the document itself is not proposed', () => {
    const proposals = proposeMatches(input({ docs: [bill({ outstanding: 400, total: 400 })] }));
    expect(proposals.filter((p) => p.kind === 'doc_remainder')).toEqual([]);
  });

  test('the remainder is named plainly in the reasons', () => {
    const proposals = proposeMatches(input({ docs: [bill({ outstanding: 950, total: 950 })] }));
    const remainder = proposals.find((p) => p.kind === 'doc_remainder');
    expect(remainder).toBeDefined();
    expect(remainder!.reasons.join(' ')).toMatch(/50\.00 remains/);
  });
});

// ── Reference signal ─────────────────────────────────────────────────

describe('reference signal', () => {
  test('a statement naming the invoice ref boosts it above an equal-amount rival', () => {
    const proposals = proposeMatches(
      input({
        row: row({ amount: 1000, description: 'DEPOSIT REF INV-1044', payeeGuess: null }),
        docs: [
          invoice({ id: 'INV-1044', ref: 'INV-1044', contactId: 'c-globex' }),
          invoice({ id: 'INV-2077', ref: 'INV-2077', contactId: 'c-acme', contactName: 'Acme Supplies' }),
        ],
      })
    );
    const singles = proposals.filter((p) => p.kind === 'single');
    expect(singles[0].targets[0].id).toBe('INV-1044');
    expect(singles[0].reasons.join(' ')).toMatch(/statement names INV-1044/);
  });
});

// ── Rejections ───────────────────────────────────────────────────────

describe('rejected pairings', () => {
  test('a rejected single pairing is never re-proposed', () => {
    const rejectedSingles = new Set([pairingKeyFor('bill', 'BILL-301')]);
    const proposals = proposeMatches(input({ docs: [bill()], rejectedSingles }));
    expect(proposals.filter((p) => p.targets.some((t) => t.id === 'BILL-301'))).toEqual([]);
  });

  test('a rejected split combination is not re-proposed, but its invoices can still match singly', () => {
    const docs = [
      invoice({ id: 'INV-1', ref: 'INV-1', outstanding: 600, total: 600 }),
      invoice({ id: 'INV-2', ref: 'INV-2', outstanding: 400, total: 400 }),
    ];
    const rejectedSplits = new Set([splitKeyFor(docs.map((d) => ({ type: d.type, id: d.id })))]);
    const proposals = proposeMatches(
      input({ row: row({ amount: 1000, payeeGuess: 'Globex' }), docs, rejectedSplits })
    );
    expect(proposals.filter((p) => p.kind === 'split')).toEqual([]);
    // INV-1 can still be offered as a document+remainder pairing.
    expect(proposals.some((p) => p.kind === 'doc_remainder' && p.targets[0].id === 'INV-1')).toBe(true);
  });

  test('rejecting one component as a single also suppresses splits containing it', () => {
    const docs = [
      invoice({ id: 'INV-1', ref: 'INV-1', outstanding: 600, total: 600 }),
      invoice({ id: 'INV-2', ref: 'INV-2', outstanding: 400, total: 400 }),
    ];
    const rejectedSingles = new Set([pairingKeyFor('invoice', 'INV-1')]);
    const proposals = proposeMatches(
      input({ row: row({ amount: 1000, payeeGuess: 'Globex' }), docs, rejectedSingles })
    );
    expect(proposals.filter((p) => p.kind === 'split')).toEqual([]);
  });
});

// ── Learning ─────────────────────────────────────────────────────────

describe('match memory', () => {
  const fordFacts: MatchHistoryFact[] = [0, 1, 2].map(() => ({
    payeeKey: 'FORD CREDIT',
    kind: 'journal' as const,
    contactId: null,
    journalSource: 'loan',
  }));

  test('buildMatchMemory + recentRunFor count the leading run and stop at a different signature', () => {
    const memory = buildMatchMemory([
      ...fordFacts,
      { payeeKey: 'FORD CREDIT', kind: 'bill', contactId: 'c-ford', journalSource: null },
    ]);
    const entry = memory.get('FORD CREDIT')!;
    expect(entry.total).toBe(4);
    expect(recentRunFor(entry, { kind: 'journal', journalSource: 'loan' })).toBe(3);
    expect(recentRunFor(entry, { kind: 'journal', journalSource: 'manual' })).toBe(0);
    expect(recentRunFor(entry, { kind: 'bill', contactId: 'c-ford' })).toBe(0);
  });

  test('confirmed loan matches boost the next Ford Credit line, with the reason spelled out', () => {
    const fordRow = row({
      description: 'FORD CREDIT PAYMENT',
      payeeGuess: 'Ford Credit',
      amount: -450,
    });
    const loanEntry = entry({ id: 'je-loan', amount: 450, date: '2026-11-08', description: 'Vehicle loan payment' });
    const manualEntry = entry({
      id: 'je-manual',
      amount: 450,
      date: '2026-11-14',
      sourceType: 'manual',
      description: 'Adjustment entry',
    });

    // Control: without memory, the closer-dated manual entry wins.
    const noMemory = proposeMatches(
      input({ row: fordRow, entries: [loanEntry, manualEntry], payeeKey: 'FORD CREDIT', payeeDisplay: 'Ford Credit' })
    );
    expect(noMemory[0].targets[0].id).toBe('je-manual');

    // With three confirmed loan matches in history, the loan entry wins
    // and says why.
    const withMemory = proposeMatches(
      input({
        row: fordRow,
        entries: [loanEntry, manualEntry],
        payeeKey: 'FORD CREDIT',
        payeeDisplay: 'Ford Credit',
        memory: buildMatchMemory(fordFacts),
      })
    );
    expect(withMemory[0].targets[0].id).toBe('je-loan');
    expect(withMemory[0].reasons.join(' ')).toMatch(/last 3 'Ford Credit' lines to loan payments/);
  });

  test('a dominant-kind history adds its smaller boost and reason', () => {
    const facts: MatchHistoryFact[] = [0, 1, 2, 3].map(() => ({
      payeeKey: 'ACME SUPPLIES',
      kind: 'bill' as const,
      contactId: 'c-other',
      journalSource: null,
    }));
    const proposals = proposeMatches(input({ docs: [bill()], memory: buildMatchMemory(facts) }));
    const single = proposals.find((p) => p.kind === 'single');
    expect(single).toBeDefined();
    expect(single!.reasons.join(' ')).toMatch(/usually settle vendor bills/);
  });
});
