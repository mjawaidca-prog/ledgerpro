/**
 * cca-writeback/1 — the return leg of the CCA loop (design §3.4).
 *
 * After a T2 is filed in Nexvar Tax, Nexvar Tax emits one of these
 * payloads per fiscal year: the CCA claimed and the closing UCC by
 * class AS FILED, plus the Schedule 1 book/tax adjustment lines the
 * filing produced. LedgerPro receives it here. The full contract —
 * the document the Nexvar Tax emitter is built against — is
 * src/lib/cca-writeback.CONTRACT.md.
 *
 * Conventions mirror the house contracts (`tb-gifi/1`,
 * `cca-register/1`, `gst-worksheet/1`, `year-end-package/1`): money
 * is decimal strings, and `hash` is the SHA-256 of the canonical
 * payload (stable JSON, keys sorted, payload WITHOUT the hash
 * field) via canonicalPayloadHash in src/lib/tb-gifi.ts.
 *
 * This module is the PURE half: structural validation, hash
 * verification, company/fiscal-year matching, the proposed Sch 1
 * journal shape, and the register's own closing-UCC projection used
 * by the variance view. The DB half (import, versioning, approval
 * posting) is src/lib/cca/writeback-server.ts.
 *
 * Trust rules (design §3.4):
 *  - A payload whose hash does not verify is rejected outright —
 *    filed numbers are never taken from an unverifiable file.
 *  - The write-back NEVER posts anything by itself. Its Sch 1 lines
 *    become a PROPOSED journal that a preparer approves.
 *  - LedgerPro keeps no shadow UCC: the only UCC figures it holds
 *    are the ones a filed write-back brought in.
 */

import { canonicalPayloadHash, centsToMoney } from './tb-gifi';
import { CCA_CLASSES, CCA_CLASS_CODES, ccaClassInfo, mirrorFirstYearFactor } from './cca/classes';

export const CCA_WRITEBACK_CONTRACT_VERSION = 'cca-writeback/1';

// The register's chart hygiene (src/lib/cca/server.ts): the Sch 1
// journal runs through the same accumulated-depreciation account and
// depreciation/amortization expense accounts the register posts its
// book depreciation through — never a mixed expense account.
export const WRITEBACK_ACCUM_ACCOUNT_CODE = '1695'; // Accumulated Depreciation (GIFI 1741)
export const WRITEBACK_DEP_EXPENSE_CODE = '6860'; // Depreciation Expense (GIFI 8670)
export const WRITEBACK_AMORT_EXPENSE_CODE = '6870'; // Amortization Expense (GIFI 8570)

// ─── Money — decimal string <-> integer cents ───────────────────────

const MONEY_RE = /^-?\d+\.\d{2}$/;

/** Strict decimal-string → cents. Rejects anything not "1234.56" shaped. */
export function moneyStringToCents(value: unknown, field: string): number {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) {
    throw new Error(
      `cca-writeback: ${field} must be a decimal string with exactly two fraction digits (e.g. "1234.56"), got ${JSON.stringify(value)}`
    );
  }
  const negative = value.startsWith('-');
  const [dollars, frac] = (negative ? value.slice(1) : value).split('.');
  const cents = Number(dollars) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`cca-writeback: ${field} is out of range: ${value}`);
  }
  return negative ? -cents : cents;
}

// ─── Payload types ──────────────────────────────────────────────────

export interface CcaWritebackClassLine {
  ccaClass: string;
  ccaClaimedCents: number;
  closingUccCents: number;
}

export interface CcaWritebackAdjustment {
  description: string;
  amountCents: number;
  direction: 'add' | 'deduct';
}

export interface CcaWritebackSource {
  product: 'nexvar-tax';
  returnId: string;
  filedAt: string; // ISO 8601 date or datetime
  confirmationNumber: string | null;
}

export interface ParsedCcaWriteback {
  companyId: string;
  businessNumber: string;
  fiscalYearStart: string; // YYYY-MM-DD
  fiscalYearEnd: string; // YYYY-MM-DD
  classes: CcaWritebackClassLine[];
  schedule1Adjustments: CcaWritebackAdjustment[];
  source: CcaWritebackSource;
  hash: string;
  /** The payload exactly as received (hash included) — stored verbatim as the audit record. */
  raw: Record<string, unknown>;
}

