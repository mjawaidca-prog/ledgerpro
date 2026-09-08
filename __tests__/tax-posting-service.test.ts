const transaction = jest.fn();
const outsideFind = jest.fn();
const postJournalEntry = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    $transaction: (...args: unknown[]) => transaction(...args),
    taxPosting: { findUnique: (...args: unknown[]) => outsideFind(...args) },
  },
}));
jest.mock('@/lib/journal', () => ({
  postJournalEntry: (...args: unknown[]) => postJournalEntry(...args),
}));

import {
  assertOpenTaxPeriod,
  assertTaxMutationRole,
  postTaxDocument,
  reverseTaxPosting,
  TaxPostingError,
} from '@/lib/tax/posting-service';
import { Prisma } from '@prisma/client';

const command = {
  companyId: 'company-1',
  userId: 'user-1',
  sourceKey: 'invoice:inv-1:post:v1',
  sourceType: 'invoice' as const,
  sourceId: 'inv-1',
  description: 'Invoice INV-1',
  lines: [{
    sourceLineId: 'line-1',
    taxCodeVersionId: 'version-1',
    jurisdictionEvidence: { shipToProvince: 'ON' },
  }],
};

const tx = (overrides: Record<string, unknown> = {}) => ({
  membership: {
    findUnique: jest.fn().mockResolvedValue({ role: 'owner' }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  taxPosting: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'posting-1' }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'posting-1' }),
  },
  invoice: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'inv-1',
      issueDate: new Date('2026-09-08T00:00:00Z'),
      currency: 'CAD',
      fxRate: null,
      fxRateSource: null,
      fxRateDate: null,
      status: 'sent',
      lineItems: [{
        id: 'line-1',
        amount: '100.00',
        category: { id: 'revenue', code: '4000', companyId: 'company-1', active: true },
      }],
    }),
  },
  periodClose: { findFirst: jest.fn().mockResolvedValue(null) },
  companyTaxConfiguration: {
    findUnique: jest.fn().mockResolvedValue({
      enabled: true,
      engineVersion: 'p1',
      requireJurisdictionEvidence: true,
      configuredById: 'accountant-1',
      configuredAt: new Date('2026-09-01T00:00:00Z'),
      company: { province: 'ON', currency: 'CAD' },
      gstHstOutputAccount: { id: 'out', code: '2300', companyId: 'company-1', active: true, type: 'liability' },
      gstHstRecoverableAccount: { id: 'itc', code: '1300', companyId: 'company-1', active: true, type: 'asset' },
      qstOutputAccount: null,
      qstRecoverableAccount: null,
      pstRstPayableAccount: null,
      taxRoundingAccount: { id: 'round', code: '6999', companyId: 'company-1', active: true, type: 'expense' },
      taxClearingAccount: null,
    }),
  },
  companyTaxRegistration: {
    findMany: jest.fn().mockResolvedValue([{
      regime: 'gst_hst', active: true, method: 'regular', reviewedById: 'accountant-1', reviewedAt: new Date(),
    }]),
  },
  taxCodeVersion: {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([{
      id: 'version-1',
      reviewStatus: 'approved',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: null,
      jurisdiction: 'ON',
      priceMode: 'exclusive',
      treatment: 'taxable',
      taxCode: { companyId: 'company-1', active: true },
      components: [{
        type: 'hst', authority: 'cra', treatment: 'taxable', rate: '13.000', recoveryAllowed: false,
      }],
    }]),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ jurisdiction: 'ON' }),
  },
  documentLineTaxSnapshot: { create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }) },
  journalEntry: { update: jest.fn().mockResolvedValue({}) },
  auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  ...overrides,
});

