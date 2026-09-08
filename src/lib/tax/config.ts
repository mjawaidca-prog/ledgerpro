/**
 * P1-B activation-readiness checks for company tax configuration.
 * This module does not write configuration or enable the P1 posting path.
 */
export type SupportedTaxRegime = 'gst_hst' | 'qst' | 'pst' | 'rst';
export type MappedAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type TaxAccountPurpose =
  | 'gstHstOutput'
  | 'gstHstRecoverable'
  | 'qstOutput'
  | 'qstRecoverable'
  | 'pstRstPayable'
  | 'rounding'
  | 'clearing';

export interface TaxMappedAccount {
  id: string;
  companyId: string;
  active: boolean;
  type: MappedAccountType;
}

export interface TaxRegistrationReadiness {
  regime: SupportedTaxRegime;
  active: boolean;
  method: 'regular';
  reviewed: boolean;
}

export interface CompanyTaxReadinessInput {
  companyId: string;
  province: string | null;
  requireJurisdictionEvidence: boolean;
  configuredById: string | null;
  configuredAt: Date | null;
  registrations: readonly TaxRegistrationReadiness[];
  approvedTaxCodeVersionCount: number;
  mappings: Partial<Record<TaxAccountPurpose, TaxMappedAccount | null>>;
}

export type TaxReadinessIssueCode =
  | 'company_province_required'
  | 'jurisdiction_evidence_required'
  | 'configuration_review_required'
  | 'active_registration_required'
  | 'registration_review_required'
  | 'approved_tax_code_required'
  | 'account_mapping_required'
  | 'account_company_mismatch'
  | 'account_inactive'
  | 'account_type_invalid';

export interface TaxReadinessIssue {
  code: TaxReadinessIssueCode;
  field: string;
  message: string;
}

export interface TaxReadinessResult {
  ready: boolean;
  issues: TaxReadinessIssue[];
}

const allowedAccountTypes: Record<TaxAccountPurpose, readonly MappedAccountType[]> = {
  gstHstOutput: ['liability'],
  gstHstRecoverable: ['asset'],
  qstOutput: ['liability'],
  qstRecoverable: ['asset'],
  pstRstPayable: ['liability'],
  rounding: ['expense'],
  clearing: ['asset', 'liability'],
};

function requiredPurposes(regimes: ReadonlySet<SupportedTaxRegime>): TaxAccountPurpose[] {
  const purposes: TaxAccountPurpose[] = ['rounding'];
  if (regimes.has('gst_hst')) purposes.push('gstHstOutput', 'gstHstRecoverable');
  if (regimes.has('qst')) purposes.push('qstOutput', 'qstRecoverable');
  if (regimes.has('pst') || regimes.has('rst')) purposes.push('pstRstPayable');
  return purposes;
}

export function assessCompanyTaxReadiness(input: CompanyTaxReadinessInput): TaxReadinessResult {
  const issues: TaxReadinessIssue[] = [];
  const add = (code: TaxReadinessIssueCode, field: string, message: string) => {
    issues.push({ code, field, message });
  };

  if (!input.province) add('company_province_required', 'province', 'Company province is required.');
  if (!input.requireJurisdictionEvidence) {
    add('jurisdiction_evidence_required', 'requireJurisdictionEvidence', 'Jurisdiction evidence must remain required.');
  }
  if (!input.configuredById || !input.configuredAt) {
    add('configuration_review_required', 'configuredBy', 'An identified reviewer and review time are required.');
  }

  const activeRegistrations = input.registrations.filter(registration => registration.active);
  if (activeRegistrations.length === 0) {
    add('active_registration_required', 'registrations', 'At least one active tax registration is required.');
  }
  for (const registration of activeRegistrations) {
    if (registration.method !== 'regular' || !registration.reviewed) {
      add('registration_review_required', `registrations.${registration.regime}`, 'Only reviewed regular-method registrations are supported.');
    }
  }

  if (!Number.isSafeInteger(input.approvedTaxCodeVersionCount) || input.approvedTaxCodeVersionCount < 1) {
    add('approved_tax_code_required', 'taxCodes', 'At least one approved effective tax-code version is required.');
  }

  const regimes = new Set(activeRegistrations.map(registration => registration.regime));
  for (const purpose of requiredPurposes(regimes)) {
    const account = input.mappings[purpose];
    if (!account) {
      add('account_mapping_required', `mappings.${purpose}`, `A ${purpose} account must be selected.`);
      continue;
    }
    if (account.companyId !== input.companyId) {
      add('account_company_mismatch', `mappings.${purpose}`, 'Mapped account must belong to the configured company.');
    }
    if (!account.active) add('account_inactive', `mappings.${purpose}`, 'Mapped account must be active.');
    if (!allowedAccountTypes[purpose].includes(account.type)) {
      add('account_type_invalid', `mappings.${purpose}`, `Mapped account type is invalid for ${purpose}.`);
    }
  }

  return { ready: issues.length === 0, issues };
}
