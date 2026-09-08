import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { assessCompanyTaxReadiness, type TaxReadinessIssue } from '@/lib/tax/config';
import { buildTaxPostingPlan, type PostingComponentDecision, type TaxPostingPlan } from '@/lib/tax/posting-plan';
import { TaxPostingError, type RecoveryDecision } from '@/lib/tax/posting-service';
import type { TaxKind } from '@/lib/tax/engine';

export interface TaxUiCode {
  id: string;
  code: string;
  name: string;
  treatment: string;
  jurisdiction: string;
  priceMode: 'exclusive' | 'inclusive';
  label: string;
  components: Array<{
    kind: TaxKind;
    authority: string;
    treatment: string;
    rate: string;
    recoveryAllowed: boolean;
  }>;
}

export interface TaxUiContext {
  enabled: boolean;
  ready: boolean;
  homeCurrency: string;
  province: string | null;
  issues: TaxReadinessIssue[];
  codes: TaxUiCode[];
  reviewers: Array<{ id: string; name: string; role: string }>;
}

export interface TaxDraftLine {
  clientLineId: string;
  categoryId: string | null;
  amount: number | string;
  taxCodeVersionId: string;
  jurisdictionEvidence: Record<string, unknown>;
  jurisdictionOverrideReason?: string;
  recovery?: Partial<Record<string, RecoveryDecision>>;
}

export interface PreviewTaxDraftInput {
  companyId: string;
  userId: string;
  direction: 'sale' | 'purchase';
  documentDate: Date;
  documentCurrency: string;
  fxRate?: string | null;
  lines: readonly TaxDraftLine[];
}

function cents(value: number | string): number {
  const scaled = new Prisma.Decimal(value).mul(100);
  if (!scaled.isInteger() || scaled.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new TaxPostingError('invalid_amount', 'Line amounts must fit exact cents.');
  }
  return scaled.toNumber();
}

function contextMappings(configuration: any) {
  return {
    gstHstOutput: configuration.gstHstOutputAccount,
    gstHstRecoverable: configuration.gstHstRecoverableAccount,
    qstOutput: configuration.qstOutputAccount,
    qstRecoverable: configuration.qstRecoverableAccount,
    pstRstPayable: configuration.pstRstPayableAccount,
    rounding: configuration.taxRoundingAccount,
    clearing: configuration.taxClearingAccount,
  };
}

async function loadConfiguration(companyId: string, date: Date) {
  const configuration = await db.companyTaxConfiguration.findUnique({
    where: { companyId },
    include: {
      company: { select: { province: true, currency: true } },
      gstHstOutputAccount: true,
      gstHstRecoverableAccount: true,
      qstOutputAccount: true,
      qstRecoverableAccount: true,
      pstRstPayableAccount: true,
      taxRoundingAccount: true,
      taxClearingAccount: true,
    },
  });
  const [registrations, versions, reviewers] = await Promise.all([
    db.companyTaxRegistration.findMany({
      where: {
        companyId,
        active: true,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gt: date } }],
      },
    }),
    db.taxCodeVersion.findMany({
      where: {
        taxCode: { companyId, active: true },
        reviewStatus: 'approved',
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
      },
      include: { taxCode: true, components: true },
      orderBy: [{ taxCode: { code: 'asc' } }, { version: 'desc' }],
    }),
    db.membership.findMany({
      where: { companyId, role: { in: ['owner', 'admin'] } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return { configuration, registrations, versions, reviewers };
}

export async function getTaxUiContext(companyId: string, date: Date): Promise<TaxUiContext> {
  const { configuration, registrations, versions, reviewers } = await loadConfiguration(companyId, date);
  if (!configuration) {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { province: true, currency: true } });
    return { enabled: false, ready: false, homeCurrency: company?.currency ?? 'CAD', province: company?.province ?? null, issues: [], codes: [], reviewers: [] };
  }
  const assessment = assessCompanyTaxReadiness({
    companyId,
    province: configuration.company.province,
    requireJurisdictionEvidence: configuration.requireJurisdictionEvidence,
    configuredById: configuration.configuredById,
    configuredAt: configuration.configuredAt,
    registrations: registrations.map(registration => ({
      regime: registration.regime,
      active: registration.active,
      method: registration.method,
      reviewed: Boolean(registration.reviewedById && registration.reviewedAt),
    })),
    approvedTaxCodeVersionCount: versions.length,
    mappings: contextMappings(configuration),
  });
  return {
    enabled: configuration.enabled,
    ready: configuration.enabled && assessment.ready,
    homeCurrency: configuration.company.currency,
    province: configuration.company.province,
    issues: assessment.issues,
    codes: versions.map(version => ({
      id: version.id,
      code: version.taxCode.code,
      name: version.taxCode.name,
      treatment: version.treatment,
      jurisdiction: version.jurisdiction,
      priceMode: version.priceMode,
      label: `${version.taxCode.code} — ${version.taxCode.name}`,
      components: version.components.map(component => ({
        kind: component.type.toUpperCase() as TaxKind,
        authority: component.authority,
        treatment: component.treatment,
        rate: component.rate.toString(),
        recoveryAllowed: component.recoveryAllowed,
      })),
    })),
    reviewers: reviewers.map(membership => ({
      id: membership.user.id,
      name: membership.user.name || membership.user.email,
      role: membership.role,
    })),
  };
}

