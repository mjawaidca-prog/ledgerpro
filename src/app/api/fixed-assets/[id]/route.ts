import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { toCents } from '@/lib/loans/engine';
import { ymdToDate } from '@/lib/loans/server';
import { fiscalYearRangeContaining } from '@/lib/fiscal-year';
import { assetFieldsSchema } from '@/lib/cca/validate';
import { assetJson, assetPosition, assetSchedule, fiscalContextOf, registerYears } from '@/lib/cca/present';

export const dynamic = 'force-dynamic';

async function loadAsset(companyId: string, id: string) {
  return db.fixedAsset.findFirst({
    where: { id, companyId },
    include: { disposal: true },
  });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const asset = await loadAsset(companyId, params.id);
    if (!asset) return NextResponse.json({ error: 'Fixed asset not found' }, { status: 404 });

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true, firstFiscalYearEnd: true },
    });
    const ctx = fiscalContextOf(company!);
    const today = new Date().toISOString().slice(0, 10);
    const currentFy = fiscalYearRangeContaining(ctx.anchor, today, ctx.firstYear);
    const years = registerYears(ctx, [asset], today);

    return NextResponse.json({
      data: {
        ...assetJson(asset),
        position: assetPosition(asset, years, currentFy.label),
        schedule: assetSchedule(asset, years),
      },
    });
  } catch (error) {
    console.error('GET /api/fixed-assets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch fixed asset' }, { status: 500 });
  }
}

const assetUpdateSchema = assetFieldsSchema.partial();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const existing = await loadAsset(companyId, params.id);
    if (!existing) return NextResponse.json({ error: 'Fixed asset not found' }, { status: 404 });

    const body = await req.json();
    const parsed = assetUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;

    // Cross-field rules that depend on the merged record.
    const merged = {
      ccaClass: v.ccaClass ?? existing.ccaClass,
      acquisitionDate: v.acquisitionDate ?? existing.acquisitionDate.toISOString().slice(0, 10),
      availableForUseDate:
        v.availableForUseDate ?? existing.availableForUseDate.toISOString().slice(0, 10),
      wouldBeClass53: v.wouldBeClass53 ?? existing.wouldBeClass53,
      grossCost: v.grossCost ?? Number(existing.grossCost),
      itcClaimed: v.itcClaimed ?? Number(existing.itcClaimed),
      governmentAssistance: v.governmentAssistance ?? Number(existing.governmentAssistance),
      bookMethod: v.bookMethod ?? existing.bookMethod,
      bookRatePct: v.bookRatePct !== undefined ? v.bookRatePct : existing.bookRatePct != null ? Number(existing.bookRatePct) : null,
      bookLifeYears: v.bookLifeYears !== undefined ? v.bookLifeYears : existing.bookLifeYears,
    };
    if (merged.bookMethod === 'straight_line' && !merged.bookLifeYears) {
      return NextResponse.json(
        { error: 'Straight-line book depreciation needs a life in years.' },
        { status: 400 }
      );
    }
    if (merged.bookMethod === 'declining_balance' && merged.bookRatePct == null) {
      return NextResponse.json(
        { error: 'Declining-balance book depreciation needs a rate.' },
        { status: 400 }
      );
    }
    if (merged.availableForUseDate < merged.acquisitionDate) {
      return NextResponse.json(
        { error: 'The available-for-use date cannot be before the acquisition date.' },
        { status: 400 }
      );
    }
    if (merged.wouldBeClass53 && merged.ccaClass !== '43') {
      return NextResponse.json(
        { error: 'The would-be-Class-53 flag applies only to Class 43 property.' },
        { status: 400 }
      );
    }
    const capitalCostCentsTotal =
      toCents(merged.grossCost) - toCents(merged.itcClaimed) - toCents(merged.governmentAssistance);
    if (capitalCostCentsTotal < 0) {
      return NextResponse.json(
        { error: 'ITCs claimed plus government assistance exceed the gross cost.' },
        { status: 400 }
      );
    }

    const updated = await db.fixedAsset.update({
      where: { id: existing.id },
      data: {
        ...(v.description !== undefined ? { description: v.description } : {}),
        ...(v.serialNumber !== undefined ? { serialNumber: v.serialNumber } : {}),
        ...(v.vendor !== undefined ? { vendor: v.vendor } : {}),
        ...(v.invoiceRef !== undefined ? { invoiceRef: v.invoiceRef } : {}),
        ...(v.location !== undefined ? { location: v.location } : {}),
        ...(v.ccaClass !== undefined ? { ccaClass: v.ccaClass } : {}),
        ...(v.grossCost !== undefined ? { grossCost: v.grossCost } : {}),
        ...(v.itcClaimed !== undefined ? { itcClaimed: v.itcClaimed } : {}),
        ...(v.governmentAssistance !== undefined ? { governmentAssistance: v.governmentAssistance } : {}),
        // Capital cost is always re-derived from the merged cost facts.
        capitalCost: capitalCostCentsTotal / 100,
        ...(v.acquisitionDate !== undefined ? { acquisitionDate: ymdToDate(v.acquisitionDate) } : {}),
        ...(v.availableForUseDate !== undefined
          ? { availableForUseDate: ymdToDate(v.availableForUseDate) }
          : {}),
        ...(v.aiip !== undefined ? { aiip: v.aiip } : {}),
        ...(v.wouldBeClass53 !== undefined ? { wouldBeClass53: v.wouldBeClass53 } : {}),
        ...(v.luxuryVehicle !== undefined ? { luxuryVehicle: v.luxuryVehicle } : {}),
        ...(v.assetAccountCode !== undefined ? { assetAccountCode: v.assetAccountCode } : {}),
        ...(v.accumDepAccountCode !== undefined ? { accumDepAccountCode: v.accumDepAccountCode } : {}),
        ...(v.depExpenseAccountCode !== undefined ? { depExpenseAccountCode: v.depExpenseAccountCode } : {}),
        ...(v.bookMethod !== undefined ? { bookMethod: v.bookMethod } : {}),
        ...(v.bookRatePct !== undefined ? { bookRatePct: v.bookRatePct } : {}),
        ...(v.bookLifeYears !== undefined ? { bookLifeYears: v.bookLifeYears } : {}),
        ...(v.openingAccumDep !== undefined ? { openingAccumDep: v.openingAccumDep } : {}),
        ...(v.openingAccumThrough !== undefined
          ? { openingAccumThrough: v.openingAccumThrough ? ymdToDate(v.openingAccumThrough) : null }
          : {}),
        ...(v.notes !== undefined ? { notes: v.notes } : {}),
      },
      include: { disposal: true },
    });

    await auditLog(companyId, userId, 'fixed_asset.update', 'fixed_asset', updated.id, {
      fields: Object.keys(v),
    });

    return NextResponse.json({ data: assetJson(updated) });
  } catch (error) {
    console.error('PATCH /api/fixed-assets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update fixed asset' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin'],
    });
    if (error) return error;

    const existing = await loadAsset(companyId, params.id);
    if (!existing) return NextResponse.json({ error: 'Fixed asset not found' }, { status: 404 });

    await db.fixedAsset.delete({ where: { id: existing.id } });
    await auditLog(companyId, userId, 'fixed_asset.delete', 'fixed_asset', existing.id, {
      description: existing.description,
    });

    return NextResponse.json({ data: { id: existing.id, deleted: true } });
  } catch (error) {
    console.error('DELETE /api/fixed-assets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete fixed asset' }, { status: 500 });
  }
}
