/**
 * CCA register — server side: chart hygiene, fiscal-year plumbing,
 * the approval-gated annual book-depreciation posting, and assembly
 * of the `cca-register/1` export.
 *
 * Posting rule (the app's standing pattern, same as the loan tool):
 * a computed depreciation figure is a PROPOSAL. Nothing reaches the
 * ledger until a user approves the year through the posting route,
 * which stamps the journal with sourceType 'fixed_asset' and the
 * fiscal-year source id, so the same year can never be posted twice.
 * Register facts (assets, disposals) never post journals by
 * themselves.
 */

import { Prisma, type Company, type FixedAsset, type FixedAssetDisposal } from '@prisma/client';
import { db } from '@/lib/db';
import { postJournalEntry } from '@/lib/journal';
import { getGLActivity, endOfDay, parseLocalDate } from '@/lib/reporting';
import {
  fiscalYearRangeContaining,
  fiscalYearRangeForLabelYear,
  type FiscalYearRange,
} from '@/lib/fiscal-year';
import { buildCcaRegisterPayload, type BuildCcaRegisterResult } from '@/lib/cca-register';
import { formatContractBn } from '@/lib/tb-gifi';
import { toCents, toDollars } from '@/lib/loans/engine';
import { dateToYmd, ymdToDate } from '@/lib/loans/server';
import { ccaClassInfo } from './classes';
import {
  accumulatedDepAtCents,
  classContinuity,
  depreciationForYearCents,
  netBookValueAtCents,
  type BookAssetFacts,
  type ContinuityAsset,
} from './engine';
import type { FiscalContext } from '@/lib/loans/present';
import { fiscalContextOf } from '@/lib/loans/present';

type Tx = Prisma.TransactionClient;

export type FixedAssetWithDisposal = FixedAsset & { disposal: FixedAssetDisposal | null };

function decToCents(v: Prisma.Decimal | number | string): number {
  return toCents(Number(v));
}

// ─── Register facts → engine facts ───

export function assetToFacts(asset: FixedAssetWithDisposal): BookAssetFacts & ContinuityAsset {
  return {
    id: asset.id,
    acquisitionDate: dateToYmd(asset.acquisitionDate),
    capitalCostCents: decToCents(asset.capitalCost),
    availableForUseDate: dateToYmd(asset.availableForUseDate),
    ccaClass: asset.ccaClass,
    aiip: asset.aiip,
    bookMethod: asset.bookMethod,
    bookRatePct: asset.bookRatePct != null ? Number(asset.bookRatePct) : null,
    bookLifeYears: asset.bookLifeYears,
    openingAccumDepCents: decToCents(asset.openingAccumDep),
    openingAccumThrough: asset.openingAccumThrough ? dateToYmd(asset.openingAccumThrough) : null,
    disposal: asset.disposal
      ? {
          date: dateToYmd(asset.disposal.disposalDate),
          proceedsCents: decToCents(asset.disposal.proceeds),
        }
      : null,
  };
}

// ─── Fiscal years ───

/**
 * Consecutive fiscal-year ranges from the year containing `fromYmd`
 * through the year containing `toYmd`, built on the ONE fiscal-year
 * definition (src/lib/fiscal-year.ts).
 */
export function fiscalYearsThrough(ctx: FiscalContext, fromYmd: string, toYmd: string): FiscalYearRange[] {
  const first = fiscalYearRangeContaining(ctx.anchor, fromYmd, ctx.firstYear);
  const last = fiscalYearRangeContaining(ctx.anchor, toYmd, ctx.firstYear);
  const years: FiscalYearRange[] = [];
  for (let labelYear = first.labelYear; labelYear <= last.labelYear && years.length < 80; labelYear++) {
    years.push(fiscalYearRangeForLabelYear(ctx.anchor, labelYear, ctx.firstYear));
  }
  return years;
}

// ─── Chart hygiene ───
// The register owns two shared accounts, get-or-created the same way
// the loan tool creates its accounts, so book depreciation is never
// booked to a mixed expense account. Codes 1695 / 6860 / 6870 are
// unused by the core template, every industry pack, and the loan
// tool (verified against src/lib/default-coa.ts, industry-coa.ts).

export const ACCUM_DEP_ACCOUNT_CODE = '1695';
export const DEP_EXPENSE_ACCOUNT_CODE = '6860';
export const AMORT_EXPENSE_ACCOUNT_CODE = '6870';