export interface BuildCcaWritebackInput {
  companyId: string;
  businessNumber: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  classes: { ccaClass: string; ccaClaimedCents: number; closingUccCents: number }[];
  schedule1Adjustments: { description: string; amountCents: number; direction: 'add' | 'deduct' }[];
  source: { returnId: string; filedAt: string; confirmationNumber?: string | null };
}

/**
 * Build a cca-writeback/1 payload (hash included). This is the
 * reference builder: Nexvar Tax's emitter produces exactly this
 * shape, and the test suite builds its fixtures with it.
 */
export function buildCcaWritebackPayload(
  input: BuildCcaWritebackInput
): Record<string, unknown> & { hash: string } {
  const withoutHash: Record<string, unknown> = {
    contractVersion: CCA_WRITEBACK_CONTRACT_VERSION,
    companyId: input.companyId,
    businessNumber: input.businessNumber,
    fiscalYear: { start: input.fiscalYearStart, end: input.fiscalYearEnd },
    classes: input.classes.map((c) => ({
      class: c.ccaClass,
      ccaClaimed: centsToMoney(c.ccaClaimedCents),
      closingUcc: centsToMoney(c.closingUccCents),
    })),
    schedule1Adjustments: input.schedule1Adjustments.map((a) => ({
      description: a.description,
      amount: centsToMoney(a.amountCents),
      direction: a.direction,
    })),
    source: {
      product: 'nexvar-tax',
      returnId: input.source.returnId,
      filedAt: input.source.filedAt,
      ...(input.source.confirmationNumber
        ? { confirmationNumber: input.source.confirmationNumber }
        : {}),
    },
  };
  return { ...withoutHash, hash: canonicalPayloadHash(withoutHash) };
}

