/**
 * Phase 1.5 — Tax Setup validation and workpaper-readiness helpers.
 *
 * Pure module (no database, no Prisma): the Tax Setup API routes, the
 * DB-backed setup service, and unit tests all share these schemas so the
 * rules live in exactly one place.
 *
 * Two different readiness questions are answered in this codebase and they
 * must not be conflated:
 *  - `assessCompanyTaxReadiness` (config.ts) — readiness to post invoices and
 *    bills through the *reviewed* tax engine. It additionally requires
 *    approved tax-code catalogue versions and a rounding mapping.
 *  - `assessTaxWorkpaperReadiness` (below) — readiness to build a Tax
 *    Workpaper (reviewed-source or GL simple-path). It mirrors what
 *    workpaper-service.ts blocks on: a configuration with the GL mappings
 *    for the registered regime and an active, reviewed registration.
 *    Reviewed-source workpapers additionally require the workflow to be
 *    enabled; a GST/HST GL simple-path workpaper does not, because enabling
 *    reviewed postings changes bank/invoice/bill behaviour for the very
 *    companies the bridge serves. It deliberately does NOT require
 *    tax-code versions: a simple-path company has no reviewed documents
 *    and still files GST/HST.
 */
import { z } from 'zod';
import type { SupportedTaxRegime, TaxAccountPurpose } from './config';

export const TAX_REGIMES = ['gst_hst', 'qst', 'pst', 'rst'] as const;
export const TAX_PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
] as const;
export const TAX_FILING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'other'] as const;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    // Date.parse normalizes impossible dates (Feb 30 -> Mar 2); round-trip
    // the components through Date.UTC so only real calendar dates pass.
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Invalid calendar date');

const accountId = z.string().trim().min(1).max(64).nullable().optional();

/** PUT body for the company tax configuration (mappings are account ids). */
export const taxConfigurationInputSchema = z
  .object({
    enabled: z.boolean(),
    defaultPriceMode: z.enum(['exclusive', 'inclusive']).optional(),
    requireJurisdictionEvidence: z.boolean().optional(),
    gstHstOutputAccountId: accountId,
    gstHstRecoverableAccountId: accountId,
    qstOutputAccountId: accountId,
    qstRecoverableAccountId: accountId,
    pstRstPayableAccountId: accountId,
    taxRoundingAccountId: accountId,
    taxClearingAccountId: accountId,
    /** Explicit reviewer attestation: stamps configuredById/configuredAt.
     * Saving without it clears any prior review stamp. */
    reviewed: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Database invariant (migration 20260907230000, check
    // CompanyTaxConfiguration_enabled_reviewed_check): an enabled
    // configuration must require jurisdiction evidence, carry a review
    // stamp, and have a tax rounding account mapped. The stamp/rounding
    // parts depend on existing state, so the service enforces them; the
    // evidence flag is fully determined by this body.
    if (value.enabled && value.requireJurisdictionEvidence === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ['requireJurisdictionEvidence'],
        message: 'The tax workflow can only be enabled while jurisdiction evidence is required',
      });
    }
  });
export type TaxConfigurationInput = z.infer<typeof taxConfigurationInputSchema>;

const registrationFields = {
  regime: z.enum(TAX_REGIMES),
  registrationNumber: z.string().trim().min(1, 'Registration number is required').max(100),
  province: z.enum(TAX_PROVINCES).nullable().optional(),
  method: z.literal('regular').optional(),
  filingFrequency: z.enum(TAX_FILING_FREQUENCIES),
  validFrom: dateOnly,
  validTo: dateOnly.nullable().optional(),
  active: z.boolean().optional(),
  /** Explicit reviewer attestation: stamps reviewedById/reviewedAt. */
  reviewed: z.boolean().optional(),
};

function refineRegistration<T extends { province?: string | null; regime: string; validFrom: string; validTo?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
) {
  // Database check CompanyTaxRegistration_valid_range_check requires
  // validTo strictly AFTER validFrom (an equal date is rejected by the DB).
  if (value.validTo != null && value.validTo <= value.validFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'Valid-to date must be after the valid-from date' });
  }
  if (value.regime !== 'gst_hst' && !value.province) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['province'], message: 'A province is required for QST, PST and RST registrations' });
  }
  if (value.regime === 'qst' && value.province && value.province !== 'QC') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['province'], message: 'QST registrations are for Quebec' });
  }
}

