/**
 * Inter-company journal guard.
 *
 * Design (src/lib/intercompany/void.ts header): any direct edit or void of
 * a journal entry where interCompanyId is set must be rejected and routed
 * to the inter-company void, which reverses BOTH sides together. On
 * Nov 3, 2026 a one-sided void from the journal page broke the mirror and
 * produced a +$6,400 reconciliation break — these tests pin the guard:
 *
 *  (a) lib: voidJournalEntry rejects IC-linked entries with the routing
 *      error (code 'intercompany_linked_entry', naming the IC reference)
 *      and performs NO reversal/balance writes; non-IC entries proceed.
 *  (b) routes: PUT and DELETE on /api/journal/[id] return 409 with the
 *      routing message for IC-linked entries (PUT never flows through
 *      voidJournalEntry, so the handler guards it itself).
 *  (c) regression: voidInterCompany still works when one side's journal
 *      entry is already voided — it reverses ONLY the other side and
 *      marks the transaction VOIDED.
 */

import { NextRequest } from 'next/server';

class DecimalStub {
  v: number;
  constructor(value: unknown) { this.v = value instanceof DecimalStub ? value.v : Number(value as never); }
  toNumber() { return this.v; }
  valueOf() { return this.v; }
  toString() { return String(this.v); }
}

const mockQueryRaw = jest.fn();
const mockJournalFindUnique = jest.fn();
const mockJournalFindUniqueOrThrow = jest.fn();
const mockJournalCreate = jest.fn();
const mockJournalUpdate = jest.fn();
const mockIcFindUnique = jest.fn();
const mockIcFindUniqueOrThrow = jest.fn();
const mockIcUpdate = jest.fn();
const mockCoaFindMany = jest.fn();
const mockCoaFindFirst = jest.fn();
const mockCoaUpdate = jest.fn();
const mockCoaUpdateMany = jest.fn();
const mockMembershipCount = jest.fn();

jest.mock('@/lib/db', () => {
  const tx = {
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    journalEntry: {
      findUnique: (...a: unknown[]) => mockJournalFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockJournalFindUniqueOrThrow(...a),
      create: (...a: unknown[]) => mockJournalCreate(...a),
      update: (...a: unknown[]) => mockJournalUpdate(...a),
    },
    interCompanyTransaction: {
      findUnique: (...a: unknown[]) => mockIcFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockIcFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockIcUpdate(...a),
    },
    chartOfAccount: {
      findMany: (...a: unknown[]) => mockCoaFindMany(...a),
      findFirst: (...a: unknown[]) => mockCoaFindFirst(...a),
      update: (...a: unknown[]) => mockCoaUpdate(...a),
      updateMany: (...a: unknown[]) => mockCoaUpdateMany(...a),
    },
  };
  return {
    db: {
      ...tx,
      membership: { count: (...a: unknown[]) => mockMembershipCount(...a) },
      $transaction: (cb: unknown) => (cb as (t: unknown) => unknown)(tx),
    },
  };
});

jest.mock('@prisma/client', () => ({ Prisma: { Decimal: DecimalStub } }));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
const mockClosedPeriodGuard = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...a: unknown[]) => mockRequireCompany(...a),
  auditLog: (...a: unknown[]) => mockAuditLog(...a),
  closedPeriodGuard: (...a: unknown[]) => mockClosedPeriodGuard(...a),
}));

jest.mock('@/lib/tax/filed-lock', () => ({
  assertNoFiledLock: jest.fn(async () => undefined),
  isFiledPeriodLockedError: () => false,
}));

import { voidJournalEntry, InterCompanyLinkedEntryError } from '@/lib/journal';
import { voidInterCompany } from '@/lib/intercompany/void';
import { PUT, DELETE } from '@/app/api/journal/[id]/route';

// ─── Fixtures ───

const icLines = [
  { id: 'l1', glAccountCode: '1150', description: 'Due from — IC-0003', debit: 6400, credit: 0, currency: null, fxRate: null, debitForeign: null, creditForeign: null },
  { id: 'l2', glAccountCode: '1010', description: 'IC IC-0003', debit: 0, credit: 6400, currency: null, fxRate: null, debitForeign: null, creditForeign: null },
];

