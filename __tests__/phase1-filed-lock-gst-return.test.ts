/**
 * Phase 1 cleanup — GST/HST Return view exposes the filed-period hard
 * lock: `locked: true` plus the filing date/confirmation when a
 * filed_recorded workpaper covers the requested period (exactly or by
 * overlap), and `locked: false` otherwise.
 */
const mockDb: Record<string, any> = {
  companyTaxRegistration: { findFirst: jest.fn() },
  companyTaxConfiguration: { findUnique: jest.fn() },
  chartOfAccount: { findMany: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  taxReturnWorkpaper: { findMany: jest.fn() },
  company: { findUnique: jest.fn() },
};
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@/lib/tax/posting-service', () => ({
  TaxPostingError: class extends Error {
    constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'TaxPostingError'; }
  },
}));

import { computeGstReturn } from '@/lib/tax/gst-return-service';

const FILED = {
  id: 'wp-1', status: 'filed_recorded',
  periodStart: new Date('2025-10-02T00:00:00Z'), periodEnd: new Date('2026-10-01T00:00:00Z'),
  filedAt: new Date('2026-10-20T00:00:00Z'), filingConfirmation: 'NETFILE-123',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.companyTaxRegistration.findFirst.mockResolvedValue({
    id: 'reg-1', registrationNumber: '731893160 RT0001', filingFrequency: 'annual', province: 'AB',
    validFrom: new Date('2025-10-02T00:00:00Z'),
  });
  mockDb.companyTaxConfiguration.findUnique.mockResolvedValue(null);
  mockDb.chartOfAccount.findMany.mockResolvedValue([]);
  mockDb.journalEntry.findMany.mockResolvedValue([]);
  mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([FILED]);
});

describe('computeGstReturn — locked flag', () => {
  test('exact filed period → locked with filedAt + confirmation', async () => {
    const view = await computeGstReturn('co-1', '2025-10-02', '2026-10-01');
    expect(view.locked).toBe(true);
    expect(view.lockedFiled).toMatchObject({ periodStart: '2025-10-02', periodEnd: '2026-10-01', filingConfirmation: 'NETFILE-123' });
    expect(view.lockedFiled?.filedAt).toContain('2026-10-20');
    expect(view.filed?.filingConfirmation).toBe('NETFILE-123');
  });

  test('period overlapping a filed period → locked via the overlapping filing', async () => {
    const view = await computeGstReturn('co-1', '2026-01-01', '2026-12-31');
    expect(view.locked).toBe(true);
    expect(view.filed).toBeNull();
    expect(view.lockedFiled?.periodStart).toBe('2025-10-02');
    expect(view.overlappingFiled[0]).toMatchObject({ filingConfirmation: 'NETFILE-123' });
  });

  test('unfiled period → not locked', async () => {
    mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([{ ...FILED, status: 'reviewed' }]);
    const view = await computeGstReturn('co-1', '2025-10-02', '2026-10-01');
    expect(view.locked).toBe(false);
    expect(view.lockedFiled).toBeNull();
    expect(view.filed).toBeNull();
  });
});
