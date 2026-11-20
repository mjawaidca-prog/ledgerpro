/**
 * CCA register — book depreciation engine (pure, integer cents).
 *
 * LedgerPro computes BOOK depreciation only. The CCA deduction itself
 * — UCC pools, ITR 1100(2) factors, recapture, terminal loss — is
 * computed in Nexvar Tax from the exported facts (design §3.1: book
 * depreciation is NOT CCA, and conflating them is the classic
 * small-corp error).
 *
 * Policies (per asset, FixedAsset.bookMethod):
 *  - mirror_tax (DEFAULT — owner decision still open, see
 *    PHASE1-CCA-REGISTER.md): book depreciation follows the CCA
 *    shape — the class rate on a declining balance, with the
 *    half-year rule / AIIP first-year factors applied to additions —
 *    so the Schedule 1 book-vs-tax difference stays small. This is a
 *    presentation choice, not the tax computation.
 *  - straight_line: capital cost / bookLifeYears per year, no tax
 *    factors, first year included in full.
 *  - declining_balance: bookRatePct on NBV per year, no tax factors.
 *  - none: no book depreciation.
 *
 * Conventions:
 *  - Depreciation starts in the fiscal year containing the
 *    available-for-use date (CCA cannot be claimed before AFU, and
 *    the mirror follows it).
 *  - No depreciation in the year of disposal; the book gain/loss for
 *    that year is proceeds − opening NBV (to GIFI 8210 on the tax
 *    side; recapture/terminal loss are pool conclusions drawn in
 *    Nexvar Tax, never here).
 *  - An asset adopted into the register mid-life carries
 *    openingAccumDepCents already recorded through
 *    openingAccumThrough; the engine starts from cost − opening
 *    accum and never re-derives (or first-year-factors) those years.
 */

import { ccaClassInfo, mirrorFirstYearFactor, type CcaClassInfo } from './classes';

export type BookMethod = 'mirror_tax' | 'straight_line' | 'declining_balance' | 'none';

export interface FiscalYearLike {
  label: string;
  /** YYYY-MM-DD, first day of the fiscal year. */
  start: string;
  /** YYYY-MM-DD, last day of the fiscal year. */
  end: string;
}

export interface BookAssetFacts {
  capitalCostCents: number;
  availableForUseDate: string; // YYYY-MM-DD
  ccaClass: string;
  aiip: boolean;
  bookMethod: BookMethod;
  bookRatePct: number | null;
  bookLifeYears: number | null;
  openingAccumDepCents: number;
  openingAccumThrough: string | null; // YYYY-MM-DD
  disposal: { date: string; proceedsCents: number } | null;
}

export interface BookYearRow {
  label: string;
  start: string;
  end: string;
  openingNbvCents: number;
  depreciationCents: number;
  closingNbvCents: number;
  /** Accumulated book depreciation at year end, including any opening accum. */
  accumulatedDepCents: number;
  disposal: { date: string; proceedsCents: number; gainLossCents: number } | null;
}

// ── Cost ─────────────────────────────────────────────────────────────

/**
 * Capital cost = gross cost − ITCs claimed − government assistance.
 * Cost-for-CCA is net of ITCs and assistance (design §3.2); a result
 * below zero is a data error, never a number.
 */
export function capitalCostCents(
  grossCostCents: number,
  itcClaimedCents: number,
  governmentAssistanceCents: number
): number {
  for (const [name, v] of [
    ['grossCost', grossCostCents],
    ['itcClaimed', itcClaimedCents],
    ['governmentAssistance', governmentAssistanceCents],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`cca: ${name} must be a non-negative integer number of cents, got ${v}`);
    }
  }
  const net = grossCostCents - itcClaimedCents - governmentAssistanceCents;
  if (net < 0) {
    throw new RangeError(
      'cca: ITCs claimed plus government assistance exceed the gross cost — the capital cost would be negative'
    );
  }
  return net;
}

// ── Per-year depreciation ────────────────────────────────────────────

