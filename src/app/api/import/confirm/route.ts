import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

/*
  POST /api/import/confirm
  Body: { accountId, mappedRows: Array<{ date, description, amount }>, skipDuplicates: boolean }

  Creates an ImportBatch and associated Transactions.
  Runs duplicate detection against the same account.
*/
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { accountId, mappedRows, skipDuplicates } = body;

    if (!accountId || !mappedRows || !Array.isArray(mappedRows)) {
      return NextResponse.json({ error: 'accountId and mappedRows are required' }, { status: 400 });
    }

    const account = await db.financialAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
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
    const rowsToImport: typeof mappedRows = [];

    for (let i = 0; i < mappedRows.length; i++) {
      const row = mappedRows[i];
      const rowDate = new Date(row.date);
      const rowAmount = parseFloat(row.amount);

      const isDuplicate = existingTxns.some((existing) => {
        const existingDate = new Date(existing.date);
        const dayDiff = Math.abs(
          (rowDate.getTime() - existingDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const amountMatch = Math.abs(rowAmount - Number(existing.amount)) < 0.01;
        return dayDiff <= 2 && amountMatch;
      });

      if (isDuplicate) {
        duplicates.push(i);
        if (!skipDuplicates) {
          rowsToImport.push(row);
        }
      } else {
        rowsToImport.push(row);
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
        fileType: 'csv',
        rowsParsed: mappedRows.length,
        rowsImported: rowsToImport.length,
        duplicatesFound: duplicates.length,
        dateRangeStart: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
        dateRangeEnd: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
        status: 'imported',
      },
    });

    // Create transactions
    const signMultiplier = account.kind === 'creditcard' ? -1 : 1;

    await db.transaction.createMany({
      data: rowsToImport.map((row) => ({
        companyId,
        financialAccountId: accountId,
        date: new Date(row.date),
        description: row.description || 'Unknown',
        rawStatementText: row.description || '',
        amount: parseFloat(row.amount) * signMultiplier,
        status: 'toreview',
        source: 'csv',
        importBatchId: batch.id,
      })),
    });

    const imported = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      select: { id: true, date: true, description: true, amount: true },
    });

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
