/**
 * Phase 1.5 — DB-backed Tax Setup service.
 *
 * Creates/updates the CompanyTaxConfiguration and CompanyTaxRegistration
 * records that the reviewed tax engine and Tax Workpapers already read.
 * No schema change: everything maps onto existing models and the composite
 * same-company account relations in prisma/schema.prisma.
 *
 * Mutations are owner/admin only (enforced again at the route boundary) and
 * every mutation writes an AuditLog row inside the same transaction, using
 * the same action/entity vocabulary as the workpaper service.
 */
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  assessCompanyTaxReadiness,
  TAX_ACCOUNT_ALLOWED_TYPES,
  type TaxAccountPurpose,
  type TaxReadinessResult,
} from '@/lib/tax/config';
import {
  assessTaxWorkpaperReadiness,
  registrationEditNeedsReReview,
  type TaxWorkpaperReadiness,
  type TaxConfigurationInput,
  type TaxRegistrationCreateInput,
  type TaxRegistrationUpdateInput,
} from '@/lib/tax/setup';
import { TaxPostingError } from '@/lib/tax/posting-service';

const SETUP_ROLES = ['owner', 'admin'] as const;

function assertSetupRole(role: string | null | undefined): void {
  if (!role || !(SETUP_ROLES as readonly string[]).includes(role)) {
    throw new TaxPostingError('insufficient_permissions', 'Owner or admin access is required to change tax setup.', 403);
  }
}

const PURPOSE_BY_CONFIG_FIELD = {
  gstHstOutputAccountId: 'gstHstOutput',
  gstHstRecoverableAccountId: 'gstHstRecoverable',
  qstOutputAccountId: 'qstOutput',
  qstRecoverableAccountId: 'qstRecoverable',
  pstRstPayableAccountId: 'pstRstPayable',
  taxRoundingAccountId: 'rounding',
  taxClearingAccountId: 'clearing',
} as const satisfies Record<string, TaxAccountPurpose>;

type ConfigAccountField = keyof typeof PURPOSE_BY_CONFIG_FIELD;
const CONFIG_ACCOUNT_FIELDS = Object.keys(PURPOSE_BY_CONFIG_FIELD) as ConfigAccountField[];

const accountSelect = { id: true, code: true, name: true, type: true, active: true, companyId: true } as const;
const configInclude = {
  gstHstOutputAccount: { select: accountSelect },
  gstHstRecoverableAccount: { select: accountSelect },
  qstOutputAccount: { select: accountSelect },
  qstRecoverableAccount: { select: accountSelect },
  pstRstPayableAccount: { select: accountSelect },
  taxRoundingAccount: { select: accountSelect },
  taxClearingAccount: { select: accountSelect },
} as const;

type TaxClient = typeof db | Prisma.TransactionClient;

async function assertMappingAccounts(
  client: TaxClient,
  companyId: string,
  input: Partial<Record<ConfigAccountField, string | null | undefined>>,
): Promise<void> {
  for (const field of CONFIG_ACCOUNT_FIELDS) {
    const accountId = input[field];
    if (accountId === undefined || accountId === null) continue;
    const purpose = PURPOSE_BY_CONFIG_FIELD[field];
    const account = await client.chartOfAccount.findUnique({
      where: { companyId_id: { companyId, id: accountId } },
      select: accountSelect,
    });
    if (!account) {
      throw new TaxPostingError('invalid_tax_account', `The ${purpose} mapping does not reference an account in this company.`);
    }
    if (!account.active) {
      throw new TaxPostingError('invalid_tax_account', `Account ${account.code} is inactive and cannot be used as the ${purpose} mapping.`);
    }
    if (!(TAX_ACCOUNT_ALLOWED_TYPES[purpose] as readonly string[]).includes(account.type)) {
      throw new TaxPostingError(
        'invalid_tax_account',
        `Account ${account.code} is a ${account.type} account; the ${purpose} mapping requires ${TAX_ACCOUNT_ALLOWED_TYPES[purpose].join(' or ')}.`,
      );
    }
  }
}

function serializeAccount(account: { id: string; code: string; name: string; type: string; active: boolean } | null) {
  return account ? { id: account.id, code: account.code, name: account.name, type: account.type, active: account.active } : null;
}