export async function ensureAccumulatedDepreciationAccount(
  client: Tx | typeof db,
  companyId: string
): Promise<string> {
  const existing = await client.chartOfAccount.findFirst({
    where: { companyId, code: ACCUM_DEP_ACCOUNT_CODE },
  });
  if (existing) return existing.code;
  await client.chartOfAccount.create({
    data: {
      companyId,
      code: ACCUM_DEP_ACCOUNT_CODE,
      name: 'Accumulated Depreciation',
      type: 'asset',
      subType: 'fixed_asset',
      detailType: 'Accumulated depreciation',
      description: 'Contra-asset for book depreciation — controlled by the CCA register (GIFI 1741)',
      gifiCode: '1741',
    },
  });
  return ACCUM_DEP_ACCOUNT_CODE;
}

export async function ensureDepreciationExpenseAccount(
  client: Tx | typeof db,
  companyId: string,
  intangible: boolean
): Promise<string> {
  const code = intangible ? AMORT_EXPENSE_ACCOUNT_CODE : DEP_EXPENSE_ACCOUNT_CODE;
  const existing = await client.chartOfAccount.findFirst({ where: { companyId, code } });
  if (existing) return existing.code;
  await client.chartOfAccount.create({
    data: {
      companyId,
      code,
      name: intangible ? 'Amortization Expense' : 'Depreciation Expense',
      type: 'expense',
      detailType: intangible ? 'Amortization' : 'Depreciation',
      description: intangible
        ? 'Book amortization of intangible assets — posted by the CCA register (GIFI 8570)'
        : 'Book depreciation of tangible assets — posted by the CCA register (GIFI 8670)',
      gifiCode: intangible ? '8570' : '8670',
    },
  });
  return code;
}

/** The expense/accum account codes an asset's depreciation posts through. */
export async function resolvePostingAccounts(
  client: Tx | typeof db,
  companyId: string,
  asset: FixedAsset
): Promise<{ expenseCode: string; accumCode: string }> {
  const info = ccaClassInfo(asset.ccaClass);
  const expenseCode =
    asset.depExpenseAccountCode ??
    (await ensureDepreciationExpenseAccount(client, companyId, info?.intangible ?? false));
  const accumCode =
    asset.accumDepAccountCode ?? (await ensureAccumulatedDepreciationAccount(client, companyId));
  return { expenseCode, accumCode };
}

// ─── Annual book depreciation: preview + approval-gated posting ───

export interface DepreciationPreviewLine {
  assetId: string;
  description: string;
  ccaClass: string;
  amountCents: number;
  expenseCode: string | null; // null in preview when the account would be created on posting
  accumCode: string | null;
}

export interface DepreciationPreview {
  fiscalYear: FiscalYearRange;
  lines: DepreciationPreviewLine[];
  totalCents: number;
  alreadyPostedJournalId: string | null;
}

export function bookDepreciationSourceId(fy: FiscalYearRange): string {
  return `book-dep:${fy.end}`;
}

async function loadRegister(companyId: string): Promise<FixedAssetWithDisposal[]> {
  return db.fixedAsset.findMany({
    where: { companyId },
    include: { disposal: true },
    orderBy: { availableForUseDate: 'asc' },
  });
}

async function computeYearDepreciation(
  companyId: string,
  targetEndYmd: string
): Promise<{
  company: Pick<Company, 'fiscalYearStart' | 'firstFiscalYearEnd' | 'businessNumber'>;
  assets: FixedAssetWithDisposal[];
  target: FiscalYearRange;
  perAsset: { asset: FixedAssetWithDisposal; amountCents: number }[];
}> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { fiscalYearStart: true, firstFiscalYearEnd: true, businessNumber: true },
  });
  if (!company) throw new Error('Company not found');
  const ctx = fiscalContextOf(company);
  const target = fiscalYearRangeContaining(ctx.anchor, targetEndYmd, ctx.firstYear);
  const assets = await loadRegister(companyId);
  if (assets.length === 0) return { company, assets, target, perAsset: [] };
  const earliest = assets
    .map((a) => dateToYmd(a.availableForUseDate))
    .sort()[0];
  const years = fiscalYearsThrough(ctx, earliest, target.end);
  const perAsset = assets.map((asset) => ({
    asset,
    amountCents: depreciationForYearCents(assetToFacts(asset), years, target.label),
  }));
  return { company, assets, target, perAsset };
}

