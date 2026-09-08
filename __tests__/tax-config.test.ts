import {
  assessCompanyTaxReadiness,
  CompanyTaxReadinessInput,
  TaxMappedAccount,
} from '@/lib/tax/config';

const account = (id: string, type: TaxMappedAccount['type'], companyId = 'company-1'): TaxMappedAccount => ({
  id,
  companyId,
  type,
  active: true,
});

const readyOntario: CompanyTaxReadinessInput = {
  companyId: 'company-1',
  province: 'ON',
  requireJurisdictionEvidence: true,
  configuredById: 'accountant-1',
  configuredAt: new Date('2026-09-07T00:00:00Z'),
  registrations: [{ regime: 'gst_hst', active: true, method: 'regular', reviewed: true }],
  approvedTaxCodeVersionCount: 1,
  mappings: {
    gstHstOutput: account('hst-output', 'liability'),
    gstHstRecoverable: account('hst-itc', 'asset'),
    rounding: account('rounding', 'expense'),
  },
};

describe('P1-B company tax activation readiness', () => {
  test('accepts a reviewed Ontario regular-method configuration', () => {
    expect(assessCompanyTaxReadiness(readyOntario)).toEqual({ ready: true, issues: [] });
  });

  test('requires QST and GST mappings for a Quebec registrant', () => {
    const result = assessCompanyTaxReadiness({
      ...readyOntario,
      province: 'QC',
      registrations: [
        ...readyOntario.registrations,
        { regime: 'qst', active: true, method: 'regular', reviewed: true },
      ],
    });
    expect(result.ready).toBe(false);
    expect(result.issues.filter(issue => issue.code === 'account_mapping_required').map(issue => issue.field)).toEqual([
      'mappings.qstOutput',
      'mappings.qstRecoverable',
    ]);
  });

  test.each(['pst', 'rst'] as const)('requires a provincial payable mapping for %s registration', regime => {
    const result = assessCompanyTaxReadiness({
      ...readyOntario,
      registrations: [
        ...readyOntario.registrations,
        { regime, active: true, method: 'regular', reviewed: true },
      ],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'account_mapping_required', field: 'mappings.pstRstPayable' }),
    ]));
  });

  test('rejects cross-company, inactive, and wrongly classified GL accounts', () => {
    const result = assessCompanyTaxReadiness({
      ...readyOntario,
      mappings: {
        gstHstOutput: account('foreign-output', 'liability', 'company-2'),
        gstHstRecoverable: { ...account('inactive-itc', 'asset'), active: false },
        rounding: account('wrong-rounding', 'liability'),
      },
    });
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'account_company_mismatch',
      'account_inactive',
      'account_type_invalid',
    ]));
  });

  test('blocks incomplete governance and catalog configuration', () => {
    const result = assessCompanyTaxReadiness({
      ...readyOntario,
      province: null,
      requireJurisdictionEvidence: false,
      configuredById: null,
      configuredAt: null,
      registrations: [],
      approvedTaxCodeVersionCount: 0,
      mappings: {},
    });
    expect(result.ready).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'company_province_required',
      'jurisdiction_evidence_required',
      'configuration_review_required',
      'active_registration_required',
      'approved_tax_code_required',
      'account_mapping_required',
    ]));
  });

  test('requires active registrations to be reviewed', () => {
    const result = assessCompanyTaxReadiness({
      ...readyOntario,
      registrations: [{ regime: 'gst_hst', active: true, method: 'regular', reviewed: false }],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'registration_review_required' }),
    ]));
  });
});