function serializeRegistration(r: {
  id: string; regime: string; registrationNumber: string; province: string | null; method: string;
  filingFrequency: string; validFrom: Date; validTo: Date | null; active: boolean;
  reviewedById: string | null; reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: r.id,
    regime: r.regime,
    registrationNumber: r.registrationNumber,
    province: r.province,
    method: r.method,
    filingFrequency: r.filingFrequency,
    validFrom: r.validFrom.toISOString().slice(0, 10),
    validTo: r.validTo ? r.validTo.toISOString().slice(0, 10) : null,
    active: r.active,
    reviewed: Boolean(r.reviewedById && r.reviewedAt),
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface TaxSetupView {
  canManage: boolean;
  company: {
    id: string; name: string; province: string | null; businessNumber: string | null;
    gstNumber: string | null; fiscalYearStart: string; currency: string;
  };
  accounts: Array<{ id: string; code: string; name: string; type: string; active: boolean }>;
  configuration: null | {
    id: string;
    enabled: boolean;
    defaultPriceMode: string;
    requireJurisdictionEvidence: boolean;
    configuredById: string | null;
    configuredAt: string | null;
    mappings: Record<TaxAccountPurpose, ReturnType<typeof serializeAccount>>;
  };
  registrations: ReturnType<typeof serializeRegistration>[];
  /** Readiness to post through the reviewed engine (config.ts assessor). */
  reviewedPostingReadiness: TaxReadinessResult;
  /** Readiness to build a Tax Workpaper (mirrors workpaper-service blockers). */
  workpaperReadiness: TaxWorkpaperReadiness;
}

async function resolveRole(companyId: string, userId: string | null, role: string | null): Promise<string | null> {
  if (role) return role;
  if (!userId) return null;
  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

export async function loadTaxSetup(companyId: string, userId: string | null, role: string | null = null): Promise<TaxSetupView> {
  role = await resolveRole(companyId, userId, role);
  const [company, accounts, configuration, registrations, approvedCount] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, province: true, businessNumber: true, gstNumber: true, fiscalYearStart: true, currency: true },
    }),
    db.chartOfAccount.findMany({
      where: { companyId },
      select: accountSelect,
      orderBy: { code: 'asc' },
    }),
    db.companyTaxConfiguration.findUnique({ where: { companyId }, include: configInclude }),
    db.companyTaxRegistration.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
    db.taxCodeVersion.count({
      where: { reviewStatus: 'approved', taxCode: { companyId, active: true }, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
    }),
  ]);
  if (!company) throw new TaxPostingError('company_not_found', 'Company not found.', 404);

  const mappings: Partial<Record<TaxAccountPurpose, { id: string; companyId: string; active: boolean; type: import('./config').MappedAccountType } | null>> = {};
  const serializedMappings = {} as Record<TaxAccountPurpose, ReturnType<typeof serializeAccount>>;
  for (const field of CONFIG_ACCOUNT_FIELDS) {
    const purpose = PURPOSE_BY_CONFIG_FIELD[field];
    // Relation name is the config field name minus its trailing "Id"
    // (gstHstOutputAccountId -> gstHstOutputAccount, taxRoundingAccountId -> taxRoundingAccount).
    const relation = field.slice(0, -2);
    const account = configuration ? (configuration as unknown as Record<string, unknown>)[relation] as
      { id: string; code: string; name: string; type: string; active: boolean; companyId: string } | null : null;
    mappings[purpose] = account as (typeof mappings)[TaxAccountPurpose];
    serializedMappings[purpose] = serializeAccount(account);
  }

  const reviewedPostingReadiness = assessCompanyTaxReadiness({
    companyId,
    province: company.province,
    requireJurisdictionEvidence: configuration?.requireJurisdictionEvidence ?? true,
    configuredById: configuration?.configuredById ?? null,
    configuredAt: configuration?.configuredAt ?? null,
    registrations: registrations.map((r) => ({
      regime: r.regime, active: r.active, method: 'regular' as const, reviewed: Boolean(r.reviewedById && r.reviewedAt),
    })),
    approvedTaxCodeVersionCount: approvedCount,
    mappings,
  });

  const workpaperReadiness = assessTaxWorkpaperReadiness({
    configurationExists: Boolean(configuration),
    enabled: configuration?.enabled ?? false,
    mappedPurposes: (Object.keys(serializedMappings) as TaxAccountPurpose[]).filter((p) => serializedMappings[p] !== null),
    registrations: registrations.map((r) => ({
      regime: r.regime, active: r.active, reviewed: Boolean(r.reviewedById && r.reviewedAt),
    })),
  });

  return {
    canManage: Boolean(role && (SETUP_ROLES as readonly string[]).includes(role)),
    company: {
      id: company.id,
      name: company.name,
      province: company.province,
      businessNumber: company.businessNumber,
      gstNumber: company.gstNumber,
      fiscalYearStart: company.fiscalYearStart.toISOString().slice(0, 10),
      currency: company.currency,
    },
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, active: a.active })),
    configuration: configuration
      ? {
          id: configuration.id,
          enabled: configuration.enabled,
          defaultPriceMode: configuration.defaultPriceMode,
          requireJurisdictionEvidence: configuration.requireJurisdictionEvidence,
          configuredById: configuration.configuredById,
          configuredAt: configuration.configuredAt?.toISOString() ?? null,
          mappings: serializedMappings,
        }
      : null,
    registrations: registrations.map(serializeRegistration),
    reviewedPostingReadiness,
    workpaperReadiness,
  };
}