/** The proposed book-depreciation journal for a fiscal year — no writes. */
export async function previewBookDepreciation(
  companyId: string,
  targetEndYmd: string
): Promise<DepreciationPreview> {
  const { target, perAsset } = await computeYearDepreciation(companyId, targetEndYmd);
  const existing = await db.journalEntry.findFirst({
    where: { companyId, sourceType: 'fixed_asset', sourceId: bookDepreciationSourceId(target) },
    select: { id: true },
  });
  const lines: DepreciationPreviewLine[] = perAsset
    .filter((p) => p.amountCents > 0)
    .map((p) => {
      const info = ccaClassInfo(p.asset.ccaClass);
      return {
        assetId: p.asset.id,
        description: p.asset.description,
        ccaClass: p.asset.ccaClass,
        amountCents: p.amountCents,
        expenseCode:
          p.asset.depExpenseAccountCode ??
          (info?.intangible ? AMORT_EXPENSE_ACCOUNT_CODE : DEP_EXPENSE_ACCOUNT_CODE),
        accumCode: p.asset.accumDepAccountCode ?? ACCUM_DEP_ACCOUNT_CODE,
      };
    });
  return {
    fiscalYear: target,
    lines,
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    alreadyPostedJournalId: existing?.id ?? null,
  };
}

export interface PostBookDepreciationResult {
  journalEntryId: string;
  fiscalYear: FiscalYearRange;
  totalCents: number;
  assetCount: number;
}

/**
 * Post ONE fiscal year's book depreciation as a single balanced
 * journal (Dr depreciation/amortization expense, Cr accumulated
 * depreciation, grouped by account pair). This is the only path from
 * the register's computed depreciation to the ledger, and it runs
 * only when a user approves the year (the route is the approval).
 * Idempotent by construction: the year's source id can be posted
 * once; a second attempt is refused with the existing entry's id.
 */
export async function postBookDepreciation(
  companyId: string,
  targetEndYmd: string,
  userId: string | undefined
): Promise<PostBookDepreciationResult> {
  const { target, perAsset } = await computeYearDepreciation(companyId, targetEndYmd);
  const sourceId = bookDepreciationSourceId(target);
  const existing = await db.journalEntry.findFirst({
    where: { companyId, sourceType: 'fixed_asset', sourceId },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      `Book depreciation for ${target.label} is already posted (journal ${existing.id}) — a year is posted once. Correct it with a manual journal if needed.`
    );
  }
  const chargeable = perAsset.filter((p) => p.amountCents > 0);
  if (chargeable.length === 0) {
    throw new Error(`There is no book depreciation to post for ${target.label}.`);
  }

  return db.$transaction(async (tx) => {
    const groups = new Map<string, { expenseCode: string; accumCode: string; amountCents: number }>();
    for (const p of chargeable) {
      const { expenseCode, accumCode } = await resolvePostingAccounts(tx, companyId, p.asset);
      const key = `${expenseCode}|${accumCode}`;
      const group = groups.get(key) ?? { expenseCode, accumCode, amountCents: 0 };
      group.amountCents += p.amountCents;
      groups.set(key, group);
    }
    const lines: { glAccountCode: string; description: string; debit: number; credit: number }[] = [];
    for (const group of groups.values()) {
      const amount = toDollars(group.amountCents);
      lines.push({
        glAccountCode: group.expenseCode,
        description: `Book depreciation — ${target.label}`,
        debit: amount,
        credit: 0,
      });
      lines.push({
        glAccountCode: group.accumCode,
        description: `Book depreciation — ${target.label}`,
        debit: 0,
        credit: amount,
      });
    }
    const totalCents = chargeable.reduce((s, p) => s + p.amountCents, 0);
    const entry = await postJournalEntry(
      {
        entryDate: ymdToDate(target.end),
        description: `Book depreciation — ${target.label} (CCA register)`,
        sourceType: 'fixed_asset',
        sourceId,
        createdBy: userId,
        lines,
      },
      companyId,
      tx
    );
    return { journalEntryId: entry.id, fiscalYear: target, totalCents, assetCount: chargeable.length };
  });
}

// ─── cca-register/1 export assembly ───

export interface AssembledExport {
  result: BuildCcaRegisterResult;
  fiscalYear: FiscalYearRange;
}

