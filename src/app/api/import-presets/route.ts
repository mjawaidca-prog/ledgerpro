import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { ensureImportPresets } from '@/lib/banking/presets';

export const dynamic = 'force-dynamic';

/** GET /api/import-presets — system + company presets (seeded lazily). */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    await ensureImportPresets();

    const presets = await db.importPreset.findMany({
      where: { OR: [{ companyId: null }, { companyId }] },
      orderBy: [{ isSystem: 'desc' }, { institution: 'asc' }],
    });

    return NextResponse.json({ data: presets });
  } catch (err) {
    console.error('GET /api/import-presets error:', err);
    return NextResponse.json({ error: 'Failed to load presets' }, { status: 500 });
  }
}

/** POST /api/import-presets — save a mapping as a company preset. */
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const institution = String(body.institution ?? 'OTHER');
    const label = String(body.label ?? 'Saved preset');
    const columnMap = body.columnMap ?? {};

    const preset = await db.importPreset.create({
      data: {
        companyId,
        institution: institution as any,
        label,
        fileTypes: body.fileTypes ?? ['csv'],
        hasHeader: body.hasHeader !== false,
        dateFormat: (body.dateFormat as any) ?? 'YYYY_MM_DD',
        amountMode: (body.amountMode as any) ?? 'signed',
        columnMap: columnMap as any,
        headerSignature: body.headerSignature ?? null,
        isSystem: false,
      },
    });

    return NextResponse.json({ data: preset }, { status: 201 });
  } catch (err) {
    console.error('POST /api/import-presets error:', err);
    return NextResponse.json({ error: 'Failed to save the preset' }, { status: 500 });
  }
}