/** Compact setup summary for the Tax Workpapers page empty states. */
export async function loadTaxSetupSummary(companyId: string) {
  const view = await loadTaxSetup(companyId, null, null);
  return {
    configurationExists: Boolean(view.configuration),
    enabled: view.configuration?.enabled ?? false,
    activeRegistrationCount: view.registrations.filter((r) => r.active).length,
    registrationCount: view.registrations.length,
    workpaperReady: view.workpaperReadiness.ready,
    workpaperIssues: view.workpaperReadiness.issues,
  };
}

export async function saveTaxConfiguration(input: {
  companyId: string;
  userId: string;
  role: string | null;
  data: TaxConfigurationInput;
}) {
  const role = await resolveRole(input.companyId, input.userId, input.role);
  assertSetupRole(role);
  const { companyId, userId, data } = input;
  const mappingInput: Partial<Record<ConfigAccountField, string | null>> = {};
  for (const field of CONFIG_ACCOUNT_FIELDS) mappingInput[field] = data[field] ?? null;

  return db.$transaction(async (tx) => {
    await assertMappingAccounts(tx, companyId, mappingInput);
    const existing = await tx.companyTaxConfiguration.findUnique({
      where: { companyId },
      select: { id: true, configuredById: true, configuredAt: true },
    });
    const requireJurisdictionEvidence = data.requireJurisdictionEvidence ?? true;
    // Database invariant (CompanyTaxConfiguration_enabled_reviewed_check):
    // enabled ⇒ requireJurisdictionEvidence AND a review stamp AND a mapped
    // tax rounding account. Enforce here with named errors instead of
    // surfacing a raw check-constraint 500.
    let reviewStamp: { configuredById: string | null; configuredAt: Date | null };
    if (data.enabled) {
      if (requireJurisdictionEvidence !== true) {
        throw new TaxPostingError('tax_configuration_not_ready', 'The tax workflow can only be enabled while jurisdiction evidence is required.');
      }
      if (!mappingInput.taxRoundingAccountId) {
        throw new TaxPostingError('tax_configuration_not_ready', 'Map a tax rounding account (an expense account) before enabling the tax workflow.');
      }
      if (data.reviewed) {
        reviewStamp = { configuredById: userId, configuredAt: new Date() };
      } else if (existing?.configuredById && existing?.configuredAt) {
        reviewStamp = { configuredById: existing.configuredById, configuredAt: existing.configuredAt };
      } else {
        throw new TaxPostingError('tax_configuration_not_ready', 'Tick "I reviewed these mappings" to enable the tax workflow — an enabled configuration must carry a review stamp.');
      }
    } else {
      reviewStamp = data.reviewed
        ? { configuredById: userId, configuredAt: new Date() }
        : { configuredById: null, configuredAt: null };
    }
    const values = {
      enabled: data.enabled,
      defaultPriceMode: data.defaultPriceMode ?? 'exclusive',
      requireJurisdictionEvidence,
      ...mappingInput,
      ...reviewStamp,
    };
    const saved = existing
      ? await tx.companyTaxConfiguration.update({ where: { companyId }, data: values })
      : await tx.companyTaxConfiguration.create({ data: { companyId, ...values } });
    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: existing ? 'tax.setup.configuration.update' : 'tax.setup.configuration.create',
        entityType: 'company_tax_configuration',
        entityId: saved.id,
        changes: { enabled: saved.enabled, reviewed: Boolean(data.reviewed) } as Prisma.InputJsonValue,
      },
    });
    return saved.id;
  });
}

function dateOnlyToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function createTaxRegistration(input: {
  companyId: string;
  userId: string;
  role: string | null;
  data: TaxRegistrationCreateInput;
}) {
  const role = await resolveRole(input.companyId, input.userId, input.role);
  assertSetupRole(role);
  const { companyId, userId, data } = input;
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.companyTaxRegistration.create({
        data: {
          companyId,
          regime: data.regime,
          registrationNumber: data.registrationNumber,
          province: data.province ?? null,
          method: 'regular',
          filingFrequency: data.filingFrequency,
          validFrom: dateOnlyToUtc(data.validFrom),
          validTo: data.validTo ? dateOnlyToUtc(data.validTo) : null,
          active: data.active ?? true,
          reviewedById: data.reviewed ? userId : null,
          reviewedAt: data.reviewed ? new Date() : null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId, userId, action: 'tax.setup.registration.create', entityType: 'company_tax_registration',
          entityId: created.id, changes: { regime: created.regime, reviewed: Boolean(data.reviewed) } as Prisma.InputJsonValue,
        },
      });
      return serializeRegistration(created);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new TaxPostingError('duplicate_registration', 'A registration with this regime, number and start date already exists.', 409);
    }
    throw error;
  }
}