/**
 * Assemble the export for the fiscal year containing `asOfYmd`
 * (default: today). The ledger comparison leg reads the year's
 * activity on accounts carrying GIFI 8670/8570 — the amortization
 * expense actually in the books — so a register that disagrees with
 * the ledger is reported, not smoothed over.
 */
export async function assembleCcaRegisterExport(
  companyId: string,
  asOfYmd: string
): Promise<AssembledExport> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { fiscalYearStart: true, firstFiscalYearEnd: true, businessNumber: true },
  });
  if (!company) throw new Error('Company not found');
  const bn = formatContractBn(company.businessNumber);
  if (!bn) {
    throw new Error(
      'This company has no business number on file. Add the BN in Company Settings before exporting a cca-register/1 file for Nexvar Tax.'
    );
  }
  if (!company.fiscalYearStart) {
    throw new Error('This company has no fiscal year start configured, so the export period cannot be determined.');
  }
  const ctx = fiscalContextOf(company);
  const target = fiscalYearRangeContaining(ctx.anchor, asOfYmd, ctx.firstYear);
  const assets = await loadRegister(companyId);

  const earliest =
    assets.length > 0
      ? assets.map((a) => dateToYmd(a.availableForUseDate)).sort()[0]
      : target.start;
  const years = fiscalYearsThrough(ctx, earliest, target.end);
  const facts = assets.map((a) => ({ asset: a, facts: assetToFacts(a) }));
  const continuity = classContinuity(
    facts.map((f) => f.facts),
    years,
    target
  );

  // Ledger leg: amortization expense in the TB for the year.
  const amortAccounts = await db.chartOfAccount.findMany({
    where: { companyId, gifiCode: { in: ['8670', '8570'] } },
    select: { code: true },
  });
  let ledgerAmortizationExpenseCents: number | null = null;
  if (amortAccounts.length > 0) {
    const activity = await getGLActivity(companyId, {
      from: ymdToDate(target.start),
      to: endOfDay(parseLocalDate(target.end)),
    });
    ledgerAmortizationExpenseCents = amortAccounts.reduce((sum, acct) => {
      const a = activity[acct.code];
      return sum + (a ? toCents(a.debits - a.credits) : 0);
    }, 0);
  }

  const result = buildCcaRegisterPayload({
    companyId,
    bn,
    fiscalYearStart: target.start,
    fiscalYearEnd: target.end,
    fiscalYearLabel: target.label,
    classes: continuity.map((c) => {
      const info = ccaClassInfo(c.ccaClass);
      return {
        ccaClass: c.ccaClass,
        label: info?.label ?? `Class ${c.ccaClass}`,
        ratePct: info?.ratePct ?? null,
        method: info?.method ?? 'DB',
        openingCapitalCostCents: c.openingCostCents,
        closingCapitalCostCents: c.closingCostCents,
        bookDepreciationExpenseCents: c.bookDepreciationCents,
        accumulatedBookDepCents: c.accumulatedBookDepCents,
        netBookValueCents: c.netBookValueCents,
        additionAssetIds: c.additionAssetIds,
        disposalAssetIds: c.disposalAssetIds,
      };
    }),
    assets: facts.map(({ asset, facts: f }) => ({
      assetId: asset.id,
      description: asset.description,
      ccaClass: asset.ccaClass,
      capitalCostCents: f.capitalCostCents,
      grossCostCents: decToCents(asset.grossCost),
      itcClaimedCents: decToCents(asset.itcClaimed),
      governmentAssistanceCents: decToCents(asset.governmentAssistance),
      acquisitionDate: f.acquisitionDate,
      availableForUseDate: f.availableForUseDate,
      aiip: asset.aiip,
      wouldBeClass53: asset.wouldBeClass53,
      luxuryVehicle: asset.luxuryVehicle,
      vendor: asset.vendor,
      serialNumber: asset.serialNumber,
      bookMethod: asset.bookMethod,
      accumulatedBookDepCents: accumulatedDepAtCents(f, years, target.label),
      netBookValueCents: asset.disposal && f.disposal && f.disposal.date <= target.end
        ? 0
        : netBookValueAtCents(f, years, target.label),
      disposal: asset.disposal
        ? {
            date: dateToYmd(asset.disposal.disposalDate),
            proceedsCents: decToCents(asset.disposal.proceeds),
            reason: asset.disposal.reason,
          }
        : null,
    })),
    ledgerAmortizationExpenseCents,
  });

  return { result, fiscalYear: target };
}
