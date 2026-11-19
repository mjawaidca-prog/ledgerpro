/**
 * tb-gifi/1 trial-balance export — the file Nexvar Tax imports.
 *
 * Nexvar Tax's only books import is the `tb-gifi/1` contract
 * (Nexvar Tax: src/modules/import/contract.ts, spec 05 §4.2). This
 * module builds a payload that contract accepts:
 *
 *  - money is decimal strings with at most two decimal places, built
 *    with integer-cent math — never floats;
 *  - every account carries `balance = debit − credit`, the account
 *    balances net to zero, and `totals.debits`/`totals.credits` equal
 *    each other and the column sums (an unbalanced payload comes back
 *    as a V-GIFI-008 Block on the tax side);
 *  - `hash` is the SHA-256 of the canonical payload — stable JSON
 *    (object keys sorted recursively, arrays in order, no whitespace)
 *    of the payload WITHOUT the hash field. Nexvar Tax verifies this
 *    hash over the raw received object before importing, so the
 *    canonicalisation here must match the tax contract byte-for-byte
 *    in structure (see `stableStringify` below, mirrored from it);
 *  - an account with no GIFI code in LedgerPro (ChartOfAccount.gifiCode
 *    empty — or holding a non-numeric value, which the contract would
 *    reject outright) is exported with `gifiCode: null`. The contract
 *    accepts null: the line is imported unmapped and lands in Nexvar
 *    Tax's mapping review (V-GIFI-009) instead of being dropped or
 *    given an invented code. The builder reports how many accounts
 *    were unmapped so the UI can say so plainly.
 *
 * Server-side only (uses node:crypto for the payload hash).
 */

import { createHash } from 'node:crypto';

export const TB_GIFI_CONTRACT_VERSION = 'tb-gifi/1';

export interface TbGifiAccountInput {
  accountId: string;
  number: string;
  name: string;
  type: string;
  /** Raw GIFI code as stored on the chart of accounts; may be null/blank/malformed. */
  gifiCode: string | null;
  debitCents: number;
  creditCents: number;
}

export interface TbGifiAccount {
  accountId: string;
  number: string;
  name: string;
  type: string;
  gifiCode: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface TbGifiPayload {
  contractVersion: string;
  companyId: string;
  bn: string;
  periodStart: string;
  periodEnd: string;
  basis: 'closing';
  postedThrough: string;
  periodLocked: boolean;
  accounts: TbGifiAccount[];
  totals: { debits: string; credits: string };
  hash: string;
}

export interface BuildTbGifiResult {
  payload: TbGifiPayload;
  accountCount: number;
  /** Accounts exported with gifiCode: null (no code, or a non-numeric stored value). */
  unmappedCount: number;
}

// ── Money — integer cents <-> decimal string ─────────────────────────

export function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`tb-gifi: cents value out of range: ${cents}`);
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${dollars}.${frac}`;
}

// ── Canonical payload hash (mirrors the Nexvar Tax contract) ─────────

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** SHA-256 of the canonical form of a payload object WITHOUT its hash field. */
export function canonicalPayloadHash(payloadWithoutHash: unknown): string {
  return createHash('sha256')
    .update(stableStringify(payloadWithoutHash), 'utf8')
    .digest('hex');
}

// ── BN ────────────────────────────────────────────────────────────────

/**
 * The contract's `bn` is the corporation's full CRA business number
 * account (e.g. "763203379RC0001" — the form Nexvar Tax records when a
 * return is created). LedgerPro stores the 9-digit BN in
 * Company.businessNumber; a bare 9-digit BN gets the RC0001 corporate
 * tax program account suffix. Anything already longer is used as
 * stored. Returns null when the company has no BN on file — the export
 * must stop rather than invent one.
 */
export function formatContractBn(businessNumber: string | null | undefined): string | null {
  const bn = (businessNumber ?? '').trim();
  if (!bn) return null;
  return /^\d{9}$/.test(bn) ? `${bn}RC0001` : bn;
}

// ── GIFI code normalisation ───────────────────────────────────────────

/**
 * The contract accepts a GIFI code only as a string of digits; anything
 * else structural throws and the whole import fails. A stored code that
 * isn't purely numeric is therefore exported as unmapped (null) — the
 * same treatment as a missing code — never passed through raw.
 */
export function normalizeGifiCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  return /^\d+$/.test(v) ? v : null;
}

// ── Builder ───────────────────────────────────────────────────────────

export function buildTbGifiPayload(input: {
  companyId: string;
  bn: string;
  periodStart: string;
  periodEnd: string;
  postedThrough: string;
  periodLocked: boolean;
  accounts: TbGifiAccountInput[];
}): BuildTbGifiResult {
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  let unmappedCount = 0;

  const accounts: TbGifiAccount[] = input.accounts.map((a) => {
    const gifiCode = normalizeGifiCode(a.gifiCode);
    if (gifiCode === null) unmappedCount += 1;
    totalDebitCents += a.debitCents;
    totalCreditCents += a.creditCents;
    return {
      accountId: a.accountId,
      number: a.number,
      name: a.name,
      type: a.type,
      gifiCode,
      debit: centsToMoney(a.debitCents),
      credit: centsToMoney(a.creditCents),
      balance: centsToMoney(a.debitCents - a.creditCents),
    };
  });

  const withoutHash = {
    contractVersion: TB_GIFI_CONTRACT_VERSION,
    companyId: input.companyId,
    bn: input.bn,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    basis: 'closing' as const,
    postedThrough: input.postedThrough,
    periodLocked: input.periodLocked,
    accounts,
    totals: {
      debits: centsToMoney(totalDebitCents),
      credits: centsToMoney(totalCreditCents),
    },
  };

  return {
    payload: { ...withoutHash, hash: canonicalPayloadHash(withoutHash) },
    accountCount: accounts.length,
    unmappedCount,
  };
}
