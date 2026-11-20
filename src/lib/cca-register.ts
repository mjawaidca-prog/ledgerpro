/**
 * cca-register/1 export — the file that feeds Nexvar Tax's Schedule 8.
 *
 * A sibling of `tb-gifi/1` (src/lib/tb-gifi.ts) with the same
 * conventions: contract version, companyId, BN in full account form,
 * money as decimal strings built with integer-cent math, and `hash`
 * = SHA-256 of the canonical payload (stable JSON, keys sorted,
 * payload WITHOUT the hash field). Design: improvement-plan
 * DESIGN-TAX-DOMAIN.md §3.3.
 *
 * What it carries, per fiscal year:
 *  - per CCA class: the asset FACTS Nexvar Tax needs — additions per
 *    asset (description, cost NET of ITCs, acquisition date,
 *    available-for-use date, AIIP flag, would-be-Class-53 flag) and
 *    disposals per asset (proceeds, date, reason) — plus the class
 *    capital-cost continuity and the book side for that class;
 *  - a per-asset full register dump for the accountant's working
 *    papers;
 *  - the book side: book amortization expense for the year and
 *    accumulated book depreciation, cross-checked against the
 *    amortization expense actually in the trial balance (GIFI
 *    8670/8570 accounts) — the difference is REPORTED, never hidden;
 *  - the Schedule 1 inputs that are machine-supplied: the book
 *    amortization add-back. `ccaClaimed` is RESERVED (null): the CCA
 *    figure is computed in Nexvar Tax at filing time and flows back
 *    through the write-back loop (design §3.4 — deferred, pending an
 *    owner decision), which will also populate each class's
 *    `openingUccAsFiled`. LedgerPro never invents either number.
 *
 * Server-side only (the hash uses node:crypto, via tb-gifi).
 */

import { canonicalPayloadHash, centsToMoney } from './tb-gifi';

export const CCA_REGISTER_CONTRACT_VERSION = 'cca-register/1';

export interface CcaRegisterDisposalFact {
  date: string; // YYYY-MM-DD
  proceedsCents: number;
  reason: string;
}

export interface CcaRegisterAssetInput {
  assetId: string;
  description: string;
  ccaClass: string;
  /** Capital cost NET of ITCs and government assistance — the cost for CCA. */
  capitalCostCents: number;
  grossCostCents: number;
  itcClaimedCents: number;
  governmentAssistanceCents: number;
  acquisitionDate: string; // YYYY-MM-DD
  availableForUseDate: string; // YYYY-MM-DD
  aiip: boolean;
  wouldBeClass53: boolean;
  luxuryVehicle: boolean;
  vendor: string | null;
  serialNumber: string | null;
  bookMethod: string;
  /** Book position at the export fiscal year end (0 NBV once disposed). */
  accumulatedBookDepCents: number;
  netBookValueCents: number;
  disposal: CcaRegisterDisposalFact | null;
}

export interface CcaRegisterClassInput {
  ccaClass: string;
  label: string;
  ratePct: number | null;
  method: 'DB' | 'SL';
  openingCapitalCostCents: number;
  closingCapitalCostCents: number;
  bookDepreciationExpenseCents: number;
  accumulatedBookDepCents: number;
  netBookValueCents: number;
  additionAssetIds: string[];
  disposalAssetIds: string[];
}

export interface BuildCcaRegisterInput {
  companyId: string;
  bn: string;
  fiscalYearStart: string; // YYYY-MM-DD
  fiscalYearEnd: string; // YYYY-MM-DD
  fiscalYearLabel: string; // e.g. "FY 2026"
  classes: CcaRegisterClassInput[];
  assets: CcaRegisterAssetInput[];
  /**
   * Amortization expense for the year as it stands in the trial
   * balance (accounts carrying GIFI 8670/8570), or null when the
   * ledger has no such accounts to compare against.
   */
  ledgerAmortizationExpenseCents: number | null;
}

export interface BuildCcaRegisterResult {
  payload: Record<string, unknown> & { hash: string };
  assetCount: number;
  classCount: number;
  /** Register book expense minus ledger expense; null when no ledger figure exists. */
  bookVsLedgerDifferenceCents: number | null;
}

