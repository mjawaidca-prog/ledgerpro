import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/api-helpers';
import { notifyImportComplete } from '@/lib/notifications';
import { getServerSession } from '@/lib/auth';
import { normalizeStatementDate } from '@/lib/import-parser';
export const dynamic = 'force-dynamic';

/*
  POST /api/import/confirm
  Body: { accountId, mappedRows: Array<{ date, description, amount }>, skipDuplicates: boolean }

  Creates an ImportBatch and associated Transactions.
  Runs duplicate detection against the same account.
*/
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId, mappedRows, skipDuplicates, fileType } = body;
    const importFileType: 'csv' | 'ofx' | 'pdf' = fileType === 'ofx' || fileType === 'pdf' ? fileType : 'csv';

    if (!accountId || !mappedRows || !Array.isArray(mappedRows)) {
      return NextResponse.json({ error: 'accountId and mappedRows are required' }, { status: 400 });
    }

    const account = await db.financialAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const session = await getServerSession();
    const userId = session?.user?.id || null;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = account.companyId;
    const membership = await db.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { onboardingComplete: true, name: true },
    });
    if (company && !company.onboardingComplete) {
      return NextResponse.json(
        { error: 'Company setup is incomplete. Please complete onboarding first.' },
        { status: 400 }
      );
    }

    // Get existing transactions for duplicate detection
    const existingTxns = await db.transaction.findMany({
      where: {
        financialAccountId: accountId,
        source: { not: 'manual' }, // only check imported
      },
      select: { date: true, amount: true, description: true },
    });

    const duplicates: number[] = [];
    const rowsToImport: Array<{ date: string; description: string; amount: number }> = [];

    for (let i = 0; i < mappedRows.length; i++) {
      const row = mappedRows[i];
      const normalizedDate = normalizeStatementDate(String(row?.date ?? ''));
      if (!normalizedDate) {
        return NextResponse.json(
          { error: `Row ${i + 1} has an invalid date: ${row?.date ?? '(empty)'}` },
          { status: 400 }
        );
      }

      const rowAmount = Number.parseFloat(String(row?.amount ?? '').replace(/,/g, ''));
      if (!Number.isFinite(rowAmount)) {
        return NextResponse.json(
          { error: `Row ${i + 1} has an invalid amount: ${row?.amount ?? '(empty)'}` },
          { status: 400 }
        );
      }

      const normalizedRow = {
        date: normalizedDate,
        description: String(row?.description ?? '').trim() || 'Unknown',
        amount: rowAmount,
      };
      const rowDate = new Date(normalizedRow.date);

      const isDuplicate = existingTxns.some((existing) => {
        const existingDate = new Date(existing.date);
        const dayDiff = Math.abs(
          (rowDate.getTime() - existingDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const amountMatch = Math.abs(normalizedRow.amount - Number(existing.amount)) < 0.01;
        // Also require description similarity to avoid false positives
        const descMatch = !existing.description || !normalizedRow.description
          || existing.description.toLowerCase().trim() === normalizedRow.description.toLowerCase().trim()
          || (existing.description.length > 3 && normalizedRow.description.length > 3
              && (existing.description.toLowerCase().includes(normalizedRow.description.toLowerCase().substring(0, 5))
                  || normalizedRow.description.toLowerCase().includes(existing.description.toLowerCase().substring(0, 5))));
        return dayDiff <= 2 && amountMatch && descMatch;
      });

      if (isDuplicate) {
        duplicates.push(i);
        if (!skipDuplicates) {
          rowsToImport.push(normalizedRow);
        }
      } else {
        rowsToImport.push(normalizedRow);
      }
    }

    // Create import batch
    const dates = rowsToImport
      .map((r) => new Date(r.date))
      .filter((d) => !isNaN(d.getTime()));

    const batch = await db.importBatch.create({
      data: {
        companyId,
        financialAccountId: accountId,
        fileName: 'statement-import',
        fileType: importFileType,
        rowsParsed: mappedRows.length,
        rowsImported: rowsToImport.length,
        duplicatesFound: duplicates.length,
        dateRangeStart: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
        dateRangeEnd: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
        status: 'imported',
      },
    });

    // Create transactions
    // Note: Sign direction is handled by the frontend import wizard.
    // The mappedRows already have the correct sign applied.

    await db.transaction.createMany({
      data: rowsToImport.map((row) => ({
        companyId,
        financialAccountId: accountId,
        date: new Date(row.date),
        description: row.description,
        rawStatementText: row.description,
        amount: row.amount,
        status: 'toreview',
        source: importFileType,
        importBatchId: batch.id,
      })),
    });

    const imported = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      select: { id: true, date: true, description: true, amount: true },
    });

    // Notify company members
    await notifyImportComplete(companyId, account.name, imported.length, batch.id).catch(() => {});

    return NextResponse.json({
      data: {
        batch,
        importedCount: imported.length,
        duplicatesSkipped: duplicates.length,
        transactions: imported,
      },
    });
  } catch (error) {
    console.error('POST /api/import/confirm error:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
