/**
 * CCA classes the register offers — exactly the classes Nexvar Tax
 * models, with the same rates and methods as its verified parameter
 * bundle (Nexvar Tax: src/modules/calc/parameters.ts,
 * VERIFIED_M4_PARAMETERS, verified from CRA "Classes of depreciable
 * property" / ITR 1100). The register picker is limited to this list
 * (design §3.2) so an asset can never be recorded in a class the tax
 * engine cannot compute.
 *
 * These rates drive the BOOK mirror-tax depreciation presentation
 * only (src/lib/cca/engine.ts). They are not the CCA computation —
 * UCC pools, first-year factors, recapture and terminal loss live in
 * Nexvar Tax, which re-derives everything from the exported facts.
 */

export interface CcaClassInfo {
  code: string;
  /** Plain-language label for the picker, e.g. "Class 10 — vehicles, 30%". */
  label: string;
  /** CCA rate in percent (30 = 30%). Null for life-based SL classes 13/14. */
  ratePct: number | null;
  method: 'DB' | 'SL';
  /** Half-year rule does not apply (Classes 12 and 52 in the tax bundle). */
  halfYearExempt: boolean;
  /** Class 10.1: each asset is its own class on the tax side. */
  separateClassPerAsset: boolean;
  /** Intangible classes take GIFI 8570 amortization expense; the rest take 8670. */
  intangible: boolean;
}

export const CCA_CLASSES: Record<string, CcaClassInfo> = {
  '1':    { code: '1',    label: 'Class 1 — buildings, 4%',                              ratePct: 4,    method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '3':    { code: '3',    label: 'Class 3 — buildings acquired before 1988, 5%',         ratePct: 5,    method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '6':    { code: '6',    label: 'Class 6 — frame buildings & certain structures, 10%',  ratePct: 10,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '8':    { code: '8',    label: 'Class 8 — furniture, equipment & fixtures, 20%',       ratePct: 20,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '10':   { code: '10',   label: 'Class 10 — vehicles & general equipment, 30%',         ratePct: 30,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '10.1': { code: '10.1', label: 'Class 10.1 — passenger vehicle over the cost cap, 30%', ratePct: 30,  method: 'DB', halfYearExempt: false, separateClassPerAsset: true,  intangible: false },
  '12':   { code: '12',   label: 'Class 12 — tools, software & small items, 100%',       ratePct: 100,  method: 'DB', halfYearExempt: true,  separateClassPerAsset: false, intangible: false },
  '13':   { code: '13',   label: 'Class 13 — leasehold improvements (straight-line over the lease term)', ratePct: null, method: 'SL', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '14':   { code: '14',   label: 'Class 14 — patents & limited-life intangibles (straight-line over their life)', ratePct: null, method: 'SL', halfYearExempt: false, separateClassPerAsset: false, intangible: true },
  '14.1': { code: '14.1', label: 'Class 14.1 — goodwill & indefinite-life intangibles, 5%', ratePct: 5,  method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: true },
  '17':   { code: '17',   label: 'Class 17 — electrical generating & distribution equipment, 8%', ratePct: 8, method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '29':   { code: '29',   label: 'Class 29 — manufacturing machinery (2007–2015), 50% straight-line', ratePct: 50, method: 'SL', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '38':   { code: '38',   label: 'Class 38 — power-operated movable equipment, 30%',     ratePct: 30,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '41':   { code: '41',   label: 'Class 41 — mining property, 25%',                     ratePct: 25,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '43':   { code: '43',   label: 'Class 43 — manufacturing & processing machinery, 30%', ratePct: 30,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '45':   { code: '45',   label: 'Class 45 — computer hardware (2004–2011), 45%',        ratePct: 45,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '50':   { code: '50',   label: 'Class 50 — computer hardware, 55%',                    ratePct: 55,   method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
  '52':   { code: '52',   label: 'Class 52 — computer hardware (2009–2011), 100%',       ratePct: 100,  method: 'DB', halfYearExempt: true,  separateClassPerAsset: false, intangible: false },
  '53':   { code: '53',   label: 'Class 53 — manufacturing machinery acquired 2016–2025, 50%', ratePct: 50, method: 'DB', halfYearExempt: false, separateClassPerAsset: false, intangible: false },
};

export const CCA_CLASS_CODES = Object.keys(CCA_CLASSES);

export function ccaClassInfo(code: string): CcaClassInfo | null {
  return CCA_CLASSES[code] ?? null;
}

/**
 * Default AIIP flag by the acquisition-date rule (design §3.2:
 * defaults by acquisition date, overridable): property acquired
 * after November 20, 2018 and available for use before 2028 is
 * Accelerated Investment Incentive Property.
 */
export function defaultAiip(acquisitionDate: string, availableForUseDate: string): boolean {
  return acquisitionDate > '2018-11-20' && availableForUseDate < '2028-01-01';
}

/**
 * First-year factor the BOOK mirror applies to a mirror-tax addition:
 * 0.5 under the half-year rule; 1 for half-year-exempt classes; for
 * AIIP, 1.5 when available for use before 2024 (the enhanced
 * allowance — up to 3× the half-year amount) phasing to 1.0 for
 * 2024–2027 (half-year rule suspended, no enhancement) and back to
 * 0.5 after 2027. This is a book-presentation approximation only —
 * Nexvar Tax applies the exact ITR 1100(2) factors from the exported
 * flag and dates.
 */
export function mirrorFirstYearFactor(info: CcaClassInfo, aiip: boolean, availableForUseDate: string): number {
  if (info.halfYearExempt) return 1;
  if (aiip) {
    if (availableForUseDate < '2024-01-01') return 1.5;
    if (availableForUseDate < '2028-01-01') return 1;
    return 0.5;
  }
  return 0.5;
}