function annualDepreciationCents(
  asset: BookAssetFacts,
  info: CcaClassInfo,
  isFirstYear: boolean,
  openingNbvCents: number
): number {
  const cost = asset.capitalCostCents;
  switch (asset.bookMethod) {
    case 'none':
      return 0;
    case 'straight_line': {
      const life = asset.bookLifeYears;
      if (!life || life <= 0) return 0;
      return Math.round(cost / life);
    }
    case 'declining_balance': {
      const rate = asset.bookRatePct;
      if (rate == null || rate <= 0) return 0;
      return Math.round((openingNbvCents * rate) / 100);
    }
    case 'mirror_tax': {
      if (info.method === 'DB') {
        const rate = info.ratePct ?? 0;
        if (isFirstYear) {
          const factor = mirrorFirstYearFactor(info, asset.aiip, asset.availableForUseDate);
          return Math.round(((cost * rate) / 100) * factor);
        }
        return Math.round((openingNbvCents * rate) / 100);
      }
      // Straight-line classes.
      if (info.ratePct != null) {
        // Class 29: rate of capital cost per year; the first year
        // takes half (the (ta) first-year shape), later years the
        // full rate, capped at NBV by the caller.
        const annual = Math.round((cost * info.ratePct) / 100);
        return isFirstYear ? Math.round(annual * 0.5) : annual;
      }
      // Classes 13/14: straight-line over the asset's life/lease term.
      const life = asset.bookLifeYears;
      if (!life || life <= 0) return 0;
      const annual = Math.round(cost / life);
      return isFirstYear ? Math.round(annual * 0.5) : annual;
    }
  }
}

/**
 * The asset's book depreciation schedule over the given fiscal years
 * (any order; they are sorted here). Years before the depreciable
 * start produce no rows.
 */
export function computeBookSchedule(asset: BookAssetFacts, years: FiscalYearLike[]): BookYearRow[] {
  const info = ccaClassInfo(asset.ccaClass);
  if (!info) throw new Error(`cca: unknown CCA class "${asset.ccaClass}"`);
  const sorted = [...years].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const adoptedMidLife = asset.openingAccumDepCents > 0;
  const skipThrough = adoptedMidLife
    ? asset.openingAccumThrough ?? asset.availableForUseDate
    : null;

  const startIndex = sorted.findIndex(
    (y) =>
      y.end >= asset.availableForUseDate && (skipThrough == null || y.start > skipThrough)
  );
  if (startIndex === -1) return [];

  const rows: BookYearRow[] = [];
  let nbv = asset.capitalCostCents - asset.openingAccumDepCents;
  let accum = asset.openingAccumDepCents;

  for (let i = startIndex; i < sorted.length; i++) {
    const year = sorted[i];
    const disposal = asset.disposal;
    if (disposal && disposal.date < year.start) break;
    if (disposal && disposal.date <= year.end) {
      rows.push({
        label: year.label,
        start: year.start,
        end: year.end,
        openingNbvCents: nbv,
        depreciationCents: 0,
        closingNbvCents: 0,
        accumulatedDepCents: accum,
        disposal: {
          date: disposal.date,
          proceedsCents: disposal.proceedsCents,
          gainLossCents: disposal.proceedsCents - nbv,
        },
      });
      break;
    }
    const isFirstYear = i === startIndex && skipThrough == null;
    const dep = Math.min(annualDepreciationCents(asset, info, isFirstYear, nbv), nbv);
    nbv -= dep;
    accum += dep;
    rows.push({
      label: year.label,
      start: year.start,
      end: year.end,
      openingNbvCents: nbv + dep,
      depreciationCents: dep,
      closingNbvCents: nbv,
      accumulatedDepCents: accum,
      disposal: null,
    });
  }
  return rows;
}

// ── Point-in-time reads over a schedule ──────────────────────────────

export function scheduleRowForYear(rows: BookYearRow[], label: string): BookYearRow | null {
  return rows.find((r) => r.label === label) ?? null;
}

/** Book depreciation expense for one fiscal year (0 when no row). */
export function depreciationForYearCents(asset: BookAssetFacts, years: FiscalYearLike[], label: string): number {
  return scheduleRowForYear(computeBookSchedule(asset, years), label)?.depreciationCents ?? 0;
}

/** Accumulated book depreciation at the end of the given fiscal year. */
export function accumulatedDepAtCents(asset: BookAssetFacts, years: FiscalYearLike[], label: string): number {
  const rows = computeBookSchedule(asset, years);
  const row = scheduleRowForYear(rows, label);
  if (row) return row.accumulatedDepCents;
  const target = years.find((y) => y.label === label);
  if (!target) return asset.openingAccumDepCents;
  const lastBefore = [...rows].reverse().find((r) => r.end < target.start);
  return lastBefore ? lastBefore.accumulatedDepCents : asset.openingAccumDepCents;
}

