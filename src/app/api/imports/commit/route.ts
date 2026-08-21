import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { normalizeRows, commitImport, type RawRow } from '@/lib/banking/import-service';
import { notifyImportComplete } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * POST /api/imports/commit — import the confirmed rows. Re-runs duplicate
 * classification server-side; locked-period rows are never importable.
 * Optionally saves the mapping as a company preset.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const accountId = String(body.accountId ?? '');
    const fileName = String(body.fileName ?? 'statement-import');
    const fileSize = Number(body.fileSize ?? 0);
    const fileType = String(body.fileType ?? 'csv');
    const presetId = body.presetId ? String(body.presetId) : null;
    const map = body.map ?? {};
    const dateFormat = String(body.dateFormat ?? '');
    const amountMode = body.amountMode === 'debit_credit' ? 'debit_credit' : 'signed';
    const isDateAmbiguous = Boolean(body.isDateAmbiguous);
    const skipDuplicates = body.skipDuplicates !== false;
    const applyRulesOnImport = body.applyRules !== false;
    const autoPostExactMatches = Boolean(body.autoPostExactMatches);
    const skipRowIndexes: number[] = Array.isArray(body.skipRowIndexes) ? body.skipRowIndexes.map(Number) : [];
    const savePreset = Boolean(body.savePreset);

    if (!accountId) return NextResponse.json({ error: 'An account is required.' }, { status: 400 });
    if (isDateAmbiguous && !dateFormat) {
      return NextResponse.json(
        { error: 'Confirm the date format — the dates in this file are ambiguous.' },
        { status: 400 }
      );
    }

    const rawRows: RawRow[] = (body.rows ?? []).map((r: any, i: number) => ({
      raw: r.raw ?? {},
      rowIndex: i,
      fitid: r.fitid ?? null,
    }));

    const normalized = normalizeRows({ rows: rawRows, map, dateFormat, amountMode });
    if (normalized.rows.length === 0) {
      return NextResponse.json(
        { error: normalized.errors[0] ?? 'No rows could be read from the file.' },
        { status: 400 }
      );
    }

    const result = await commitImport({
      companyId,
      userId: userId ?? undefined,
      accountId,
      fileName,
      fileSize,
      fileType: fileType as any,
      presetId,
      mappingJson: map,
      normalized: normalized.rows,
      skipDuplicates,
      applyRulesOnImport,
      autoPostExactMatches,
      skipRowIndexes,
    });

    // Save the mapping as a company preset when asked (Generic/OTHER).
    if (savePreset) {
      await db.importPreset.upsert({
        where: { id: `company-${accountId}` },
        update: { columnMap: map as any, headerSignature: null },
        create: {
          id: `company-${accountId}`,
          companyId,
          institution: 'OTHER',
          label: fileName,
          fileTypes: [fileType],
          hasHeader: true,
          dateFormat: dateFormat as any,
          amountMode: amountMode as any,
          columnMap: map as any,
          isSystem: false,
        },
      });
    }

    const account = await db.financialAccount.findUnique({
      where: { id: accountId },
      select: { name: true },
    });

    await auditLog(companyId, userId, 'import.create', 'StatementImport', result.importId, {
      fileName, newCount: result.newCount, skippedDuplicate: result.skippedDuplicate, skippedLocked: result.skippedLocked,
    } as any);

    await notifyImportComplete(companyId, account?.name ?? 'Account', result.newCount, result.importId);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/imports/commit error:', err);
    return NextResponse.json({ error: err.message || 'Failed to import' }, { status: 500 });
  }
}