export async function updateTaxRegistration(input: {
  companyId: string;
  userId: string;
  role: string | null;
  registrationId: string;
  data: TaxRegistrationUpdateInput;
}) {
  const role = await resolveRole(input.companyId, input.userId, input.role);
  assertSetupRole(role);
  const { companyId, userId, registrationId, data } = input;
  try {
    return await db.$transaction(async (tx) => {
      // CompanyTaxRegistration has no @@unique([companyId, id]) in the
      // schema, so a scoped findFirst is the company-safe lookup (the
      // workpaper service does the same).
      const existing = await tx.companyTaxRegistration.findFirst({
        where: { id: registrationId, companyId },
      });
      if (!existing) throw new TaxPostingError('registration_not_found', 'Tax registration not found.', 404);

      const before = {
        regime: existing.regime,
        registrationNumber: existing.registrationNumber,
        province: existing.province,
        method: existing.method,
        filingFrequency: existing.filingFrequency,
        validFrom: existing.validFrom.toISOString().slice(0, 10),
        validTo: existing.validTo ? existing.validTo.toISOString().slice(0, 10) : null,
        active: existing.active,
      };
      const patch: Record<string, unknown> = { ...data };
      delete patch.reviewed;
      const values: Prisma.CompanyTaxRegistrationUncheckedUpdateInput = {};
      if (patch.regime !== undefined) values.regime = patch.regime as never;
      if (patch.registrationNumber !== undefined) values.registrationNumber = patch.registrationNumber as string;
      if ('province' in patch) values.province = ((patch.province as string | null) ?? null) as never;
      if (patch.method !== undefined) values.method = 'regular';
      if (patch.filingFrequency !== undefined) values.filingFrequency = patch.filingFrequency as never;
      if (patch.validFrom !== undefined) values.validFrom = dateOnlyToUtc(patch.validFrom as string);
      if ('validTo' in patch) values.validTo = patch.validTo ? dateOnlyToUtc(patch.validTo as string) : null;
      if (patch.active !== undefined) values.active = patch.active as boolean;

      // Cross-field date check against the merged record.
      const mergedFrom = values.validFrom instanceof Date ? values.validFrom : existing.validFrom;
      const mergedTo = 'validTo' in patch ? (values.validTo as Date | null) : existing.validTo;
      if (mergedTo && mergedTo <= mergedFrom) {
        throw new TaxPostingError('invalid_registration_dates', 'Valid-to date must be after the valid-from date.');
      }
      // Same cross-field province/regime check as the create schema.
      const mergedRegime = (values.regime as string | undefined) ?? existing.regime;
      const mergedProvince = 'province' in patch ? ((patch.province as string | null) ?? null) : existing.province;
      if (mergedRegime !== 'gst_hst' && !mergedProvince) {
        throw new TaxPostingError('invalid_registration_province', 'A province is required for QST, PST and RST registrations.');
      }
      if (mergedRegime === 'qst' && mergedProvince && mergedProvince !== 'QC') {
        throw new TaxPostingError('invalid_registration_province', 'QST registrations are for Quebec.');
      }

      if (data.reviewed) {
        values.reviewedById = userId;
        values.reviewedAt = new Date();
      } else if (registrationEditNeedsReReview(before, {
        ...patch,
        validFrom: patch.validFrom ?? before.validFrom,
        validTo: 'validTo' in patch ? patch.validTo : before.validTo,
      })) {
        // A substantive edit invalidates the earlier review.
        values.reviewedById = null;
        values.reviewedAt = null;
      }

      const updated = await tx.companyTaxRegistration.update({
        where: { id: registrationId },
        data: values,
      });
      await tx.auditLog.create({
        data: {
          companyId, userId,
          action: data.reviewed && Object.keys(patch).length === 0 ? 'tax.setup.registration.review' : 'tax.setup.registration.update',
          entityType: 'company_tax_registration', entityId: updated.id,
          changes: { reviewed: Boolean(data.reviewed) } as Prisma.InputJsonValue,
        },
      });
      return serializeRegistration(updated);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new TaxPostingError('duplicate_registration', 'A registration with this regime, number and start date already exists.', 409);
    }
    throw error;
  }
}