/** Net book value at the end of the given fiscal year. */
export function netBookValueAtCents(asset: BookAssetFacts, years: FiscalYearLike[], label: string): number {
  const rows = computeBookSchedule(asset, years);
  const row = scheduleRowForYear(rows, label);
  if (row) return row.closingNbvCents;
  const target = years.find((y) => y.label === label);
  if (!target) return asset.capitalCostCents - asset.openingAccumDepCents;
  const lastBefore = [...rows].reverse().find((r) => r.end < target.start);
  return lastBefore
    ? lastBefore.closingNbvCents
    : asset.capitalCostCents - asset.openingAccumDepCents;
}

// ── Per-class continuity (design §3.2: per-asset register, per-class
//    continuity, because CCA pools are per class) ────────────────────

export interface ContinuityAsset extends BookAssetFacts {
  id: string;
  acquisitionDate: string; // YYYY-MM-DD
}

export interface ClassContinuity {
  ccaClass: string;
  openingCostCents: number;
  additionsCostCents: number;
  disposalsCostCents: number;
  disposalsProceedsCents: number;
  closingCostCents: number;
  /** Book depreciation expense for the target fiscal year. */
  bookDepreciationCents: number;
  /** Accumulated book depreciation at target year end, over assets still held. */
  accumulatedBookDepCents: number;
  netBookValueCents: number;
  additionAssetIds: string[];
  disposalAssetIds: string[];
}

const CLASS_ORDER = new Map(
  ['1', '3', '6', '8', '10', '10.1', '12', '13', '14', '14.1', '17', '29', '38', '41', '43', '45', '50', '52', '53'].map(
    (c, i) => [c, i] as const
  )
);

export function classContinuity(
  assets: ContinuityAsset[],
  years: FiscalYearLike[],
  target: FiscalYearLike
): ClassContinuity[] {
  const byClass = new Map<string, ClassContinuity>();
  const blank = (ccaClass: string): ClassContinuity => ({
    ccaClass,
    openingCostCents: 0,
    additionsCostCents: 0,
    disposalsCostCents: 0,
    disposalsProceedsCents: 0,
    closingCostCents: 0,
    bookDepreciationCents: 0,
    accumulatedBookDepCents: 0,
    netBookValueCents: 0,
    additionAssetIds: [],
    disposalAssetIds: [],
  });

  for (const asset of assets) {
    const row = byClass.get(asset.ccaClass) ?? blank(asset.ccaClass);
    byClass.set(asset.ccaClass, row);
    const cost = asset.capitalCostCents;
    const afu = asset.availableForUseDate;
    const disposal = asset.disposal;

    const inOpening = afu < target.start && (!disposal || disposal.date >= target.start);
    const isAddition = afu >= target.start && afu <= target.end;
    const isDisposal = !!disposal && disposal.date >= target.start && disposal.date <= target.end;

    if (inOpening) row.openingCostCents += cost;
    if (isAddition) {
      row.additionsCostCents += cost;
      row.additionAssetIds.push(asset.id);
    }
    if (isDisposal && disposal) {
      row.disposalsCostCents += cost;
      row.disposalsProceedsCents += disposal.proceedsCents;
      row.disposalAssetIds.push(asset.id);
    }
    row.bookDepreciationCents += depreciationForYearCents(asset, years, target.label);
    if ((inOpening || isAddition) && !isDisposal) {
      row.accumulatedBookDepCents += accumulatedDepAtCents(asset, years, target.label);
    }
  }

  // Drop classes with no position in the target year at all (e.g. a
  // class whose only asset was disposed in an earlier year, or whose
  // first asset is not yet available for use) — the continuity and
  // the export report the classes actually in play for the year.
  const result = [...byClass.values()].filter(
    (row) => row.openingCostCents !== 0 || row.additionsCostCents !== 0 || row.disposalsCostCents !== 0
  );
  for (const row of result) {
    row.closingCostCents = row.openingCostCents + row.additionsCostCents - row.disposalsCostCents;
    row.netBookValueCents = row.closingCostCents - row.accumulatedBookDepCents;
  }
  result.sort((a, b) => (CLASS_ORDER.get(a.ccaClass) ?? 99) - (CLASS_ORDER.get(b.ccaClass) ?? 99));
  return result;
}
