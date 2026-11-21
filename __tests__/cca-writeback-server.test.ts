/**
 * CCA write-back — server behaviour (Phase 3, item 5; design §3.4).
 *
 * Import versioning, duplicate refusal, company/BN/year matching
 * at the import boundary, and the approval-gated journal posting
 * (including the closed-period block). The db is mocked; the pure
 * contract behaviour is covered in cca-writeback.test.ts.
 */
import { buildCcaWritebackPayload, type BuildCcaWritebackInput } from '@/lib/cca-writeback';

const mockCompanyFindUnique = jest.fn();
const mockWbFindFirst = jest.fn();
const mockWbFindMany = jest.fn();
const mockWbCreate = jest.fn();
const mockWbUpdate = jest.fn();
const mockWbUpdateMany = jest.fn();
const mockFixedAssetFindMany = jest.fn();
const mockPeriodCloseFindFirst = jest.fn();
const mockJournalFindFirst = jest.fn();
const mockCoaFindFirst = jest.fn();
const mockPostJournalEntry = jest.fn();

const txStub = {
  ccaWriteback: {
    create: (...a: unknown[]) => mockWbCreate(...a),
    update: (...a: unknown[]) => mockWbUpdate(...a),
    updateMany: (...a: unknown[]) => mockWbUpdateMany(...a),
  },
  chartOfAccount: {
    findFirst: (...a: unknown[]) => mockCoaFindFirst(...a),
    create: jest.fn(),
  },
};

jest.mock('@/lib/db', () => ({
  db: {
    company: { findUnique: (...a: unknown[]) => mockCompanyFindUnique(...a) },
    ccaWriteback: {
      findFirst: (...a: unknown[]) => mockWbFindFirst(...a),
      findMany: (...a: unknown[]) => mockWbFindMany(...a),
      create: (...a: unknown[]) => mockWbCreate(...a),
      update: (...a: unknown[]) => mockWbUpdate(...a),
      updateMany: (...a: unknown[]) => mockWbUpdateMany(...a),
    },
    fixedAsset: { findMany: (...a: unknown[]) => mockFixedAssetFindMany(...a) },
    periodClose: { findFirst: (...a: unknown[]) => mockPeriodCloseFindFirst(...a) },
    journalEntry: { findFirst: (...a: unknown[]) => mockJournalFindFirst(...a) },
    chartOfAccount: { findFirst: (...a: unknown[]) => mockCoaFindFirst(...a), create: jest.fn() },
    $transaction: (fn: any) => fn(txStub),
  },
}));

jest.mock('@/lib/journal', () => ({
  postJournalEntry: (...a: unknown[]) => mockPostJournalEntry(...a),
}));

import {
  getCcaWritebackStatus,
  importCcaWriteback,
  postCcaWritebackJournal,
} from '@/lib/cca/writeback-server';

const COMPANY = {
  fiscalYearStart: new Date('2025-10-01T00:00:00Z'),
  firstFiscalYearEnd: null,
  businessNumber: '731893160',
};

function payload(overrides: Partial<BuildCcaWritebackInput> = {}) {
  return buildCcaWritebackPayload({
    companyId: 'co-1',
    businessNumber: '731893160RC0001',
    fiscalYearStart: '2025-10-01',
    fiscalYearEnd: '2026-09-30',
    classes: [{ ccaClass: '8', ccaClaimedCents: 412_000, closingUccCents: 1_648_000 }],
    schedule1Adjustments: [
      { description: 'add back book amortization', amountCents: 985_000, direction: 'add' },
      { description: 'deduct CCA', amountCents: 412_000, direction: 'deduct' },
    ],
    source: { returnId: 'ret-1', filedAt: '2027-03-28T14:03:11.000Z' },
    ...overrides,
  });
}

const PROPOSED_LINES = [
  { glAccountCode: '1695', description: 'add back book amortization', debit: 9850, credit: 0 },
  { glAccountCode: '6860', description: 'add back book amortization', debit: 0, credit: 9850 },
  { glAccountCode: '6860', description: 'deduct CCA', debit: 4120, credit: 0 },
  { glAccountCode: '1695', description: 'deduct CCA', debit: 0, credit: 4120 },
];

function recordFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wb-1',
    companyId: 'co-1',
    contractVersion: 'cca-writeback/1',
    businessNumber: '731893160RC0001',
    fiscalYearStart: new Date('2025-10-01T00:00:00Z'),
    fiscalYearEnd: new Date('2026-09-30T00:00:00Z'),
    returnId: 'ret-1',
    filedAt: new Date('2027-03-28T14:03:11.000Z'),
    confirmationNumber: null,
    payload: payload(),
    hash: (payload() as any).hash,
    isLatest: true,
    journalStatus: 'proposed',
    proposedLines: PROPOSED_LINES,
    journalEntryId: null,
    importedBy: 'user-1',
    createdAt: new Date('2027-03-29T10:00:00.000Z'),
    updatedAt: new Date('2027-03-29T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompanyFindUnique.mockResolvedValue(COMPANY);
  mockWbCreate.mockImplementation(async ({ data }: any) => ({ id: 'wb-new', ...data }));
  mockWbUpdate.mockResolvedValue({});
  mockWbUpdateMany.mockResolvedValue({ count: 1 });
  mockFixedAssetFindMany.mockResolvedValue([]);
  mockPeriodCloseFindFirst.mockResolvedValue(null);
  mockJournalFindFirst.mockResolvedValue(null);
  mockCoaFindFirst.mockResolvedValue({ code: '1695' });
  mockPostJournalEntry.mockResolvedValue({ id: 'je-1' });
});

describe('import', () => {
  test('a first import stores the record with a proposed journal built from the Sch 1 lines', async () => {
    mockWbFindFirst.mockResolvedValue(null);
    const result = await importCcaWriteback('co-1', 'user-1', payload());
    expect(result.versioned).toBe(false);
    expect(result.journalStatus).toBe('proposed');
    expect(result.totalCcaClaimedCents).toBe(412_000);
    const created = mockWbCreate.mock.calls[0][0].data;
    expect(created.isLatest).toBe(true);
    expect(created.journalStatus).toBe('proposed');
    expect(created.proposedLines).toHaveLength(4);
    expect(created.returnId).toBe('ret-1');
  });

  test('a payload with no Sch 1 lines stores journalStatus "none" and no lines', async () => {
    mockWbFindFirst.mockResolvedValue(null);
    const result = await importCcaWriteback('co-1', 'user-1', payload({ schedule1Adjustments: [] }));
    expect(result.journalStatus).toBe('none');
    expect(mockWbCreate.mock.calls[0][0].data.proposedLines).toEqual([]);
  });

  test('re-importing the identical file is refused as a duplicate', async () => {
    const p = payload();
    mockWbFindFirst.mockResolvedValue({ id: 'wb-old', hash: (p as any).hash });
    await expect(importCcaWriteback('co-1', 'user-1', p)).rejects.toThrow(/already on file/);
    expect(mockWbCreate).not.toHaveBeenCalled();
  });

  test('a different file for the same year versions: old record un-latest-ed, its proposal superseded', async () => {
    mockWbFindFirst.mockResolvedValue({ id: 'wb-old', hash: 'a-different-hash' });
    const result = await importCcaWriteback('co-1', 'user-1', payload());
    expect(result.versioned).toBe(true);
    expect(mockWbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'wb-old' }, data: { isLatest: false } })
    );
    expect(mockWbUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wb-old', journalStatus: 'proposed' },
        data: { journalStatus: 'superseded' },
      })
    );
    expect(mockWbCreate).toHaveBeenCalled();
  });

  test('a business-number mismatch is refused before anything is stored', async () => {
    mockWbFindFirst.mockResolvedValue(null);
    await expect(
      importCcaWriteback('co-1', 'user-1', payload({ businessNumber: '999999999RC0001' }))
    ).rejects.toThrow(/business number/);
    expect(mockWbCreate).not.toHaveBeenCalled();
  });

  test('another company\u2019s file is refused', async () => {
    mockWbFindFirst.mockResolvedValue(null);
    await expect(importCcaWriteback('co-1', 'user-1', payload({ companyId: 'co-2' }))).rejects.toThrow(
      /different company/
    );
    expect(mockWbCreate).not.toHaveBeenCalled();
  });

  test('a fiscal period that is not a company fiscal year is refused', async () => {
    mockWbFindFirst.mockResolvedValue(null);
    await expect(
      importCcaWriteback(
        'co-1',
        'user-1',
        payload({ fiscalYearStart: '2025-10-01', fiscalYearEnd: '2026-08-31' })
      )
    ).rejects.toThrow(/not one of this company's fiscal years/);
    expect(mockWbCreate).not.toHaveBeenCalled();
  });
});