describe('P1-C tax posting authorization, locks, and atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    outsideFind.mockResolvedValue(null);
    postJournalEntry.mockResolvedValue({ id: 'journal-1' });
    transaction.mockImplementation(async (work: (client: unknown) => unknown) => work(tx()));
  });

  test.each(['owner', 'admin', 'bookkeeper'] as const)('allows the %s mutation role', role => {
    expect(() => assertTaxMutationRole(role)).not.toThrow();
  });

  test('denies viewers and users without a company membership', async () => {
    expect(() => assertTaxMutationRole('viewer')).toThrow(TaxPostingError);
    const client = tx({ membership: { findUnique: jest.fn().mockResolvedValue(null) } });
    transaction.mockImplementation(async work => work(client));
    await expect(postTaxDocument(command)).rejects.toMatchObject({ code: 'insufficient_permissions', status: 403 });
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  test('returns an existing same-company idempotent posting without writing again', async () => {
    const firstClient = tx();
    transaction.mockImplementationOnce(async work => work(firstClient));
    const created = await postTaxDocument(command);
    expect(created).toEqual({ id: 'posting-1' });
    const createdData = firstClient.taxPosting.create.mock.calls[0][0].data;
    const replay = { id: 'existing-posting', sourceKey: command.sourceKey, requestHash: createdData.requestHash };
    const client = tx({
      taxPosting: {
        findUnique: jest.fn().mockResolvedValue(replay),
        create: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    });
    transaction.mockImplementation(async work => work(client));
    await expect(postTaxDocument(command)).resolves.toBe(replay);
    expect(postJournalEntry).toHaveBeenCalledTimes(1);

    await expect(postTaxDocument({ ...command, sourceId: 'different-invoice' })).rejects.toMatchObject({
      code: 'idempotency_key_reused',
      status: 409,
    });
    expect(postJournalEntry).toHaveBeenCalledTimes(1);
  });

  test('blocks the posting inside the transaction when its tax point is closed', async () => {
    const client = tx({
      periodClose: {
        findFirst: jest.fn().mockResolvedValue({
          periodStart: new Date('2026-09-01T00:00:00Z'),
          periodEnd: new Date('2026-09-30T23:59:59Z'),
        }),
      },
    });
    transaction.mockImplementation(async work => work(client));
    await expect(postTaxDocument(command)).rejects.toMatchObject({ code: 'closed_period', status: 409 });
    expect(postJournalEntry).not.toHaveBeenCalled();
  });

  test('propagates a snapshot failure so Prisma rolls back the journal and posting together', async () => {
    const snapshotFailure = new Error('snapshot insert failed');
    const client = tx({
      documentLineTaxSnapshot: { create: jest.fn().mockRejectedValue(snapshotFailure) },
    });
    transaction.mockImplementation(async work => work(client));
    await expect(postTaxDocument(command)).rejects.toBe(snapshotFailure);
    expect(postJournalEntry).toHaveBeenCalledWith(expect.anything(), 'company-1', client);
    expect(client.taxPosting.create).toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  test('requires purchase recovery evidence and a same-company owner/admin reviewer', async () => {
    const purchaseCommand = {
      ...command,
      sourceKey: 'bill:bill-1:post:v1',
      sourceType: 'bill' as const,
      sourceId: 'bill-1',
      lines: [{
        ...command.lines[0],
        recovery: {
          GST: { basisPoints: 10_000, reason: 'Commercial activity', evidence: { receipt: 'receipt-1' }, reviewedById: 'reviewer-1' },
        },
      }],
    };
    const baseOverrides = {
      bill: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bill-1', billDate: new Date('2026-09-08T00:00:00Z'), currency: 'CAD', fxRate: null, fxRateSource: null, fxRateDate: null, status: 'open',
          lineItems: [{ id: 'line-1', amount: '100.00', category: { id: 'expense', code: '5000', companyId: 'company-1', active: true } }],
        }),
      },
      taxCodeVersion: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{
          id: 'version-1', reviewStatus: 'approved', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null,
          jurisdiction: 'ON', priceMode: 'exclusive', treatment: 'taxable', taxCode: { companyId: 'company-1', active: true },
          components: [{ type: 'gst', authority: 'cra', treatment: 'taxable', rate: '5.000', recoveryAllowed: true }],
        }]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ jurisdiction: 'ON' }),
      },
    };
    const deniedClient = tx(baseOverrides);
    transaction.mockImplementation(async work => work(deniedClient));
    await expect(postTaxDocument(purchaseCommand)).rejects.toMatchObject({ code: 'recovery_decision_required' });
    expect(postJournalEntry).not.toHaveBeenCalled();

    const approvedClient = tx({
      ...baseOverrides,
      membership: {
        findUnique: jest.fn().mockResolvedValue({ role: 'admin' }),
        findMany: jest.fn().mockResolvedValue([{ userId: 'reviewer-1' }]),
      },
    });
    transaction.mockImplementation(async work => work(approvedClient));
    await expect(postTaxDocument(purchaseCommand)).rejects.toMatchObject({ code: 'recovery_decision_required' });
    await expect(postTaxDocument({ ...purchaseCommand, userId: 'reviewer-1' })).resolves.toEqual({ id: 'posting-1' });
    expect(approvedClient.documentLineTaxSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        components: { create: [expect.objectContaining({
          recoveryBasisPoints: 10_000,
          recoveryEvidence: { receipt: 'receipt-1' },
          recoveryReviewedById: 'reviewer-1',
        })] },
      }),
    });
  });

  test('reversal copies frozen component decisions with exact opposite amounts', async () => {
    const original = {
      id: 'posting-1',
      reversedBy: null,
      journalEntry: {
        id: 'journal-1', sourceType: 'invoice', sourceId: 'inv-1',
        lines: [
          { glAccountCode: '1100', description: 'AR', debit: new Prisma.Decimal(113), credit: new Prisma.Decimal(0), currency: 'CAD', fxRate: null, debitForeign: null, creditForeign: null },
          { glAccountCode: '4000', description: 'Revenue', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100), currency: 'CAD', fxRate: null, debitForeign: null, creditForeign: null },
          { glAccountCode: '2300', description: 'HST', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(13), currency: 'CAD', fxRate: null, debitForeign: null, creditForeign: null },
        ],
      },
      snapshots: [{
        id: 'snapshot-1', taxCodeVersionId: 'version-1', direction: 'sale', treatment: 'taxable', priceMode: 'exclusive',
        jurisdiction: 'ON', jurisdictionEvidence: { shipToProvince: 'ON' }, jurisdictionOverrideReason: null,
        documentCurrency: 'CAD', homeCurrency: 'CAD', netAmount: new Prisma.Decimal(100), taxAmount: new Prisma.Decimal(13), grossAmount: new Prisma.Decimal(113),
        netHome: new Prisma.Decimal(100), taxHome: new Prisma.Decimal(13), grossHome: new Prisma.Decimal(113), fxRate: null, fxRateSource: null, fxRateDate: null,
        engineVersion: 'p1',
        components: [{
          type: 'hst', authority: 'cra', treatment: 'taxable', rate: new Prisma.Decimal(13), taxAmount: new Prisma.Decimal(13), taxHome: new Prisma.Decimal(13),
          outputTax: new Prisma.Decimal(13), outputTaxHome: new Prisma.Decimal(13), recoverableTax: new Prisma.Decimal(0), recoverableTaxHome: new Prisma.Decimal(0),
          nonrecoverableTax: new Prisma.Decimal(0), nonrecoverableTaxHome: new Prisma.Decimal(0), recoveryBasisPoints: 0, recoveryReason: null,
          recoveryEvidence: null, recoveryReviewedById: null, recoveryReviewedAt: null,
        }],
      }],
    };
    const createSnapshot = jest.fn().mockResolvedValue({ id: 'reversal-snapshot' });
    const client = tx({
      taxPosting: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(original),
        create: jest.fn().mockResolvedValue({ id: 'posting-reversal' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'posting-reversal' }),
      },
      documentLineTaxSnapshot: { create: createSnapshot },
    });
    transaction.mockImplementation(async work => work(client));
    postJournalEntry.mockResolvedValue({ id: 'journal-reversal' });

    await reverseTaxPosting({
      companyId: 'company-1', userId: 'user-1', postingId: 'posting-1', sourceKey: 'invoice:inv-1:reverse:v1',
      reversalDate: new Date('2026-10-01T00:00:00Z'), reason: 'Customer credit',
    });

    expect(postJournalEntry).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ glAccountCode: '1100', debit: 0, credit: 113 }),
        expect.objectContaining({ glAccountCode: '2300', debit: 13, credit: 0 }),
      ]),
    }), 'company-1', client);
    expect(createSnapshot).toHaveBeenCalledWith({ data: expect.objectContaining({
      reversalOfId: 'snapshot-1',
      taxAmount: new Prisma.Decimal(-13),
      taxHome: new Prisma.Decimal(-13),
      components: { create: [expect.objectContaining({ taxAmount: new Prisma.Decimal(-13), outputTaxHome: new Prisma.Decimal(-13) })] },
    }) });
  });

  test('closed-period helper produces an explicit conflict', () => {
    expect(() => assertOpenTaxPeriod({
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
    })).toThrow(expect.objectContaining({ code: 'closed_period', status: 409 }));
  });
});