const icEntry = {
  id: 'je-ic-1',
  companyId: 'co-1',
  entryDate: new Date('2026-10-15'),
  description: 'Inter-company IC-0003',
  sourceType: 'manual',
  sourceId: 'IC-0003',
  voidedAt: null,
  reversalOfId: null,
  interCompanyId: 'ic-1',
  interCompanyRole: 'SOURCE',
  lines: icLines,
};

const plainEntry = {
  ...icEntry,
  id: 'je-plain',
  description: 'Manual adjusting entry',
  sourceId: null,
  interCompanyId: null,
  interCompanyRole: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryRaw.mockResolvedValue([]);
  mockJournalCreate.mockResolvedValue({ id: 'je-reversal', lines: [] });
  mockJournalUpdate.mockResolvedValue({});
  mockCoaUpdate.mockResolvedValue({});
  mockCoaUpdateMany.mockResolvedValue({ count: 1 });
});

// ─── (a) lib guard ───

describe('voidJournalEntry inter-company guard', () => {
  test('rejects an IC-linked entry with the routing error and writes nothing', async () => {
    mockJournalFindUnique.mockResolvedValue(icEntry);
    mockIcFindUnique.mockResolvedValue({ reference: 'IC-0003' });

    const err = await voidJournalEntry('je-ic-1', 'co-1', 'u-1').catch((e) => e);

    expect(err).toBeInstanceOf(InterCompanyLinkedEntryError);
    expect(err.code).toBe('intercompany_linked_entry');
    expect(err.message).toContain('inter-company transaction IC-0003');
    expect(err.message).toContain("can't be voided or edited on its own");
    expect(err.message).toContain('Intercompany → Linked Entries');
    expect(err.message).toContain('both sides are reversed together');

    // No reversal posted, no void stamp, no balance movement.
    expect(mockJournalCreate).not.toHaveBeenCalled();
    expect(mockJournalUpdate).not.toHaveBeenCalled();
    expect(mockCoaUpdate).not.toHaveBeenCalled();
    expect(mockCoaUpdateMany).not.toHaveBeenCalled();
  });

  test('falls back to the same routing wording without a reference when the lookup finds nothing', async () => {
    mockJournalFindUnique.mockResolvedValue(icEntry);
    mockIcFindUnique.mockResolvedValue(null);

    const err = await voidJournalEntry('je-ic-1', 'co-1', 'u-1').catch((e) => e);

    expect(err).toBeInstanceOf(InterCompanyLinkedEntryError);
    expect(err.message).toContain('one side of an inter-company transaction');
    expect(err.message).not.toContain('IC-0003');
    expect(mockJournalCreate).not.toHaveBeenCalled();
  });

  test('a non-IC entry proceeds exactly as before (guard does not fire)', async () => {
    mockJournalFindUnique.mockResolvedValue(plainEntry);
    mockCoaFindMany.mockResolvedValue([
      { id: 'coa-1150', code: '1150', type: 'asset', parentCode: null },
      { id: 'coa-1010', code: '1010', type: 'asset', parentCode: null },
    ]);

    const { original, reversal } = await voidJournalEntry('je-plain', 'co-1', 'u-1');

    expect(original.id).toBe('je-plain');
    expect(reversal.id).toBe('je-reversal');
    expect(mockIcFindUnique).not.toHaveBeenCalled();
    // Reversal posted, linked back, and the original stamped voided.
    expect(mockJournalCreate).toHaveBeenCalledTimes(1);
    expect(mockJournalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'je-reversal' }, data: { reversalOfId: 'je-plain' } })
    );
    expect(mockJournalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'je-plain' }, data: expect.objectContaining({ voidedBy: 'u-1' }) })
    );
  });
});

// ─── (b) route-level guards ───