export async function previewTaxDraft(input: PreviewTaxDraftInput): Promise<TaxPostingPlan> {
  if (!input.lines.length) throw new TaxPostingError('line_selection_mismatch', 'At least one tax line is required.');
  const context = await getTaxUiContext(input.companyId, input.documentDate);
  if (!context.enabled) throw new TaxPostingError('tax_feature_disabled', 'The reviewed tax workflow is not enabled for this company.', 409);
  if (!context.ready) throw new TaxPostingError('tax_configuration_not_ready', context.issues.map(issue => issue.message).join(' '), 409);

  const membership = await db.membership.findUnique({ where: { userId_companyId: { userId: input.userId, companyId: input.companyId } } });
  if (!membership || !['owner', 'admin', 'bookkeeper'].includes(membership.role)) {
    throw new TaxPostingError('insufficient_permissions', 'Owner, admin, or bookkeeper access is required.', 403);
  }

  const configuration = await db.companyTaxConfiguration.findUnique({
    where: { companyId: input.companyId },
    include: {
      gstHstOutputAccount: true,
      gstHstRecoverableAccount: true,
      qstOutputAccount: true,
      qstRecoverableAccount: true,
      pstRstPayableAccount: true,
    },
  });
  if (!configuration) throw new TaxPostingError('tax_configuration_not_ready', 'Tax configuration is missing.', 409);

  const versionIds = [...new Set(input.lines.map(line => line.taxCodeVersionId))];
  const categoryIds = [...new Set(input.lines.map(line => line.categoryId).filter((id): id is string => Boolean(id)))];
  const reviewerIds = [...new Set(input.lines.flatMap(line => Object.values(line.recovery ?? {}).map(value => value?.reviewedById).filter((id): id is string => Boolean(id))))];
  const [versions, categories, reviewerMemberships] = await Promise.all([
    db.taxCodeVersion.findMany({ where: { id: { in: versionIds } }, include: { taxCode: true, components: true } }),
    db.chartOfAccount.findMany({ where: { id: { in: categoryIds }, companyId: input.companyId, active: true } }),
    reviewerIds.length ? db.membership.findMany({ where: { companyId: input.companyId, userId: { in: reviewerIds }, role: { in: ['owner', 'admin'] } } }) : [],
  ]);
  const byVersion = new Map(versions.map(version => [version.id, version]));
  const byCategory = new Map(categories.map(category => [category.id, category]));
  const authorizedReviewers = new Set(reviewerMemberships.map(item => item.userId));

  return buildTaxPostingPlan({
    direction: input.direction,
    documentCurrency: input.documentCurrency,
    homeCurrency: context.homeCurrency,
    fxRate: input.documentCurrency === context.homeCurrency ? null : input.fxRate,
    mappings: {
      control: input.direction === 'sale' ? '1100' : '2200',
      gstHstOutput: configuration.gstHstOutputAccount?.code,
      gstHstRecoverable: configuration.gstHstRecoverableAccount?.code,
      qstOutput: configuration.qstOutputAccount?.code,
      qstRecoverable: configuration.qstRecoverableAccount?.code,
      pstRstPayable: configuration.pstRstPayableAccount?.code,
    },
    lines: input.lines.map(line => {
      const category = line.categoryId ? byCategory.get(line.categoryId) : null;
      if (!category) throw new TaxPostingError('invalid_document_line', 'Each line requires an active same-company GL category.');
      const version = byVersion.get(line.taxCodeVersionId);
      if (!version || version.taxCode.companyId !== input.companyId || !version.taxCode.active || version.reviewStatus !== 'approved') {
        throw new TaxPostingError('tax_code_not_approved', 'Each line requires an approved same-company tax code.');
      }
      if (version.effectiveFrom > input.documentDate || (version.effectiveTo && version.effectiveTo <= input.documentDate)) {
        throw new TaxPostingError('tax_code_not_effective', 'A selected tax code is not effective on the document date.');
      }
      if (!line.jurisdictionEvidence || Object.keys(line.jurisdictionEvidence).length === 0) {
        throw new TaxPostingError('jurisdiction_evidence_required', 'Each line requires jurisdiction evidence.');
      }
      if (version.components.some(component => component.treatment === 'legacy_unclassified')) {
        throw new TaxPostingError('tax_component_unclassified', 'Legacy-unclassified tax components cannot be used in the reviewed workflow.');
      }
      const components: PostingComponentDecision[] = version.components.map(component => {
        const kind = component.type.toUpperCase() as TaxKind;
        const recovery = line.recovery?.[kind];
        if (input.direction === 'purchase' && component.recoveryAllowed) {
          if (!recovery || !recovery.reason.trim() || !recovery.evidence || !Object.keys(recovery.evidence).length || !authorizedReviewers.has(recovery.reviewedById) || recovery.reviewedById !== input.userId) {
            throw new TaxPostingError('recovery_decision_required', `${kind} requires a recovery percentage, reason, evidence, and owner/admin reviewer.`);
          }
        } else if (recovery?.basisPoints) {
          throw new TaxPostingError('recovery_not_allowed', `${kind} recovery is not allowed for this line.`);
        }
        return {
          kind,
          authority: component.authority,
          treatment: component.treatment as PostingComponentDecision['treatment'],
          rateMilliPercent: component.rate.mul(1000).toNumber(),
          recoveryBasisPoints: recovery?.basisPoints ?? 0,
          recoveryReason: recovery?.reason,
          recoveryEvidence: recovery?.evidence,
          recoveryReviewedById: recovery?.reviewedById,
        };
      });
      return {
        sourceLineId: line.clientLineId,
        taxCodeVersionId: version.id,
        categoryAccountCode: category.code,
        amountMinor: cents(line.amount),
        priceMode: version.priceMode,
        components,
      };
    }),
  });
}
