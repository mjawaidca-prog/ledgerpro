import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { toCents } from '@/lib/loans/engine';
import { ymdToDate } from '@/lib/loans/server';
import { fiscalYearRangeContaining } from '@/lib/fiscal-year';
import { ccaClassInfo, defaultAiip } from '@/lib/cca/classes';
import { classContinuity } from '@/lib/cca/engine';
import { assetCreateSchema } from '@/lib/cca/validate';
import {
  assetToFacts,
  ensureAccumulatedDepreciationAccount,
  ensureDepreciationExpenseAccount,
} from '@/lib/cca/server';
import {
  assetJson,
  assetPosition,
  continuityJson,
  fiscalContextOf,
  registerYears,
} from '@/lib/cca/present';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true, firstFiscalYearEnd: true },
    });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const ctx = fiscalContextOf(company);
    const today = new Date().toISOString().slice(0, 10);
    const currentFy = fiscalYearRangeContaining(ctx.anchor, today, ctx.firstYear);

    const assets = await db.fixedAsset.findMany({
      where: { companyId },
      include: { disposal: true },
      orderBy: { availableForUseDate: 'asc' },
    });
    const years = registerYears(ctx, assets, today);
    const continuity = classContinuity(assets.map(assetToFacts), years, currentFy);

    return NextResponse.json({
      data: {
        fiscalYear: currentFy,
        assets: assets.map((a) => ({
          ...assetJson(a),
          position: assetPosition(a, years, currentFy.label),
        })),
        continuity: continuityJson(continuity),
      },
    });
  } catch (error) {
    console.error('GET /api/fixed-assets error:', error);
    return NextResponse.json({ error: 'Failed to fetch fixed assets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const body = await req.json();
    const parsed = assetCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;
    const capitalCostCentsTotal =
      toCents(v.grossCost) - toCents(v.itcClaimed) - toCents(v.governmentAssistance);

    // Any GL account the user named must exist in this company's chart.
    const namedCodes = [v.assetAccountCode, v.accumDepAccountCode, v.depExpenseAccountCode].filter(
      (c): c is string => !!c
    );
    if (namedCodes.length > 0) {
      const found = await db.chartOfAccount.findMany({
        where: { companyId, code: { in: namedCodes } },
        select: { code: true },
      });
      const foundCodes = new Set(found.map((a) => a.code));
      const missing = namedCodes.filter((c) => !foundCodes.has(c));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `GL account(s) not found in this company's chart: ${missing.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const asset = await db.$transaction(async (tx) => {
      // Chart hygiene: the register creates its depreciation accounts
      // properly rather than borrowing a mixed expense account.
      const info = ccaClassInfo(v.ccaClass);
      const accumDepAccountCode =
        v.accumDepAccountCode ?? (await ensureAccumulatedDepreciationAccount(tx, companyId));
      const depExpenseAccountCode =
        v.depExpenseAccountCode ??
        (await ensureDepreciationExpenseAccount(tx, companyId, info?.intangible ?? false));

      return tx.fixedAsset.create({
        data: {
          companyId,
          description: v.description,
          serialNumber: v.serialNumber ?? null,
          vendor: v.vendor ?? null,
          invoiceRef: v.invoiceRef ?? null,
          location: v.location ?? null,
          ccaClass: v.ccaClass,
          grossCost: v.grossCost,
          itcClaimed: v.itcClaimed,
          governmentAssistance: v.governmentAssistance,
          capitalCost: capitalCostCentsTotal / 100,
          acquisitionDate: ymdToDate(v.acquisitionDate),
          availableForUseDate: ymdToDate(v.availableForUseDate),
          aiip: v.aiip ?? defaultAiip(v.acquisitionDate, v.availableForUseDate),
          wouldBeClass53: v.wouldBeClass53,
          luxuryVehicle: v.luxuryVehicle,
          assetAccountCode: v.assetAccountCode ?? null,
          accumDepAccountCode,
          depExpenseAccountCode,
          bookMethod: v.bookMethod,
          bookRatePct: v.bookRatePct ?? null,
          bookLifeYears: v.bookLifeYears ?? null,
          openingAccumDep: v.openingAccumDep,
          openingAccumThrough: v.openingAccumThrough ? ymdToDate(v.openingAccumThrough) : null,
          notes: v.notes ?? null,
          createdBy: userId,
        },
        include: { disposal: true },
      });
    });

    await auditLog(companyId, userId, 'fixed_asset.create', 'fixed_asset', asset.id, {
      ccaClass: asset.ccaClass,
      capitalCost: Number(asset.capitalCost),
    });

    return NextResponse.json({ data: assetJson(asset) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/fixed-assets error:', error);
    return NextResponse.json({ error: 'Failed to create fixed asset' }, { status: 500 });
  }
}
