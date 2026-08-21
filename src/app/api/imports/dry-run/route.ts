import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { normalizeRows, dryRunImport, type RawRow } from '@/lib/banking/import-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/imports/dry-run — preview + duplicate classification without
 * importing. 400 when the date format is missing and the file was flagged
 * ambiguous (never guessed silently).
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const accountId = String(body.accountId ?? '');
    const map = body.map ?? {};
    const dateFormat = String(body.dateFormat ?? '');
    const amountMode = body.amountMode === 'debit_credit' ? 'debit_credit' : 'signed';
    const isDateAmbiguous = Boolean(body.isDateAmbiguous);
    const skipDuplicates = body.skipDuplicates !== false;
    const applyRulesOnImport = body.applyRules !== false;

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

    const result = await dryRunImport({
      companyId,
      accountId,
      normalized: normalized.rows,
      skipDuplicates,
      applyRulesOnImport,
    });

    return NextResponse.json({ data: { ...result, errors: normalized.errors } });
  } catch (err) {
    console.error('POST /api/imports/dry-run error:', err);
    return NextResponse.json({ error: 'Failed to check the import' }, { status: 500 });
  }
}
