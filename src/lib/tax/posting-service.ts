import { Prisma, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { postJournalEntry } from '@/lib/journal';
import { assessCompanyTaxReadiness } from '@/lib/tax/config';
import {
  buildTaxPostingPlan,
  PostingComponentDecision,
  PostingDirection,
  TaxPostingPlan,
} from '@/lib/tax/posting-plan';
import type { TaxKind } from '@/lib/tax/engine';

const MUTATION_ROLES: readonly UserRole[] = ['owner', 'admin', 'bookkeeper'];

export class TaxPostingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'TaxPostingError';
  }
}

export function assertTaxMutationRole(role: UserRole | null | undefined): void {
  if (!role || !MUTATION_ROLES.includes(role)) {
    throw new TaxPostingError('insufficient_permissions', 'Owner, admin, or bookkeeper access is required.', 403);
  }
}

export function assertOpenTaxPeriod(closedPeriod: { periodStart: Date; periodEnd: Date } | null): void {
  if (closedPeriod) {
    throw new TaxPostingError(
      'closed_period',
      `Tax posting is blocked for the closed period ${closedPeriod.periodStart.toISOString().slice(0, 10)} to ${closedPeriod.periodEnd.toISOString().slice(0, 10)}.`,
      409,
    );
  }
}

export interface RecoveryDecision {
  basisPoints: number;
  reason: string;
  evidence: Record<string, unknown>;
  reviewedById: string;
}

export interface TaxLineSelection {
  sourceLineId: string;
  taxCodeVersionId: string;
  jurisdictionEvidence: Record<string, unknown>;
  jurisdictionOverrideReason?: string;
  recovery?: Partial<Record<TaxKind, RecoveryDecision>>;
}

export interface PostTaxDocumentCommand {
  companyId: string;
  userId: string;
  sourceKey: string;
  sourceType: 'invoice' | 'bill';
  sourceId: string;
  description: string;
  lines: readonly TaxLineSelection[];
  expectedTotals?: { netMinor: number; taxMinor: number; grossMinor: number; grossHomeMinor: number };
}

export interface ReverseTaxPostingCommand {
  companyId: string;
  userId: string;
  postingId: string;
  sourceKey: string;
  reversalDate: Date;
  reason: string;
}

type TransactionClient = Prisma.TransactionClient;

const cents = (value: Prisma.Decimal | number | string): number => {
  const decimal = new Prisma.Decimal(value);
  const scaled = decimal.mul(100);
  if (!scaled.isInteger() || scaled.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new TaxPostingError('invalid_amount', 'Document amounts must fit exact cents.');
  }
  return scaled.toNumber();
};

const amount = (minor: number): Prisma.Decimal => new Prisma.Decimal(minor).div(100);
const taxKind = (kind: string): TaxKind => kind.toUpperCase() as TaxKind;

function validateSourceKey(sourceKey: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{7,199}$/.test(sourceKey)) {
    throw new TaxPostingError('invalid_source_key', 'A stable idempotency key between 8 and 200 characters is required.');
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function assertSameRequest(existing: { requestHash: string }, requestHash: string): void {
  if (existing.requestHash !== requestHash) {
    throw new TaxPostingError('idempotency_key_reused', 'This idempotency key was already used for a different tax posting request.', 409);
  }
}

function evidenceObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  if (!value || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new TaxPostingError('jurisdiction_evidence_required', 'Each line requires jurisdiction evidence.');
  }
  return value as Prisma.InputJsonObject;
}

async function authorize(tx: TransactionClient, companyId: string, userId: string): Promise<void> {
  const membership = await tx.membership.findUnique({ where: { userId_companyId: { userId, companyId } } });
  assertTaxMutationRole(membership?.role);
}

async function assertPeriodOpen(tx: TransactionClient, companyId: string, date: Date): Promise<void> {
  const closedPeriod = await tx.periodClose.findFirst({
    where: { companyId, status: 'closed', periodStart: { lte: date }, periodEnd: { gte: date } },
    select: { periodStart: true, periodEnd: true },
  });
  assertOpenTaxPeriod(closedPeriod);
}

