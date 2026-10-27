import { journalSourceForIdempotencyKey } from '@/lib/api/journal-source';

describe('journalSourceForIdempotencyKey', () => {
  it('stamps Nexvar Pay sync creates as payroll', () => {
    expect(journalSourceForIdempotencyKey('nexvarpay-payrun-cmvqot7o0000408jjsa6ifrca')).toBe('payroll');
  });
  it('stamps any nexvarpay- prefixed key as payroll', () => {
    expect(journalSourceForIdempotencyKey('nexvarpay-payrun-x-void')).toBe('payroll');
  });
  it('keeps other API creates manual', () => {
    expect(journalSourceForIdempotencyKey('import-2026-10-27-001')).toBe('manual');
    expect(journalSourceForIdempotencyKey('NexvarPay-payrun-x')).toBe('manual');
  });
  it('keeps missing keys manual', () => {
    expect(journalSourceForIdempotencyKey(null)).toBe('manual');
    expect(journalSourceForIdempotencyKey(undefined)).toBe('manual');
    expect(journalSourceForIdempotencyKey('')).toBe('manual');
  });
});