function assetJson(a: CcaRegisterAssetInput) {
  return {
    assetId: a.assetId,
    description: a.description,
    ccaClass: a.ccaClass,
    capitalCost: centsToMoney(a.capitalCostCents),
    grossCost: centsToMoney(a.grossCostCents),
    itcClaimed: centsToMoney(a.itcClaimedCents),
    governmentAssistance: centsToMoney(a.governmentAssistanceCents),
    acquisitionDate: a.acquisitionDate,
    availableForUseDate: a.availableForUseDate,
    aiip: a.aiip,
    wouldBeClass53: a.wouldBeClass53,
    luxuryVehicle: a.luxuryVehicle,
    vendor: a.vendor,
    serialNumber: a.serialNumber,
    bookMethod: a.bookMethod,
    accumulatedBookDepreciation: centsToMoney(a.accumulatedBookDepCents),
    netBookValue: centsToMoney(a.netBookValueCents),
    disposal: a.disposal
      ? {
          date: a.disposal.date,
          proceeds: centsToMoney(a.disposal.proceedsCents),
          reason: a.disposal.reason,
        }
      : null,
  };
}

export function buildCcaRegisterPayload(input: BuildCcaRegisterInput): BuildCcaRegisterResult {
  const byId = new Map(input.assets.map((a) => [a.assetId, a]));

  const classes = input.classes.map((c) => ({
    ccaClass: c.ccaClass,
    label: c.label,
    ratePct: c.ratePct,
    method: c.method,
    // Reserved for the write-back loop (design §3.4): the opening UCC
    // as filed on last year's return. Null until Nexvar Tax writes it
    // back — LedgerPro does not keep a shadow UCC.
    openingUccAsFiled: null,
    openingCapitalCost: centsToMoney(c.openingCapitalCostCents),
    additions: c.additionAssetIds.map((id) => {
      const a = byId.get(id);
      if (!a) throw new Error(`cca-register: addition asset ${id} missing from the register dump`);
      return {
        assetId: a.assetId,
        description: a.description,
        cost: centsToMoney(a.capitalCostCents),
        acquisitionDate: a.acquisitionDate,
        availableForUseDate: a.availableForUseDate,
        aiip: a.aiip,
        wouldBeClass53: a.wouldBeClass53,
      };
    }),
    disposals: c.disposalAssetIds.map((id) => {
      const a = byId.get(id);
      if (!a?.disposal) throw new Error(`cca-register: disposal asset ${id} has no disposal fact`);
      return {
        assetId: a.assetId,
        description: a.description,
        proceeds: centsToMoney(a.disposal.proceedsCents),
        date: a.disposal.date,
        reason: a.disposal.reason,
      };
    }),
    closingCapitalCost: centsToMoney(c.closingCapitalCostCents),
    book: {
      depreciationExpenseForYear: centsToMoney(c.bookDepreciationExpenseCents),
      accumulatedDepreciation: centsToMoney(c.accumulatedBookDepCents),
      netBookValue: centsToMoney(c.netBookValueCents),
    },
  }));

  const bookExpenseCents = input.classes.reduce((s, c) => s + c.bookDepreciationExpenseCents, 0);
  const accumulatedBookDepCents = input.classes.reduce((s, c) => s + c.accumulatedBookDepCents, 0);
  const differenceCents =
    input.ledgerAmortizationExpenseCents != null
      ? bookExpenseCents - input.ledgerAmortizationExpenseCents
      : null;

  const withoutHash = {
    contractVersion: CCA_REGISTER_CONTRACT_VERSION,
    companyId: input.companyId,
    bn: input.bn,
    fiscalYearStart: input.fiscalYearStart,
    fiscalYearEnd: input.fiscalYearEnd,
    fiscalYearLabel: input.fiscalYearLabel,
    classes,
    assets: input.assets.map(assetJson),
    bookSide: {
      bookAmortizationExpenseForYear: centsToMoney(bookExpenseCents),
      accumulatedBookDepreciation: centsToMoney(accumulatedBookDepCents),
      ledgerAmortizationExpenseForYear:
        input.ledgerAmortizationExpenseCents != null
          ? centsToMoney(input.ledgerAmortizationExpenseCents)
          : null,
      difference: differenceCents != null ? centsToMoney(differenceCents) : null,
      tiesOut: differenceCents != null ? differenceCents === 0 : null,
    },
    schedule1: {
      // Machine-supplied Sch 1 inputs (design §3.1/§3.3): add back
      // the book amortization; the CCA claimed is deducted against
      // it. ccaClaimed is RESERVED — it is computed in Nexvar Tax at
      // filing time and returns via the write-back loop (§3.4).
      bookAmortizationAddBack: centsToMoney(bookExpenseCents),
      ccaClaimed: null,
    },
  };

  return {
    payload: { ...withoutHash, hash: canonicalPayloadHash(withoutHash) },
    assetCount: input.assets.length,
    classCount: classes.length,
    bookVsLedgerDifferenceCents: differenceCents,
  };
}