const postingInclude = {
  journalEntry: { include: { lines: true } },
  snapshots: { include: { components: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.TaxPostingInclude;

async function readiness(tx: TransactionClient, companyId: string, date: Date) {
  const configuration = await tx.companyTaxConfiguration.findUnique({
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
  if (!configuration?.enabled) {
    throw new TaxPostingError('tax_feature_disabled', 'The reviewed P1 tax posting path is not enabled for this company.', 409);
  }
  const [registrations, approvedTaxCodeVersionCount] = await Promise.all([
    tx.companyTaxRegistration.findMany({
      where: {
        companyId,
        active: true,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gt: date } }],
      },
    }),
    tx.taxCodeVersion.count({
      where: {
        taxCode: { companyId, active: true },
        reviewStatus: 'approved',
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
      },
    }),
  ]);
  const result = assessCompanyTaxReadiness({
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
    approvedTaxCodeVersionCount,
    mappings: {
      gstHstOutput: configuration.gstHstOutputAccount,
      gstHstRecoverable: configuration.gstHstRecoverableAccount,
      qstOutput: configuration.qstOutputAccount,
      qstRecoverable: configuration.qstRecoverableAccount,
      pstRstPayable: configuration.pstRstPayableAccount,
      rounding: configuration.taxRoundingAccount,
      clearing: configuration.taxClearingAccount,
    },
  });
  if (!result.ready) {
    throw new TaxPostingError('tax_configuration_not_ready', result.issues.map(issue => issue.message).join(' '), 409);
  }
  return configuration;
}

async function sourceDocument(tx: TransactionClient, command: PostTaxDocumentCommand) {
  if (command.sourceType === 'invoice') {
    const invoice = await tx.invoice.findUnique({
      where: { id: command.sourceId, companyId: command.companyId },
      include: { lineItems: { include: { category: true } } },
    });
    if (!invoice) throw new TaxPostingError('document_not_found', 'Invoice not found.', 404);
    if (invoice.status === 'void') throw new TaxPostingError('document_void', 'A void invoice cannot be posted.', 409);
    return {
      direction: 'sale' as const,
      date: invoice.issueDate,
      currency: invoice.currency,
      fxRate: invoice.fxRate?.toString() ?? null,
      fxRateSource: invoice.fxRateSource,
      fxRateDate: invoice.fxRateDate,
      controlAccountCode: '1100',
      lines: invoice.lineItems,
    };
  }
  const bill = await tx.bill.findUnique({
    where: { id: command.sourceId, companyId: command.companyId },
    include: { lineItems: { include: { category: true } } },
  });
  if (!bill) throw new TaxPostingError('document_not_found', 'Bill not found.', 404);
  if (bill.status === 'void') throw new TaxPostingError('document_void', 'A void bill cannot be posted.', 409);
  return {
    direction: 'purchase' as const,
    date: bill.billDate,
    currency: bill.currency,
    fxRate: bill.fxRate?.toString() ?? null,
    fxRateSource: bill.fxRateSource,
    fxRateDate: bill.fxRateDate,
    controlAccountCode: '2200',
    lines: bill.lineItems,
  };
}

async function buildPlan(
  tx: TransactionClient,
  command: PostTaxDocumentCommand,
  document: Awaited<ReturnType<typeof sourceDocument>>,
  configuration: Awaited<ReturnType<typeof readiness>>,
): Promise<TaxPostingPlan> {
  const selections = new Map(command.lines.map(line => [line.sourceLineId, line]));
  if (selections.size !== command.lines.length || selections.size !== document.lines.length) {
    throw new TaxPostingError('line_selection_mismatch', 'Every document line must have exactly one server-verified tax selection.');
  }
  const versionIds = [...new Set(command.lines.map(line => line.taxCodeVersionId))];
  const versions = await tx.taxCodeVersion.findMany({
    where: { id: { in: versionIds } },
    include: { taxCode: true, components: true },
  });
  const byId = new Map(versions.map(version => [version.id, version]));
  const reviewerIds = [...new Set(command.lines.flatMap(line =>
    Object.values(line.recovery ?? {}).map(recovery => recovery?.reviewedById).filter((id): id is string => Boolean(id)),
  ))];
  const reviewerMemberships = reviewerIds.length ? await tx.membership.findMany({
    where: { companyId: command.companyId, userId: { in: reviewerIds }, role: { in: ['owner', 'admin'] } },
    select: { userId: true },
  }) : [];
  const authorizedReviewers = new Set(reviewerMemberships.map(membership => membership.userId));

  const lines = document.lines.map(line => {
    const selection = selections.get(line.id);
    if (!selection || !line.category || line.category.companyId !== command.companyId || !line.category.active) {
      throw new TaxPostingError('invalid_document_line', 'Each document line must use an active GL category from the same company.');
    }
    const version = byId.get(selection.taxCodeVersionId);
    if (!version || version.taxCode.companyId !== command.companyId || !version.taxCode.active || version.reviewStatus !== 'approved') {
      throw new TaxPostingError('tax_code_not_approved', 'Each line must use an approved active tax-code version from the same company.');
    }
    if (version.effectiveFrom > document.date || (version.effectiveTo && version.effectiveTo <= document.date)) {
      throw new TaxPostingError('tax_code_not_effective', 'A selected tax-code version is not effective on the document tax point.');
    }
    evidenceObject(selection.jurisdictionEvidence);
    const components: PostingComponentDecision[] = version.components.map(component => {
      const kind = taxKind(component.type);
      const recovery = selection.recovery?.[kind];
      if (component.treatment === 'legacy_unclassified') {
        throw new TaxPostingError('tax_component_unclassified', `${kind} requires an explicit reviewed treatment.`);
      }
      if (document.direction === 'purchase' && component.recoveryAllowed) {
        if (!recovery || !Number.isSafeInteger(recovery.basisPoints) || recovery.basisPoints < 0 || recovery.basisPoints > 10_000 ||
          !recovery.reason.trim() || !recovery.evidence || Object.keys(recovery.evidence).length === 0 || !authorizedReviewers.has(recovery.reviewedById) || recovery.reviewedById !== command.userId) {
          throw new TaxPostingError('recovery_decision_required', `An explicit recovery fraction, evidence, reason, and owner/admin review are required for ${kind}.`);
        }
      } else if (recovery?.basisPoints) {
        throw new TaxPostingError('recovery_not_allowed', `${kind} recovery is not allowed for this line.`);
      }
      return {
        kind,
        authority: component.authority,
        treatment: component.treatment,
        rateMilliPercent: new Prisma.Decimal(component.rate).mul(1000).toNumber(),
        recoveryBasisPoints: recovery?.basisPoints ?? 0,
        recoveryReason: recovery?.reason,
        recoveryEvidence: recovery?.evidence,
        recoveryReviewedById: recovery?.reviewedById,
      };
    });
    return {
      sourceLineId: line.id,
      taxCodeVersionId: version.id,
      categoryAccountCode: line.category.code,
      amountMinor: cents(line.amount),
      priceMode: version.priceMode,
      components,
    };
  });

  const accountCode = (account: { code: string } | null) => account?.code;
  return buildTaxPostingPlan({
    direction: document.direction,
    documentCurrency: document.currency,
    homeCurrency: configuration.company.currency,
    fxRate: document.fxRate,
    mappings: {
      control: document.controlAccountCode,
      gstHstOutput: accountCode(configuration.gstHstOutputAccount),
      gstHstRecoverable: accountCode(configuration.gstHstRecoverableAccount),
      qstOutput: accountCode(configuration.qstOutputAccount),
      qstRecoverable: accountCode(configuration.qstRecoverableAccount),
      pstRstPayable: accountCode(configuration.pstRstPayableAccount),
    },
    lines,
  });
}

function journalLines(plan: TaxPostingPlan) {
  return plan.journalLines.map(line => ({
    glAccountCode: line.glAccountCode,
    description: line.description,
    debit: amount(line.debitMinor).toNumber(),
    credit: amount(line.creditMinor).toNumber(),
    currency: line.currency,
    fxRate: line.fxRate ? Number(line.fxRate) : undefined,
    debitForeign: line.debitForeignMinor === undefined ? undefined : amount(line.debitForeignMinor).toNumber(),
    creditForeign: line.creditForeignMinor === undefined ? undefined : amount(line.creditForeignMinor).toNumber(),
  }));
}

export async function postTaxDocument(command: PostTaxDocumentCommand, transaction?: TransactionClient) {
  validateSourceKey(command.sourceKey);
  const requestHash = fingerprint(command);
  try {
    const execute = async (tx: TransactionClient) => {
      await authorize(tx, command.companyId, command.userId);
      const replay = await tx.taxPosting.findUnique({
        where: { companyId_sourceKey: { companyId: command.companyId, sourceKey: command.sourceKey } },
        include: postingInclude,
      });
      if (replay) {
        assertSameRequest(replay, requestHash);
        return replay;
      }

      const document = await sourceDocument(tx, command);
      await assertPeriodOpen(tx, command.companyId, document.date);
      const configuration = await readiness(tx, command.companyId, document.date);
      const plan = await buildPlan(tx, command, document, configuration);
      if (command.expectedTotals && Object.entries(command.expectedTotals).some(([key, value]) => plan[key as keyof typeof command.expectedTotals] !== value)) {
        throw new TaxPostingError('tax_preview_changed', 'Tax configuration changed after the preview. Refresh the preview and save again.', 409);
      }
      const journal = await postJournalEntry({
        entryDate: document.date,
        description: command.description,
        sourceType: command.sourceType,
        sourceId: command.sourceId,
        createdBy: command.userId,
        lines: journalLines(plan),
      }, command.companyId, tx);
      const posting = await tx.taxPosting.create({
        data: {
          companyId: command.companyId,
          sourceKey: command.sourceKey,
          requestHash,
          journalEntryId: journal.id,
          createdById: command.userId,
        },
      });
      for (const snapshot of plan.snapshots) {
        const selection = command.lines.find(line => line.sourceLineId === snapshot.sourceLineId)!;
        await tx.documentLineTaxSnapshot.create({
          data: {
            companyId: command.companyId,
            postingId: posting.id,
            taxCodeVersionId: snapshot.taxCodeVersionId,
            ...(command.sourceType === 'invoice' ? { invoiceLineItemId: snapshot.sourceLineId } : { billLineItemId: snapshot.sourceLineId }),
            direction: document.direction,
            treatment: snapshot.treatment,
            priceMode: snapshot.priceMode,
            taxPointDate: document.date,
            jurisdiction: (await tx.taxCodeVersion.findUniqueOrThrow({ where: { id: snapshot.taxCodeVersionId }, select: { jurisdiction: true } })).jurisdiction,
            jurisdictionEvidence: evidenceObject(selection.jurisdictionEvidence),
            jurisdictionOverrideReason: selection.jurisdictionOverrideReason,
            documentCurrency: document.currency,
            homeCurrency: configuration.company.currency,
            netAmount: amount(snapshot.netMinor),
            taxAmount: amount(snapshot.taxMinor),
            grossAmount: amount(snapshot.grossMinor),
            netHome: amount(snapshot.netHomeMinor),
            taxHome: amount(snapshot.taxHomeMinor),
            grossHome: amount(snapshot.grossHomeMinor),
            fxRate: document.fxRate ? new Prisma.Decimal(document.fxRate) : null,
            fxRateSource: document.fxRateSource,
            fxRateDate: document.fxRateDate,
            engineVersion: configuration.engineVersion,
            sourceKey: `${command.sourceKey}:${snapshot.sourceLineId}`,
            createdById: command.userId,
            components: {
              create: snapshot.components.map(component => ({
                type: component.kind.toLowerCase() as Lowercase<TaxKind>,
                authority: component.authority,
                treatment: component.treatment,
                rate: new Prisma.Decimal(component.rateMilliPercent).div(1000),
                taxAmount: amount(component.taxMinor),
                taxHome: amount(component.taxHomeMinor),
                outputTax: amount(component.outputTaxMinor),
                outputTaxHome: amount(component.outputTaxHomeMinor),
                recoverableTax: amount(component.recoverableMinor),
                recoverableTaxHome: amount(component.recoverableHomeMinor),
                nonrecoverableTax: amount(component.nonRecoverableMinor),
                nonrecoverableTaxHome: amount(component.nonRecoverableHomeMinor),
                recoveryBasisPoints: component.recoveryBasisPoints,
                recoveryReason: component.recoveryReason,
                recoveryEvidence: component.recoveryEvidence as Prisma.InputJsonObject | undefined,
                recoveryReviewedById: component.recoveryReviewedById,
                recoveryReviewedAt: component.recoveryReviewedById ? new Date() : undefined,
              })),
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          companyId: command.companyId,
          userId: command.userId,
          action: 'tax.post',
          entityType: 'TaxPosting',
          entityId: posting.id,
          metadata: { sourceKey: command.sourceKey, sourceType: command.sourceType, sourceId: command.sourceId },
        },
      });
      return tx.taxPosting.findUniqueOrThrow({ where: { id: posting.id }, include: postingInclude });
    };
    return transaction ? await execute(transaction) : await db.$transaction(execute);
  } catch (error) {
    if (transaction) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await db.taxPosting.findUnique({
        where: { companyId_sourceKey: { companyId: command.companyId, sourceKey: command.sourceKey } },
        include: postingInclude,
      });
      if (replay) {
        assertSameRequest(replay, requestHash);
        return replay;
      }
    }
    throw error;
  }
}

export async function reverseTaxPosting(command: ReverseTaxPostingCommand, transaction?: TransactionClient) {
  validateSourceKey(command.sourceKey);
  if (!command.reason.trim()) throw new TaxPostingError('reversal_reason_required', 'A reversal reason is required.');
  const requestHash = fingerprint({ ...command, reversalDate: command.reversalDate.toISOString() });
  try {
    const execute = async (tx: TransactionClient) => {
    await authorize(tx, command.companyId, command.userId);
    const replay = await tx.taxPosting.findUnique({
      where: { companyId_sourceKey: { companyId: command.companyId, sourceKey: command.sourceKey } },
      include: postingInclude,
    });
    if (replay) {
      assertSameRequest(replay, requestHash);
      return replay;
    }
    await assertPeriodOpen(tx, command.companyId, command.reversalDate);
    const original = await tx.taxPosting.findFirst({
      where: { id: command.postingId, companyId: command.companyId },
      include: {
        journalEntry: { include: { lines: true } },
        snapshots: { include: { components: true } },
        reversedBy: { select: { id: true } },
      },
    });
    if (!original) throw new TaxPostingError('posting_not_found', 'Tax posting not found.', 404);
    if (original.reversedBy) throw new TaxPostingError('posting_already_reversed', 'This tax posting has already been reversed.', 409);
    const journal = await postJournalEntry({
      entryDate: command.reversalDate,
      description: `Reversal: ${command.reason}`,
      sourceType: original.journalEntry.sourceType,
      sourceId: original.journalEntry.sourceId ?? undefined,
      createdBy: command.userId,
      lines: original.journalEntry.lines.map(line => ({
        glAccountCode: line.glAccountCode,
        description: line.description ?? undefined,
        debit: Number(line.credit),
        credit: Number(line.debit),
        currency: line.currency ?? undefined,
        fxRate: line.fxRate ? Number(line.fxRate) : undefined,
        debitForeign: line.creditForeign ? Number(line.creditForeign) : undefined,
        creditForeign: line.debitForeign ? Number(line.debitForeign) : undefined,
      })),
    }, command.companyId, tx);
    await tx.journalEntry.update({ where: { id: journal.id }, data: { reversalOfId: original.journalEntry.id } });
    await tx.journalEntry.update({
      where: { id: original.journalEntry.id },
      data: { voidedAt: new Date(), voidedBy: command.userId },
    });
    const posting = await tx.taxPosting.create({
      data: {
        companyId: command.companyId,
        sourceKey: command.sourceKey,
        requestHash,
        journalEntryId: journal.id,
        reversalOfId: original.id,
        createdById: command.userId,
      },
    });
    for (const source of original.snapshots) {
      await tx.documentLineTaxSnapshot.create({
        data: {
          companyId: command.companyId,
          postingId: posting.id,
          reversalOfId: source.id,
          taxCodeVersionId: source.taxCodeVersionId,
          direction: source.direction,
          treatment: source.treatment,
          priceMode: source.priceMode,
          taxPointDate: command.reversalDate,
          jurisdiction: source.jurisdiction,
          jurisdictionEvidence: { reversalOfSnapshotId: source.id, original: source.jurisdictionEvidence as Prisma.InputJsonValue },
          jurisdictionOverrideReason: source.jurisdictionOverrideReason,
          documentCurrency: source.documentCurrency,
          homeCurrency: source.homeCurrency,
          netAmount: source.netAmount.negated(),
          taxAmount: source.taxAmount.negated(),
          grossAmount: source.grossAmount.negated(),
          netHome: source.netHome.negated(),
          taxHome: source.taxHome.negated(),
          grossHome: source.grossHome.negated(),
          fxRate: source.fxRate,
          fxRateSource: source.fxRateSource,
          fxRateDate: source.fxRateDate,
          engineVersion: source.engineVersion,
          sourceKey: `${command.sourceKey}:${source.id}`,
          createdById: command.userId,
          components: {
            create: source.components.map(component => ({
              type: component.type,
              authority: component.authority,
              treatment: component.treatment,
              rate: component.rate,
              taxAmount: component.taxAmount.negated(),
              taxHome: component.taxHome.negated(),
              outputTax: component.outputTax.negated(),
              outputTaxHome: component.outputTaxHome.negated(),
              recoverableTax: component.recoverableTax.negated(),
              recoverableTaxHome: component.recoverableTaxHome.negated(),
              nonrecoverableTax: component.nonrecoverableTax.negated(),
              nonrecoverableTaxHome: component.nonrecoverableTaxHome.negated(),
              recoveryBasisPoints: component.recoveryBasisPoints,
              recoveryReason: component.recoveryReason,
              recoveryEvidence: component.recoveryEvidence ?? undefined,
              recoveryReviewedById: component.recoveryReviewedById,
              recoveryReviewedAt: component.recoveryReviewedAt,
            })),
          },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        companyId: command.companyId,
        userId: command.userId,
        action: 'tax.reverse',
        entityType: 'TaxPosting',
        entityId: posting.id,
        metadata: { sourceKey: command.sourceKey, reversalOfId: original.id, reason: command.reason },
      },
    });
      return tx.taxPosting.findUniqueOrThrow({ where: { id: posting.id }, include: postingInclude });
    };
    return transaction ? await execute(transaction) : await db.$transaction(execute);
  } catch (error) {
    if (transaction) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await db.taxPosting.findUnique({
        where: { companyId_sourceKey: { companyId: command.companyId, sourceKey: command.sourceKey } },
        include: postingInclude,
      });
      if (replay) {
        assertSameRequest(replay, requestHash);
        return replay;
      }
    }
    throw error;
  }
}

export const taxPostingDirectionFor = (sourceType: 'invoice' | 'bill'): PostingDirection =>
  sourceType === 'invoice' ? 'sale' : 'purchase';
