/**
 * CCA register — API presentation: serialize Prisma rows to plain
 * JSON and attach the computed views (book schedule, NBV, per-class
 * continuity, book gain/loss on disposal) that the register screens
 * render. Dates cross the API as YYYY-MM-DD strings; money as dollar
 * numbers.
 */

import type { FixedAsset, FixedAssetDisposal } from '@prisma/client';
import { fiscalYearRangeContaining, type FiscalYearRange } from '@/lib/fiscal-year';
import { dateToYmd } from '@/lib/loans/server';
import { toDollars } from '@/lib/loans/engine';
import { fiscalContextOf, type FiscalContext } from '@/lib/loans/present';
import { ccaClassInfo } from './classes';
import {
  accumulatedDepAtCents,
  classContinuity,
  computeBookSchedule,
  netBookValueAtCents,
  type ClassContinuity,
} from './engine';
import { assetToFacts, fiscalYearsThrough, type FixedAssetWithDisposal } from './server';

export function disposalJson(d: FixedAssetDisposal) {
  return {
    id: d.id,
    date: dateToYmd(d.disposalDate),
    proceeds: Number(d.proceeds),
    reason: d.reason,
    notes: d.notes,
  };
}

export function assetJson(asset: FixedAsset & { disposal?: FixedAssetDisposal | null }) {
  return {
    id: asset.id,
    description: asset.description,
    serialNumber: asset.serialNumber,
    vendor: asset.vendor,
    invoiceRef: asset.invoiceRef,
    location: asset.location,
    ccaClass: asset.ccaClass,
    classLabel: ccaClassInfo(asset.ccaClass)?.label ?? `Class ${asset.ccaClass}`,
    grossCost: Number(asset.grossCost),
    itcClaimed: Number(asset.itcClaimed),
    governmentAssistance: Number(asset.governmentAssistance),
    capitalCost: Number(asset.capitalCost),
    acquisitionDate: dateToYmd(asset.acquisitionDate),
    availableForUseDate: dateToYmd(asset.availableForUseDate),
    aiip: asset.aiip,
    wouldBeClass53: asset.wouldBeClass53,
    luxuryVehicle: asset.luxuryVehicle,
    assetAccountCode: asset.assetAccountCode,
    accumDepAccountCode: asset.accumDepAccountCode,
    depExpenseAccountCode: asset.depExpenseAccountCode,
    bookMethod: asset.bookMethod,
    bookRatePct: asset.bookRatePct != null ? Number(asset.bookRatePct) : null,
    bookLifeYears: asset.bookLifeYears,
    openingAccumDep: Number(asset.openingAccumDep),
    openingAccumThrough: asset.openingAccumThrough ? dateToYmd(asset.openingAccumThrough) : null,
    notes: asset.notes,
    disposal: asset.disposal ? disposalJson(asset.disposal) : null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

/** Fiscal years from the earliest asset's AFU year through the target year. */
export function registerYears(
  ctx: FiscalContext,
  assets: FixedAssetWithDisposal[],
  throughYmd: string
): FiscalYearRange[] {
  if (assets.length === 0) {
    return [fiscalYearRangeContaining(ctx.anchor, throughYmd, ctx.firstYear)];
  }
  const earliest = assets.map((a) => dateToYmd(a.availableForUseDate)).sort()[0];
  return fiscalYearsThrough(ctx, earliest, throughYmd);
}

/** Computed position for one asset at a fiscal year end. */
export function assetPosition(
  asset: FixedAssetWithDisposal,
  years: FiscalYearRange[],
  label: string
) {
  const facts = assetToFacts(asset);
  const disposed = !!asset.disposal && facts.disposal != null && facts.disposal.date <= (years.find((y) => y.label === label)?.end ?? '9999-12-31');
  return {
    accumulatedBookDep: toDollars(accumulatedDepAtCents(facts, years, label)),
    netBookValue: disposed ? 0 : toDollars(netBookValueAtCents(facts, years, label)),
    disposed,
  };
}

/** The asset's full book depreciation schedule, for the detail screen. */
export function assetSchedule(asset: FixedAssetWithDisposal, years: FiscalYearRange[]) {
  return computeBookSchedule(assetToFacts(asset), years).map((row) => ({
    label: row.label,
    start: row.start,
    end: row.end,
    openingNbv: toDollars(row.openingNbvCents),
    depreciation: toDollars(row.depreciationCents),
    closingNbv: toDollars(row.closingNbvCents),
    accumulatedDep: toDollars(row.accumulatedDepCents),
    disposal: row.disposal
      ? {
          date: row.disposal.date,
          proceeds: toDollars(row.disposal.proceedsCents),
          gainLoss: toDollars(row.disposal.gainLossCents),
        }
      : null,
  }));
}

/** Per-class continuity for a fiscal year, in dollars, for list/export views. */
export function continuityJson(rows: ClassContinuity[]) {
  return rows.map((c) => {
    const info = ccaClassInfo(c.ccaClass);
    return {
      ccaClass: c.ccaClass,
      label: info?.label ?? `Class ${c.ccaClass}`,
      ratePct: info?.ratePct ?? null,
      method: info?.method ?? 'DB',
      openingCost: toDollars(c.openingCostCents),
      additionsCost: toDollars(c.additionsCostCents),
      disposalsCost: toDollars(c.disposalsCostCents),
      disposalsProceeds: toDollars(c.disposalsProceedsCents),
      closingCost: toDollars(c.closingCostCents),
      bookDepreciation: toDollars(c.bookDepreciationCents),
      accumulatedBookDep: toDollars(c.accumulatedBookDepCents),
      netBookValue: toDollars(c.netBookValueCents),
    };
  });
}

export { classContinuity, fiscalContextOf };
