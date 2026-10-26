/**
 * Phase 1 — GST/HST return default period.
 * Regression: the page defaulted to the NEXT (empty) annual period right
 * after year-end (Muja: Oct 2, 2026–Oct 1, 2027, $0) instead of the period
 * with the activity (Oct 2, 2025–Oct 1, 2026). The default is now
 * activity-aware: when the latest tax-account activity predates the
 * current period, default to the period containing that activity.
 */
const registrationFindFirst = jest.fn();
const companyFindUnique = jest.fn();
const taxConfigFindUnique = jest.fn();
const journalFindFirst = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    companyTaxRegistration: { findFirst: (...a: unknown[]) => registrationFindFirst(...a) },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    companyTaxConfiguration: { findUnique: (...a: unknown[]) => taxConfigFindUnique(...a) },
    journalEntry: { findFirst: (...a: unknown[]) => journalFindFirst(...a) },
  },
}));

// Avoid the Prisma-client import chain (ungenerated in some environments);
// only the TaxPostingError class is needed from posting-service here.
jest.mock('@/lib/tax/posting-service', () => ({
  TaxPostingError: class TaxPostingError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { defaultGstPeriod } from '@/lib/tax/gst-return-service';

const annualRegistration = {
  id: 'reg-1',
  registrationNumber: '731893160RT0001',
  filingFrequency: 'annual',
  province: 'AB',
  validFrom: new Date('2025-10-02T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  registrationFindFirst.mockResolvedValue(annualRegistration);
  taxConfigFindUnique.mockResolvedValue(null);
  companyFindUnique.mockResolvedValue({ fiscalYearStart: new Date('2025-10-02T00:00:00Z') });
});

describe('defaultGstPeriod — activity-aware', () => {
  it('defaults to the period with activity, not the empty next period (Muja, Oct 26 2026)', async () => {
    journalFindFirst.mockResolvedValue({ entryDate: new Date('2026-10-01T00:00:00Z') });
    const p = await defaultGstPeriod('co-1', new Date('2026-10-26T12:00:00Z'));
    expect(p).toEqual({ start: '2025-10-02', end: '2026-10-01' });
  });

  it('keeps the current period when activity is inside it', async () => {
    journalFindFirst.mockResolvedValue({ entryDate: new Date('2026-10-20T00:00:00Z') });
    const p = await defaultGstPeriod('co-1', new Date('2026-10-26T12:00:00Z'));
    expect(p).toEqual({ start: '2026-10-02', end: '2027-10-01' });
  });

  it('keeps the current period when there is no tax activity at all', async () => {
    journalFindFirst.mockResolvedValue(null);
    const p = await defaultGstPeriod('co-1', new Date('2026-10-26T12:00:00Z'));
    expect(p).toEqual({ start: '2026-10-02', end: '2027-10-01' });
  });
});
