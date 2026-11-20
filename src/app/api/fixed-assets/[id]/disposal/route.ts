import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
import { ymdToDate } from '@/lib/loans/server';
import { disposalJson } from '@/lib/cca/present';

export const dynamic = 'force-dynamic';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const disposalCreateSchema = z.object({
  date: ymd,
  proceeds: z.number().min(0),
  reason: z.enum(['sold', 'scrapped', 'shareholder_taken', 'traded_in', 'other']),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * Record the asset's disposal. Proceeds and date are facts the tax
 * engine consumes from the export (recapture / terminal loss are
 * pool conclusions drawn in Nexvar Tax); recording a disposal never
 * posts a journal — the book gain/loss surfaces in the register and
 * the year-end package, and the accountant posts the disposal entry.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const asset = await db.fixedAsset.findFirst({
      where: { id: params.id, companyId },
      include: { disposal: true },
    });
    if (!asset) return NextResponse.json({ error: 'Fixed asset not found' }, { status: 404 });
    if (asset.disposal) {
      return NextResponse.json(
        { error: 'This asset already has a disposal recorded. Remove it before recording another.' },
        { status: 409 }
      );
    }

    const body = await req.json();
    const parsed = disposalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;
    if (v.date < asset.acquisitionDate.toISOString().slice(0, 10)) {
      return NextResponse.json(
        { error: 'The disposal date cannot be before the acquisition date.' },
        { status: 400 }
      );
    }

    const disposal = await db.fixedAssetDisposal.create({
      data: {
        assetId: asset.id,
        disposalDate: ymdToDate(v.date),
        proceeds: v.proceeds,
        reason: v.reason,
        notes: v.notes ?? null,
        createdBy: userId,
      },
    });

    await auditLog(companyId, userId, 'fixed_asset.disposal.create', 'fixed_asset', asset.id, {
      proceeds: v.proceeds,
      reason: v.reason,
    });

    return NextResponse.json({ data: disposalJson(disposal) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/fixed-assets/[id]/disposal error:', error);
    return NextResponse.json({ error: 'Failed to record disposal' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin'],
    });
    if (error) return error;

    const asset = await db.fixedAsset.findFirst({
      where: { id: params.id, companyId },
      include: { disposal: true },
    });
    if (!asset) return NextResponse.json({ error: 'Fixed asset not found' }, { status: 404 });
    if (!asset.disposal) {
      return NextResponse.json({ error: 'This asset has no disposal recorded.' }, { status: 404 });
    }

    await db.fixedAssetDisposal.delete({ where: { id: asset.disposal.id } });
    await auditLog(companyId, userId, 'fixed_asset.disposal.delete', 'fixed_asset', asset.id, {});

    return NextResponse.json({ data: { id: asset.id, disposalRemoved: true } });
  } catch (error) {
    console.error('DELETE /api/fixed-assets/[id]/disposal error:', error);
    return NextResponse.json({ error: 'Failed to remove disposal' }, { status: 500 });
  }
}