describe('/api/journal/[id] inter-company guard', () => {
  beforeEach(() => {
    mockRequireCompany.mockResolvedValue({ companyId: 'co-1', userId: 'u-1', error: null });
    mockClosedPeriodGuard.mockResolvedValue(null);
    mockAuditLog.mockResolvedValue(undefined);
    mockJournalFindUnique.mockResolvedValue(icEntry);
    mockIcFindUnique.mockResolvedValue({ reference: 'IC-0003' });
  });

  test('PUT on an IC-linked entry returns 409 with the routing message', async () => {
    const req = new NextRequest('http://localhost/api/journal/je-ic-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Edited', lines: [
        { glAccountCode: '1150', debit: 6400, credit: 0 },
        { glAccountCode: '1010', debit: 0, credit: 6400 },
      ] }),
    });

    const res = await PUT(req, { params: { id: 'je-ic-1' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('intercompany_linked_entry');
    expect(body.error).toContain('inter-company transaction IC-0003');
    expect(body.error).toContain('Intercompany → Linked Entries');
    // No edit writes happened.
    expect(mockJournalUpdate).not.toHaveBeenCalled();
    expect(mockJournalCreate).not.toHaveBeenCalled();
  });

  test('DELETE on an IC-linked entry returns 409 with the routing message', async () => {
    const req = new NextRequest('http://localhost/api/journal/je-ic-1', { method: 'DELETE' });

    const res = await DELETE(req, { params: { id: 'je-ic-1' } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('intercompany_linked_entry');
    expect(body.error).toContain('inter-company transaction IC-0003');
    expect(body.error).toContain('Intercompany → Linked Entries');
    // No reversal posted, no void stamp.
    expect(mockJournalCreate).not.toHaveBeenCalled();
    expect(mockJournalUpdate).not.toHaveBeenCalled();
  });
});

// ─── (c) voidInterCompany regression ───

describe('voidInterCompany with one side already voided', () => {
  test('reverses ONLY the other side and marks the transaction VOIDED', async () => {
    const icTx = {
      id: 'ic-1',
      reference: 'IC-0003',
      status: 'POSTED',
      sourceCompanyId: 'co-1',
      targetCompanyId: 'co-2',
      sourceEntryId: 'je-src',
      mirrorEntryId: 'je-mirror',
    };
    const srcEntry = {
      id: 'je-src', companyId: 'co-1', description: 'Inter-company IC-0003',
      sourceType: 'manual', sourceId: 'IC-0003',
      voidedAt: new Date('2026-11-03T10:00:00Z'), // already voided — must be skipped
      lines: icLines,
    };
    const mirrorEntry = {
      id: 'je-mirror', companyId: 'co-2', description: 'Inter-company IC-0003',
      sourceType: 'manual', sourceId: 'IC-0003', voidedAt: null,
      lines: [
        { id: 'm1', glAccountCode: '5010', description: 'IC IC-0003', debit: 6400, credit: 0 },
        { id: 'm2', glAccountCode: '2150', description: 'Due to — IC-0003', debit: 0, credit: 6400 },
      ],
    };

    mockIcFindUniqueOrThrow.mockResolvedValue(icTx);
    mockMembershipCount.mockResolvedValue(2);
    mockJournalFindUniqueOrThrow.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'je-src' ? srcEntry : mirrorEntry)
    );
    mockJournalCreate.mockResolvedValue({ id: 'je-mirror-reversal', lines: [] });
    mockCoaFindFirst.mockResolvedValue({ id: 'coa-1', type: 'expense' });
    mockIcUpdate.mockResolvedValue({ ...icTx, status: 'VOIDED' });

    const result = await voidInterCompany('u-1', 'ic-1', 'test');

    expect(result.status).toBe('VOIDED');
    // Exactly one reversal created — for the mirror side (co-2) only.
    expect(mockJournalCreate).toHaveBeenCalledTimes(1);
    expect(mockJournalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'co-2', reversalOfId: 'je-mirror' }) })
    );
    // Only the mirror entry is stamped voided; the already-voided source is untouched.
    expect(mockJournalUpdate).toHaveBeenCalledTimes(1);
    expect(mockJournalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'je-mirror' }, data: expect.objectContaining({ voidedBy: 'u-1' }) })
    );
    expect(mockIcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ic-1' }, data: expect.objectContaining({ status: 'VOIDED' }) })
    );
  });
});