describe('approval posting', () => {
  test('approving posts one balanced cca_writeback journal dated the year end and marks the record posted', async () => {
    mockWbFindFirst.mockResolvedValue(recordFixture());
    const result = await postCcaWritebackJournal('co-1', 'user-1', 'wb-1');
    expect(result.journalEntryId).toBe('je-1');
    const [input, companyId] = mockPostJournalEntry.mock.calls[0];
    expect(companyId).toBe('co-1');
    expect(input.sourceType).toBe('cca_writeback');
    expect(input.sourceId).toBe('cca-writeback:wb-1');
    expect(input.entryDate.toISOString().slice(0, 10)).toBe('2026-09-30');
    const dr = input.lines.reduce((s: number, l: any) => s + l.debit, 0);
    const cr = input.lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(mockWbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { journalStatus: 'posted', journalEntryId: 'je-1' } })
    );
  });

  test('posting into a closed period is blocked and nothing posts', async () => {
    mockWbFindFirst.mockResolvedValue(recordFixture());
    mockPeriodCloseFindFirst.mockResolvedValue({
      periodStart: new Date('2025-10-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
    });
    await expect(postCcaWritebackJournal('co-1', 'user-1', 'wb-1')).rejects.toThrow(/closed period/);
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('an already-posted write-back cannot post twice', async () => {
    mockWbFindFirst.mockResolvedValue(recordFixture({ journalStatus: 'posted', journalEntryId: 'je-0' }));
    await expect(postCcaWritebackJournal('co-1', 'user-1', 'wb-1')).rejects.toThrow(/already posted/);
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('a superseded write-back\u2019s proposal can never post', async () => {
    mockWbFindFirst.mockResolvedValue(recordFixture({ isLatest: false, journalStatus: 'superseded' }));
    await expect(postCcaWritebackJournal('co-1', 'user-1', 'wb-1')).rejects.toThrow(/superseded/);
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('a write-back with no Sch 1 lines has nothing to post', async () => {
    mockWbFindFirst.mockResolvedValue(recordFixture({ journalStatus: 'none', proposedLines: [] }));
    await expect(postCcaWritebackJournal('co-1', 'user-1', 'wb-1')).rejects.toThrow(
      /no Schedule 1 adjustment lines/
    );
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });
});

describe('status assembly', () => {
  test('the latest record surfaces filed figures, a baseline variance, and the proposal', async () => {
    mockWbFindMany.mockResolvedValue([recordFixture()]);
    const status = await getCcaWritebackStatus('co-1');
    expect(status.records).toHaveLength(1);
    expect(status.latest).not.toBeNull();
    expect(status.latest!.classes).toEqual([
      expect.objectContaining({ ccaClass: '8', ccaClaimed: 4120, closingUcc: 16480 }),
    ]);
    // No prior-year record → no filed opening → the variance says so.
    expect(status.latest!.variance[0].cause).toBe('no_filed_opening');
    expect(status.latest!.journal.status).toBe('proposed');
    expect(status.latest!.journal.lines).toHaveLength(4);
    expect(status.latest!.journal.noSchedule1Lines).toBe(false);
  });

  test('no records at all → an empty status, not an error', async () => {
    mockWbFindMany.mockResolvedValue([]);
    const status = await getCcaWritebackStatus('co-1');
    expect(status.records).toEqual([]);
    expect(status.latest).toBeNull();
  });
});
