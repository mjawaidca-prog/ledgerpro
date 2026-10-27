import {
  assessTaxWorkpaperReadiness,
  registrationEditNeedsReReview,
  taxConfigurationInputSchema,
  taxRegistrationCreateSchema,
  taxRegistrationUpdateSchema,
} from '@/lib/tax/setup';

describe('Phase 1.5 tax setup validation', () => {
  test('accepts a complete GST/HST configuration with default mappings', () => {
    const parsed = taxConfigurationInputSchema.safeParse({
      enabled: true,
      defaultPriceMode: 'exclusive',
      requireJurisdictionEvidence: true,
      gstHstOutputAccountId: 'acct-2300',
      gstHstRecoverableAccountId: 'acct-2310',
      pstRstPayableAccountId: 'acct-2330',
      taxRoundingAccountId: null,
      taxClearingAccountId: null,
      reviewed: true,
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects unknown fields and non-boolean switches', () => {
    expect(taxConfigurationInputSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
    expect(taxConfigurationInputSchema.safeParse({ enabled: true, evil: 1 }).success).toBe(false);
  });

  test('accepts Muja-style annual GST/HST registration', () => {
    const parsed = taxRegistrationCreateSchema.safeParse({
      regime: 'gst_hst',
      registrationNumber: '731893160 RT0001',
      province: 'AB',
      filingFrequency: 'annual',
      validFrom: '2025-10-02',
      validTo: '2026-10-01',
      active: true,
      reviewed: true,
    });
    expect(parsed.success).toBe(true);
  });

  test('rejects a valid-to before or equal to valid-from and impossible dates', () => {
    const base = { regime: 'gst_hst', registrationNumber: 'X', filingFrequency: 'annual', validFrom: '2026-01-01' };
    expect(taxRegistrationCreateSchema.safeParse({ ...base, validTo: '2025-12-31' }).success).toBe(false);
    // DB check requires validTo strictly after validFrom.
    expect(taxRegistrationCreateSchema.safeParse({ ...base, validTo: '2026-01-01' }).success).toBe(false);
    expect(taxRegistrationCreateSchema.safeParse({ ...base, validFrom: '2026-02-30' }).success).toBe(false);
  });

  test('an enabled configuration must require jurisdiction evidence (DB invariant)', () => {
    expect(taxConfigurationInputSchema.safeParse({ enabled: true, requireJurisdictionEvidence: false }).success).toBe(false);
    expect(taxConfigurationInputSchema.safeParse({ enabled: false, requireJurisdictionEvidence: false }).success).toBe(true);
  });

  test('requires a province for provincial regimes and QC for QST', () => {
    const base = { registrationNumber: 'X', filingFrequency: 'annual', validFrom: '2026-01-01' };
    expect(taxRegistrationCreateSchema.safeParse({ ...base, regime: 'pst' }).success).toBe(false);
    expect(taxRegistrationCreateSchema.safeParse({ ...base, regime: 'qst', province: 'AB' }).success).toBe(false);
    expect(taxRegistrationCreateSchema.safeParse({ ...base, regime: 'qst', province: 'QC' }).success).toBe(true);
  });

  test('update schema requires at least one field and allows review-only', () => {
    expect(taxRegistrationUpdateSchema.safeParse({}).success).toBe(false);
    expect(taxRegistrationUpdateSchema.safeParse({ reviewed: true }).success).toBe(true);
    expect(taxRegistrationUpdateSchema.safeParse({ active: false }).success).toBe(true);
  });

  test('substantive registration edits need re-review; review-only does not', () => {
    const before = { regime: 'gst_hst', registrationNumber: 'A', province: 'AB', validFrom: '2025-10-02', validTo: null, active: true };
    expect(registrationEditNeedsReReview(before, { registrationNumber: 'B' })).toBe(true);
    expect(registrationEditNeedsReReview(before, { active: false })).toBe(true);
    expect(registrationEditNeedsReReview(before, { registrationNumber: 'A' })).toBe(false);
  });
});

describe('Phase 1.5 workpaper readiness (mirrors workpaper-service blockers)', () => {
  const ready = {
    configurationExists: true,
    enabled: true,
    mappedPurposes: ['gstHstOutput', 'gstHstRecoverable'] as const,
    registrations: [{ regime: 'gst_hst' as const, active: true, reviewed: true }],
  };

  test('Muja-shaped setup is workpaper-ready without tax-code versions', () => {
    expect(assessTaxWorkpaperReadiness(ready)).toEqual({ ready: true, issues: [] });
  });

  test('missing configuration, disabled workflow and no registration each explain themselves', () => {
    const result = assessTaxWorkpaperReadiness({ configurationExists: false, enabled: false, mappedPurposes: [], registrations: [] });
    expect(result.ready).toBe(false);
    expect(result.issues.join(' ')).toMatch(/No tax configuration/);
    expect(result.issues.join(' ')).toMatch(/No active tax registration/);
  });

  test('disabled configuration still readies a GST/HST GL simple-path workpaper', () => {
    // Reviewed-posting enablement is deliberately not required for the
    // GL bridge: enabling it would change bank/invoice/bill behaviour
    // for simple-path companies.
    expect(assessTaxWorkpaperReadiness({ ...ready, enabled: false })).toEqual({ ready: true, issues: [] });
  });

  test('disabled configuration blocks non-GST workpapers, including in a mixed setup', () => {
    const qstOnly = assessTaxWorkpaperReadiness({
      configurationExists: true,
      enabled: false,
      mappedPurposes: ['qstOutput', 'qstRecoverable'] as const,
      registrations: [{ regime: 'qst' as const, active: true, reviewed: true }],
    });
    expect(qstOnly.ready).toBe(false);
    expect(qstOnly.issues.join(' ')).toMatch(/disabled in Tax Setup — required for QST, PST and RST/);

    const mixed = assessTaxWorkpaperReadiness({
      ...ready,
      enabled: false,
      mappedPurposes: ['gstHstOutput', 'gstHstRecoverable', 'pstRstPayable'] as const,
      registrations: [
        { regime: 'gst_hst' as const, active: true, reviewed: true },
        { regime: 'pst' as const, active: true, reviewed: true },
      ],
    });
    expect(mixed.ready).toBe(false);
    expect(mixed.issues.join(' ')).toMatch(/required for QST, PST and RST/);
  });

  test('unreviewed registration and missing ITC mapping block with named issues', () => {
    const result = assessTaxWorkpaperReadiness({
      ...ready,
      mappedPurposes: ['gstHstOutput'],
      registrations: [{ regime: 'gst_hst', active: true, reviewed: false }],
    });
    expect(result.ready).toBe(false);
    expect(result.issues.join(' ')).toMatch(/has not been reviewed/);
    expect(result.issues.join(' ')).toMatch(/GST\/HST recoverable \(ITC\) account is not mapped/);
  });
});
