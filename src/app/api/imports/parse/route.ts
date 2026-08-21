import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { parseStatementFile } from '@/lib/import-parser';
import { ensureImportPresets } from '@/lib/banking/presets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/imports/parse — multipart file + accountId + optional presetId.
 * Returns columns with samples, the suggested mapping, the detected date
 * format, the file's date range, and the overlap note vs the last import.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const accountId = String(form.get('accountId') ?? '');
    const presetId = form.get('presetId') ? String(form.get('presetId')) : null;

    if (!file) {
      return NextResponse.json({ error: 'A statement file is required.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 400 });
    }
    if (!accountId) {
      return NextResponse.json({ error: 'An account is required.' }, { status: 400 });
    }

    const account = await db.financialAccount.findUnique({ where: { id: accountId, companyId } });
    if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

    await ensureImportPresets();

    const preset = presetId
      ? await db.importPreset.findFirst({
          where: { OR: [{ id: presetId }, { id: presetId, companyId }, { id: presetId, companyId: null }] },
        })
      : null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseStatementFile(buffer, file.name, { hasHeader: preset?.hasHeader !== false });

    // Suggested map from the preset's columnMap (or empty for manual mapping).
    const suggestedMap: Record<string, string> =
      preset && preset.columnMap && typeof preset.columnMap === 'object'
        ? { ...(preset.columnMap as Record<string, string>) }
        : {};

    // Column samples for the mapping UI.
    const columns = parsed.headers.map((h) => {
      const samples: string[] = [];
      for (const row of parsed.rows) {
        if (row.raw[h] !== undefined && row.raw[h] !== '' && samples.length < 3) samples.push(row.raw[h]);
      }
      return { name: h, sampleValues: samples };
    });

    // Date range on file — from the preset's date column or any mapped date.
    const dateField = suggestedMap && Object.entries(suggestedMap).find(([, f]) => f === 'date')?.[0];
    let rangeStart: string | null = null;
    let rangeEnd: string | null = null;
    if (dateField) {
      const dates = parsed.rows
        .map((r) => r.raw[dateField])
        .filter(Boolean)
        .sort();
      if (dates.length) {
        rangeStart = dates[0];
        rangeEnd = dates[dates.length - 1];
      }
    }

    // Ambiguity: first 40 rows all day-of-month ≤ 12 and no preset declaring it.
    let isDateAmbiguous = false;
    if (!preset && dateField) {
      const first40 = parsed.rows.slice(0, 40).map((r) => r.raw[dateField]).filter(Boolean);
      if (first40.length > 0) {
        const days = first40.map((d) => {
          const m = d.match(/(\d{1,2})\//);
          return m ? Number(m[1]) : null;
        });
        isDateAmbiguous = days.every((d) => d === null || d <= 12);
      }
    }

    const lastImportAt = account.lastImportAt ? account.lastImportAt.toISOString().slice(0, 10) : null;
    const overlapNote = lastImportAt
      ? `The last import for this account ended ${lastImportAt}, so no dates overlap.`
      : 'This is the first import for this account.';

    return NextResponse.json({
      data: {
        fileName: file.name,
        fileSize: file.size,
        fileType: parsed.fileType,
        columns,
        suggestedMap,
        detectedDateFormat: preset?.dateFormat ?? null,
        amountMode: preset?.amountMode ?? null,
        hasHeader: preset?.hasHeader ?? true,
        isDateAmbiguous,
        rangeStart,
        rangeEnd,
        rowsTotal: parsed.rows.length,
        rows: parsed.rows.map((r) => ({ raw: r.raw })),
        errors: parsed.errors,
        lastImportAt,
        overlapNote,
      },
    });
  } catch (err) {
    console.error('POST /api/imports/parse error:', err);
    return NextResponse.json({ error: 'Failed to read the statement file' }, { status: 500 });
  }
}