// ─── Parsing & validation ───────────────────────────────────────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireYmd(value: unknown, field: string): string {
  if (typeof value !== 'string' || !YMD_RE.test(value)) {
    throw new Error(`cca-writeback: ${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`cca-writeback: ${field} is not a real calendar date: ${value}`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`cca-writeback: ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Parse and fully validate a cca-writeback/1 payload: structure,
 * money formats, class codes (limited to the classes Nexvar Tax
 * models — the same list the register's picker uses), and the
 * canonical hash. Any failure throws with a message that names the
 * problem; nothing is returned partially.
 */
export function parseCcaWritebackPayload(raw: unknown): ParsedCcaWriteback {
  if (!isPlainObject(raw)) {
    throw new Error('cca-writeback: the payload must be a JSON object');
  }
  if (raw.contractVersion !== CCA_WRITEBACK_CONTRACT_VERSION) {
    throw new Error(
      `cca-writeback: unsupported contractVersion ${JSON.stringify(raw.contractVersion)} — this importer reads "${CCA_WRITEBACK_CONTRACT_VERSION}"`
    );
  }
  const hash = raw.hash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('cca-writeback: the payload hash is missing or is not a SHA-256 hex string');
  }
  const { hash: _hash, ...withoutHash } = raw;
  if (canonicalPayloadHash(withoutHash) !== hash) {
    throw new Error(
      'cca-writeback: hash verification failed — the payload does not match its hash. It may have been edited or corrupted in transit; nothing was imported.'
    );
  }

  const companyId = requireNonEmptyString(raw.companyId, 'companyId');
  const businessNumber = requireNonEmptyString(raw.businessNumber, 'businessNumber');

  if (!isPlainObject(raw.fiscalYear)) {
    throw new Error('cca-writeback: fiscalYear must be an object with start and end dates');
  }
  const fiscalYearStart = requireYmd(raw.fiscalYear.start, 'fiscalYear.start');
  const fiscalYearEnd = requireYmd(raw.fiscalYear.end, 'fiscalYear.end');
  if (fiscalYearStart > fiscalYearEnd) {
    throw new Error('cca-writeback: fiscalYear.start is after fiscalYear.end');
  }

  if (!Array.isArray(raw.classes)) {
    throw new Error('cca-writeback: classes must be an array');
  }
  const seenClasses = new Set<string>();
  const classes: CcaWritebackClassLine[] = raw.classes.map((entry, i) => {
    if (!isPlainObject(entry)) throw new Error(`cca-writeback: classes[${i}] must be an object`);
    const ccaClass = requireNonEmptyString(entry.class, `classes[${i}].class`);
    if (!CCA_CLASS_CODES.includes(ccaClass)) {
      throw new Error(
        `cca-writeback: classes[${i}].class "${ccaClass}" is not a CCA class Nexvar Tax models (known: ${CCA_CLASS_CODES.join(', ')})`
      );
    }
    if (seenClasses.has(ccaClass)) {
      throw new Error(`cca-writeback: class ${ccaClass} appears twice — one line per class per year`);
    }
    seenClasses.add(ccaClass);
    const ccaClaimedCents = moneyStringToCents(entry.ccaClaimed, `classes[${i}].ccaClaimed`);
    const closingUccCents = moneyStringToCents(entry.closingUcc, `classes[${i}].closingUcc`);
    if (ccaClaimedCents < 0) throw new Error(`cca-writeback: classes[${i}].ccaClaimed cannot be negative`);
    if (closingUccCents < 0) throw new Error(`cca-writeback: classes[${i}].closingUcc cannot be negative`);
    return { ccaClass, ccaClaimedCents, closingUccCents };
  });

  if (!Array.isArray(raw.schedule1Adjustments)) {
    throw new Error('cca-writeback: schedule1Adjustments must be an array');
  }
  const schedule1Adjustments: CcaWritebackAdjustment[] = raw.schedule1Adjustments.map((entry, i) => {
    if (!isPlainObject(entry)) {
      throw new Error(`cca-writeback: schedule1Adjustments[${i}] must be an object`);
    }
    const description = requireNonEmptyString(entry.description, `schedule1Adjustments[${i}].description`);
    const amountCents = moneyStringToCents(entry.amount, `schedule1Adjustments[${i}].amount`);
    if (amountCents < 0) {
      throw new Error(
        `cca-writeback: schedule1Adjustments[${i}].amount cannot be negative — the direction field carries the sign`
      );
    }
    if (entry.direction !== 'add' && entry.direction !== 'deduct') {
      throw new Error(
        `cca-writeback: schedule1Adjustments[${i}].direction must be "add" or "deduct", got ${JSON.stringify(entry.direction)}`
      );
    }
    return { description, amountCents, direction: entry.direction };
  });

  if (!isPlainObject(raw.source)) {
    throw new Error('cca-writeback: source must be an object');
  }
  if (raw.source.product !== 'nexvar-tax') {
    throw new Error(
      `cca-writeback: source.product must be "nexvar-tax", got ${JSON.stringify(raw.source.product)} — this loop only accepts filings from Nexvar Tax`
    );
  }
  const returnId = requireNonEmptyString(raw.source.returnId, 'source.returnId');
  const filedAt = requireNonEmptyString(raw.source.filedAt, 'source.filedAt');
  if (Number.isNaN(new Date(filedAt).getTime())) {
    throw new Error(`cca-writeback: source.filedAt is not a valid date: ${filedAt}`);
  }
  const confirmationNumber =
    raw.source.confirmationNumber == null
      ? null
      : requireNonEmptyString(raw.source.confirmationNumber, 'source.confirmationNumber');

  return {
    companyId,
    businessNumber,
    fiscalYearStart,
    fiscalYearEnd,
    classes,
    schedule1Adjustments,
    source: { product: 'nexvar-tax', returnId, filedAt, confirmationNumber },
    hash,
    raw,
  };
}

// ─── Company / fiscal-year matching ─────────────────────────────────

export interface WritebackCompanyContext {
  companyId: string;
  /** The company's BN in contract form (formatContractBn), or null when none is on file. */
  contractBn: string | null;
  /** The company's own fiscal-year range for the payload's year (start/end, YYYY-MM-DD). */
  fiscalYear: { start: string; end: string };
}

/**
 * The payload must belong to THIS company (id AND business number)
 * and to one of the company's own fiscal years. Anything else is
 * refused — a write-back filed against the wrong books is worse
 * than no write-back.
 */
export function validateWritebackForCompany(
  parsed: ParsedCcaWriteback,
  ctx: WritebackCompanyContext
): void {
  if (parsed.companyId !== ctx.companyId) {
    throw new Error(
      'cca-writeback: this file belongs to a different company (its companyId does not match the active company). Nothing was imported.'
    );
  }
  if (!ctx.contractBn) {
    throw new Error(
      'cca-writeback: this company has no business number on file, so the write-back cannot be matched to it. Add the BN in Company Settings first.'
    );
  }
  if (parsed.businessNumber !== ctx.contractBn) {
    throw new Error(
      `cca-writeback: the file's business number (${parsed.businessNumber}) does not match this company's (${ctx.contractBn}). Nothing was imported.`
    );
  }
  if (parsed.fiscalYearStart !== ctx.fiscalYear.start || parsed.fiscalYearEnd !== ctx.fiscalYear.end) {
    throw new Error(
      `cca-writeback: the file's fiscal year (${parsed.fiscalYearStart} → ${parsed.fiscalYearEnd}) is not one of this company's fiscal years (expected ${ctx.fiscalYear.start} → ${ctx.fiscalYear.end}). Nothing was imported.`
    );
  }
}

// ─── Duplicate / version planning ───────────────────────────────────

/**
 * A second import for the same fiscal year VERSIONS — the old
 * record is kept and the new one becomes the latest — because an
 * amended T2 filing is a real event whose predecessor must stay on
 * record. The one exception: re-importing the byte-identical file
 * (same hash) is a duplicate, refused rather than versioned, since
 * a new version that changes nothing would only confuse the trail.
 */
export function planWritebackImport(
  existingLatestHash: string | null,
  incomingHash: string
): 'create_first' | 'create_version' | 'duplicate' {
  if (existingLatestHash == null) return 'create_first';
  if (existingLatestHash === incomingHash) return 'duplicate';
  return 'create_version';
}

// ─── The proposed Sch 1 journal ─────────────────────────────────────

/**
 * The expense account the Sch 1 journal runs through: the
 * amortization account (6870, GIFI 8570) when the write-back covers
 * ONLY intangible classes (14 / 14.1), otherwise the depreciation
 * account (6860, GIFI 8670) — the register's chart hygiene either
 * way. The offset is always 1695 Accumulated Depreciation
 * (GIFI 1741).
 */
export function sch1ExpenseAccountCode(classes: Pick<CcaWritebackClassLine, 'ccaClass'>[]): string {
  const onlyIntangible =
    classes.length > 0 && classes.every((c) => ccaClassInfo(c.ccaClass)?.intangible === true);
  return onlyIntangible ? WRITEBACK_AMORT_EXPENSE_CODE : WRITEBACK_DEP_EXPENSE_CODE;
}

export interface ProposedJournalLine {
  glAccountCode: string;
  description: string;
  debit: number; // dollars
  credit: number; // dollars
}

const dollars = (cents: number): number => cents / 100;

/**
 * Build the proposed year-end journal from the payload's Sch 1
 * book/tax adjustment lines (design §3.1/§3.4: add back book
 * amortization, deduct the CCA claimed — expressed in the books
 * through the register's depreciation accounts):
 *
 *  - an "add" line (income added back on Sch 1, e.g. book
 *    amortization) reverses book expense: Dr accumulated
 *    depreciation / Cr depreciation expense;
 *  - a "deduct" line (e.g. the CCA claimed) records the tax
 *    deduction in the books: Dr depreciation expense / Cr
 *    accumulated depreciation.
 *
 * Each line produces its own balanced pair, so the journal balances
 * by construction. Zero-amount lines are skipped. An empty result
 * means no journal is proposed — the caller says so plainly.
 */
export function buildSch1JournalLines(
  adjustments: CcaWritebackAdjustment[],
  accounts: { expenseCode: string; accumCode: string }
): ProposedJournalLine[] {
  const lines: ProposedJournalLine[] = [];
  for (const adj of adjustments) {
    if (adj.amountCents === 0) continue;
    const amount = dollars(adj.amountCents);
    if (adj.direction === 'add') {
      lines.push({ glAccountCode: accounts.accumCode, description: adj.description, debit: amount, credit: 0 });
      lines.push({ glAccountCode: accounts.expenseCode, description: adj.description, debit: 0, credit: amount });
    } else {
      lines.push({ glAccountCode: accounts.expenseCode, description: adj.description, debit: amount, credit: 0 });
      lines.push({ glAccountCode: accounts.accumCode, description: adj.description, debit: 0, credit: amount });
    }
  }
  return lines;
}

// ─── The register's closing-UCC projection (variance view) ──────────

export interface ClassProjectionFacts {
  ccaClass: string;
  /** Prior year's FILED closing UCC for the class (this year's opening). */
  openingUccCents: number;
  /** Register facts for the year: additions at capital cost (net of ITCs). */
  additions: { costCents: number; aiip: boolean; availableForUseDate: string }[];
  /** Disposals in the year; the pool deduction is the lesser of proceeds and capital cost. */
  disposals: { proceedsCents: number; capitalCostCents: number }[];
  /**
   * Straight-line classes (13/14/29): the register's own computed
   * amount for the class for the year (its book-mirror figure),
   * used as the projected claim. Ignored for declining-balance
   * classes, whose projection uses the pool formula below.
   */
  slProjectedClaimCents: number | null;
}

/**
 * The register's projected CCA claim for one class for one year —
 * a PROJECTION, not the tax computation (Nexvar Tax owns that; the
 * variance view exists to explain differences, not to re-file).
 *
 * Declining-balance classes use the pool shape of Schedule 8:
 *   base  = opening UCC − disposal deductions
 *         + Σ additions × first-year factor (half-year rule / AIIP,
 *           via the same mirror factors the book engine uses)
 *   claim = rate × base, capped at the pool itself.
 * Straight-line classes project at the register's own computed
 * amount for the class.
 */
export function projectClassClaimCents(facts: ClassProjectionFacts): number {
  const info = ccaClassInfo(facts.ccaClass);
  if (!info) throw new Error(`cca-writeback: unknown CCA class "${facts.ccaClass}"`);
  const additionsCost = facts.additions.reduce((s, a) => s + a.costCents, 0);
  const disposalBase = facts.disposals.reduce(
    (s, d) => s + Math.min(d.proceedsCents, d.capitalCostCents),
    0
  );
  const pool = facts.openingUccCents + additionsCost - disposalBase;
  if (info.method === 'SL' || info.ratePct == null) {
    return Math.max(0, Math.min(facts.slProjectedClaimCents ?? 0, Math.max(0, pool)));
  }
  const rate = info.ratePct / 100;
  const additionsBase = facts.additions.reduce(
    (s, a) => s + Math.round(a.costCents * mirrorFirstYearFactor(info, a.aiip, a.availableForUseDate)),
    0
  );
  const base = facts.openingUccCents - disposalBase + additionsBase;
  const claim = Math.round(rate * Math.max(0, base));
  return Math.max(0, Math.min(claim, Math.max(0, pool)));
}

/** Expected closing UCC = opening + additions − disposal deductions − projected claim. */
export function projectClosingUccCents(facts: ClassProjectionFacts): number {
  const additionsCost = facts.additions.reduce((s, a) => s + a.costCents, 0);
  const disposalBase = facts.disposals.reduce(
    (s, d) => s + Math.min(d.proceedsCents, d.capitalCostCents),
    0
  );
  return Math.max(
    0,
    facts.openingUccCents + additionsCost - disposalBase - projectClassClaimCents(facts)
  );
}

// ─── Variance ───────────────────────────────────────────────────────

export type ClassVarianceCause =
  | 'ties_out'
  | 'claim_differed'
  | 'facts_changed_after_filing'
  | 'no_filed_opening'
  | 'unexplained';

export interface ClassVariance {
  ccaClass: string;
  filedClaimCents: number;
  filedClosingUccCents: number;
  projectedClaimCents: number | null;
  expectedClosingUccCents: number | null;
  /** Filed closing − expected closing; null when no projection exists. */
  differenceCents: number | null;
  cause: ClassVarianceCause;
  causeText: string;
}

export interface ClassVarianceInput {
  ccaClass: string;
  filedClaimCents: number;
  filedClosingUccCents: number;
  /** Null on the first filed year for the class — no baseline, no projection. */
  projectionFacts: ClassProjectionFacts | null;
  /** Register facts for this class/year were recorded or changed after the write-back arrived. */
  factsChangedAfterFiling: boolean;
}

/**
 * Compare the filed closing UCC against the register's expectation
 * and name the likely cause where the data supports one. The claim
 * explanation is checked first because it is arithmetic, not a
 * guess: if the closing difference equals the claim shortfall
 * exactly, the difference IS the unclaimed CCA.
 */
export function computeClassVariance(input: ClassVarianceInput): ClassVariance {
  const base = {
    ccaClass: input.ccaClass,
    filedClaimCents: input.filedClaimCents,
    filedClosingUccCents: input.filedClosingUccCents,
  };
  if (!input.projectionFacts) {
    return {
      ...base,
      projectedClaimCents: null,
      expectedClosingUccCents: null,
      differenceCents: null,
      cause: 'no_filed_opening',
      causeText:
        'No filed opening UCC for this class — this write-back establishes the baseline, so there is nothing to vary against yet. Variance reporting starts with next year\u2019s filing.',
    };
  }
  const projectedClaimCents = projectClassClaimCents(input.projectionFacts);
  const expectedClosingUccCents = projectClosingUccCents(input.projectionFacts);
  const differenceCents = input.filedClosingUccCents - expectedClosingUccCents;

  if (differenceCents === 0) {
    return {
      ...base,
      projectedClaimCents,
      expectedClosingUccCents,
      differenceCents,
      cause: 'ties_out',
      causeText: 'The filed closing UCC matches the register\u2019s expectation to the cent.',
    };
  }
  const claimShortfall = projectedClaimCents - input.filedClaimCents;
  if (claimShortfall !== 0 && differenceCents === claimShortfall) {
    return {
      ...base,
      projectedClaimCents,
      expectedClosingUccCents,
      differenceCents,
      cause: 'claim_differed',
      causeText:
        input.filedClaimCents < projectedClaimCents
          ? `The return claimed ${centsToMoney(input.filedClaimCents)} of CCA against the register\u2019s ${centsToMoney(projectedClaimCents)} projection. CCA is discretionary — claiming less is a filing choice, and the unclaimed ${centsToMoney(claimShortfall)} stays in the pool.`
          : `The return claimed ${centsToMoney(input.filedClaimCents)} of CCA, more than the register\u2019s ${centsToMoney(projectedClaimCents)} projection — the full difference is the extra claim.`,
    };
  }
  if (input.factsChangedAfterFiling) {
    return {
      ...base,
      projectedClaimCents,
      expectedClosingUccCents,
      differenceCents,
      cause: 'facts_changed_after_filing',
      causeText:
        'Assets or disposals in this class were recorded or changed in the register after this write-back arrived, so the register\u2019s facts for the year no longer match the facts the return was filed from.',
    };
  }
  return {
    ...base,
    projectedClaimCents,
    expectedClosingUccCents,
    differenceCents,
    cause: 'unexplained',
    causeText:
      'The difference is not explained by the claim or by register changes after filing — compare this class against the filed Schedule 8 before relying on either figure.',
  };
}

/** Total CCA claimed across a parsed payload's classes, in cents. */
export function totalCcaClaimedCents(parsed: Pick<ParsedCcaWriteback, 'classes'>): number {
  return parsed.classes.reduce((s, c) => s + c.ccaClaimedCents, 0);
}

/** Class → closing UCC (cents) from a stored payload object (already validated at import). */
export function closingUccByClassFromPayload(payload: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!isPlainObject(payload) || !Array.isArray(payload.classes)) return out;
  for (const entry of payload.classes) {
    if (!isPlainObject(entry) || typeof entry.class !== 'string') continue;
    try {
      out.set(entry.class, moneyStringToCents(entry.closingUcc, 'closingUcc'));
    } catch {
      // A stored payload was validated at import; a row that no
      // longer parses is skipped rather than crashing the export.
    }
  }
  return out;
}

/** Total CCA claimed (cents) from a stored payload object, or null when it cannot be read. */
export function totalCcaClaimedFromPayload(payload: unknown): number | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.classes)) return null;
  let total = 0;
  for (const entry of payload.classes) {
    if (!isPlainObject(entry)) return null;
    try {
      total += moneyStringToCents(entry.ccaClaimed, 'ccaClaimed');
    } catch {
      return null;
    }
  }
  return total;
}