export const taxRegistrationCreateSchema = z.object(registrationFields).strict().superRefine(refineRegistration);
export type TaxRegistrationCreateInput = z.infer<typeof taxRegistrationCreateSchema>;

/** PATCH body: every field optional, but at least one key must be present. */
export const taxRegistrationUpdateSchema = z
  .object({
    regime: registrationFields.regime.optional(),
    registrationNumber: registrationFields.registrationNumber.optional(),
    province: registrationFields.province,
    method: registrationFields.method,
    filingFrequency: registrationFields.filingFrequency.optional(),
    validFrom: registrationFields.validFrom.optional(),
    validTo: registrationFields.validTo,
    active: registrationFields.active,
    reviewed: registrationFields.reviewed,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type TaxRegistrationUpdateInput = z.infer<typeof taxRegistrationUpdateSchema>;

/** Registration fields whose change invalidates a prior review stamp. */
export const REGISTRATION_REVIEW_FIELDS = [
  'regime',
  'registrationNumber',
  'province',
  'method',
  'filingFrequency',
  'validFrom',
  'validTo',
  'active',
] as const;

export function registrationEditNeedsReReview(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  return REGISTRATION_REVIEW_FIELDS.some((field) => field in patch && patch[field] !== before[field]);
}

// ─── Workpaper readiness (mirrors workpaper-service blockers) ───────────────

export interface WorkpaperSetupRegistration {
  regime: SupportedTaxRegime;
  active: boolean;
  reviewed: boolean;
}

export interface TaxWorkpaperReadinessInput {
  configurationExists: boolean;
  enabled: boolean;
  /** Which mapping purposes currently point at an account. */
  mappedPurposes: readonly TaxAccountPurpose[];
  registrations: readonly WorkpaperSetupRegistration[];
}

export interface TaxWorkpaperReadiness {
  ready: boolean;
  issues: string[];
}

const REGIME_LABEL: Record<SupportedTaxRegime, string> = {
  gst_hst: 'GST/HST',
  qst: 'QST',
  pst: 'PST',
  rst: 'RST',
};

function requiredPurposesFor(regime: SupportedTaxRegime): TaxAccountPurpose[] {
  if (regime === 'gst_hst') return ['gstHstOutput', 'gstHstRecoverable'];
  if (regime === 'qst') return ['qstOutput', 'qstRecoverable'];
  return ['pstRstPayable'];
}

const PURPOSE_LABEL: Record<TaxAccountPurpose, string> = {
  gstHstOutput: 'GST/HST collected (output) account',
  gstHstRecoverable: 'GST/HST recoverable (ITC) account',
  qstOutput: 'QST collected (output) account',
  qstRecoverable: 'QST recoverable account',
  pstRstPayable: 'PST/RST payable account',
  rounding: 'tax rounding account',
  clearing: 'tax clearing account',
};

export function assessTaxWorkpaperReadiness(input: TaxWorkpaperReadinessInput): TaxWorkpaperReadiness {
  const issues: string[] = [];
  const active = input.registrations.filter((r) => r.active);
  if (!input.configurationExists) {
    issues.push('No tax configuration exists yet — save the Tax Setup configuration first.');
  } else if (!input.enabled && active.some((r) => r.regime !== 'gst_hst')) {
    // GST/HST GL simple-path workpapers do not require reviewed-posting
    // enablement; every other regime's workpaper is reviewed-source only.
    issues.push('The tax workflow is disabled in Tax Setup — required for QST, PST and RST workpapers (not for GST/HST GL simple-path workpapers).');
  }
  if (active.length === 0) {
    issues.push('No active tax registration — add one in Tax Setup and mark it reviewed.');
  }
  for (const registration of active) {
    if (!registration.reviewed) {
      issues.push(`The active ${REGIME_LABEL[registration.regime]} registration has not been reviewed.`);
    }
    if (input.configurationExists) {
      for (const purpose of requiredPurposesFor(registration.regime)) {
        if (!input.mappedPurposes.includes(purpose)) {
          issues.push(`The ${PURPOSE_LABEL[purpose]} is not mapped in Tax Setup.`);
        }
      }
    }
  }
  return { ready: issues.length === 0, issues };
}
