/**
 * tb-gifi/1 export builder — conformance with the Nexvar Tax import
 * contract (Nexvar Tax src/modules/import/contract.ts, spec 05 §4.2):
 * money as 2dp decimal strings, balance = debit − credit per account,
 * balances netting to zero, totals equal to the column sums, the
 * canonical SHA-256 payload hash, and unmapped accounts exported as
 * gifiCode: null (never dropped, never given an invented code).
 */

import { createHash } from 'node:crypto';
import {
  buildTbGifiPayload,
  centsToMoney,
  formatContractBn,
  normalizeGifiCode,
  type TbGifiAccountInput,
} from '@/lib/tb-gifi';

// Independent re-implementation of the contract's canonical form
// (stable JSON: keys sorted recursively, arrays in order, no
// whitespace) so the hash assertion does not just mirror the builder.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function moneyToCents(v: string): number {
  const neg = v.startsWith('-');
  const [d, f = ''] = (neg ? v.slice(1) : v).split('.');
  const cents = Number(d) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}

const ACCOUNTS: TbGifiAccountInput[] = [
  { accountId: 'acct-1', number: '1000', name: 'Cash', type: 'asset', gifiCode: '1001', debitCents: 500000, creditCents: 0 },
  { accountId: 'acct-2', number: '2000', name: 'Accounts payable', type: 'liability', gifiCode: '2620', debitCents: 0, creditCents: 125050 },
  { accountId: 'acct-3', number: '3000', name: 'Common shares', type: 'equity', gifiCode: '3500', debitCents: 0, creditCents: 100000 },
  { accountId: 'acct-4', number: '4000', name: 'Service revenue', type: 'income', gifiCode: '8000', debitCents: 0, creditCents: 400000 },
  { accountId: 'acct-5', number: '5000', name: 'Rent expense', type: 'expense', gifiCode: '8910', debitCents: 125050, creditCents: 0 },
  // Contra asset with a net credit balance (balance must go negative).
  { accountId: 'acct-6', number: '1010', name: 'Accumulated depreciation', type: 'asset', gifiCode: '1700', debitCents: 0, creditCents: 25000 },
  // Unmapped: no GIFI code on the account.
  { accountId: 'acct-7', number: '1090', name: 'Suspense — unidentified deposits', type: 'asset', gifiCode: null, debitCents: 25000, creditCents: 0 },
  // Unmapped: stored code is not numeric — the contract would throw on it.
  { accountId: 'acct-8', number: '1095', name: 'Suspense — unidentified payments', type: 'asset', gifiCode: 'n/a', debitCents: 0, creditCents: 0 },
];

function build() {
  return buildTbGifiPayload({
    companyId: 'company-123',
    bn: '123456789RC0001',
    periodStart: '2025-10-01',
    periodEnd: '2026-09-30',
    postedThrough: '2026-09-30T23:59:59.999Z',
    periodLocked: false,
    accounts: ACCOUNTS,
  });
}

describe('centsToMoney', () => {
  it('formats integer cents as 2dp decimal strings', () => {
    expect(centsToMoney(0)).toBe('0.00');
    expect(centsToMoney(5)).toBe('0.05');
    expect(centsToMoney(39343777)).toBe('393437.77');
    expect(centsToMoney(-125050)).toBe('-1250.50');
  });
});

describe('formatContractBn', () => {
  it('appends the RC0001 program account to a bare 9-digit BN', () => {
    expect(formatContractBn('123456789')).toBe('123456789RC0001');
    expect(formatContractBn(' 123456789 ')).toBe('123456789RC0001');
  });
  it('uses a stored full account number as-is', () => {
    expect(formatContractBn('123456789RC0001')).toBe('123456789RC0001');
  });
  it('returns null when there is no BN on file', () => {
    expect(formatContractBn(null)).toBeNull();
    expect(formatContractBn('')).toBeNull();
    expect(formatContractBn(undefined)).toBeNull();
  });
});

describe('normalizeGifiCode', () => {
  it('keeps digit strings, rejects everything else to null', () => {
    expect(normalizeGifiCode('1001')).toBe('1001');
    expect(normalizeGifiCode(' 2620 ')).toBe('2620');
    expect(normalizeGifiCode('')).toBeNull();
    expect(normalizeGifiCode(null)).toBeNull();
    expect(normalizeGifiCode('n/a')).toBeNull();
    expect(normalizeGifiCode('10-01')).toBeNull();
  });
});

describe('buildTbGifiPayload', () => {
  it('produces the contract shape with balanced totals', () => {
    const { payload } = build();
    expect(payload.contractVersion).toBe('tb-gifi/1');
    expect(payload.basis).toBe('closing');
    expect(payload.accounts).toHaveLength(ACCOUNTS.length);

    let sumDebits = 0;
    let sumCredits = 0;
    let sumBalances = 0;
    for (const a of payload.accounts) {
      const d = moneyToCents(a.debit);
      const c = moneyToCents(a.credit);
      const b = moneyToCents(a.balance);
      expect(b).toBe(d - c); // contract: balance = debit − credit
      expect(a.debit).toMatch(/^-?\d+\.\d{2}$/);
      expect(a.credit).toMatch(/^-?\d+\.\d{2}$/);
      expect(a.balance).toMatch(/^-?\d+\.\d{2}$/);
      sumDebits += d; sumCredits += c; sumBalances += b;
    }
    expect(sumBalances).toBe(0); // contract: balances net to zero
    expect(moneyToCents(payload.totals.debits)).toBe(sumDebits);
    expect(moneyToCents(payload.totals.credits)).toBe(sumCredits);
    expect(payload.totals.debits).toBe(payload.totals.credits);
  });

  it('signs the payload with the canonical SHA-256 hash (hash field excluded)', () => {
    const { payload } = build();
    const { hash, ...rest } = payload;
    const expected = createHash('sha256').update(stableStringify(rest), 'utf8').digest('hex');
    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exports unmapped accounts as gifiCode: null and counts them', () => {
    const { payload, unmappedCount, accountCount } = build();
    expect(accountCount).toBe(ACCOUNTS.length);
    expect(unmappedCount).toBe(2);
    const byId = new Map(payload.accounts.map((a) => [a.accountId, a]));
    expect(byId.get('acct-7')?.gifiCode).toBeNull();
    expect(byId.get('acct-8')?.gifiCode).toBeNull(); // malformed stored code → unmapped, not passed through
    expect(byId.get('acct-1')?.gifiCode).toBe('1001');
    // Unmapped accounts keep their amounts — nothing is dropped.
    expect(byId.get('acct-7')?.debit).toBe('250.00');
  });

  it('keeps account ids unique and carries the period metadata', () => {
    const { payload } = build();
    expect(new Set(payload.accounts.map((a) => a.accountId)).size).toBe(payload.accounts.length);
    expect(payload.periodStart).toBe('2025-10-01');
    expect(payload.periodEnd).toBe('2026-09-30');
    expect(payload.companyId).toBe('company-123');
    expect(payload.bn).toBe('123456789RC0001');
  });
});
