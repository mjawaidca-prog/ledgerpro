import { NextRequest, NextResponse } from 'next/server';
import { parseStatementFile } from '@/lib/import-parser';
import { parsePdfBankStatement, detectPdfImportDuplicates } from '@/lib/pdf-bank-statement-parser';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // needed for pdfjs-dist

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File must be ≤ 10 MB' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ── PDF: use pdfjs-dist position-aware parser ──
    if (fileName.endsWith('.pdf')) {
      const { companyId } = await requireCompany(req);
      const accountKind = (formData.get('accountKind') as string) || 'bank';
      const statementYear = parseInt((formData.get('statementYear') as string) || String(new Date().getFullYear()));

      const parsed = await parsePdfBankStatement(buffer, {
        accountKind: accountKind as any,
        statementYear: isNaN(statementYear) ? new Date().getFullYear() : statementYear,
        signMode: accountKind === 'credit_card' ? 'credit-card' : 'normal',
        runningBalance: 'auto',
        currency: 'USD',
      });

      // Map to the format the banking wizard expects
      const rows = parsed.transactions.map(tx => ({
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        balance: tx.balance,
        merchant: tx.merchant,
        confidence: tx.confidence,
        warnings: tx.warnings,
        rawStatementText: tx.rawStatementText,
        raw: {
          Date: tx.date,
          Description: tx.description,
          Amount: String(tx.amount),
          ...(tx.balance !== undefined ? { Balance: String(tx.balance) } : {}),
          ...(tx.merchant ? { Merchant: tx.merchant } : {}),
          confidence: String(tx.confidence),
          warnings: tx.warnings.join('; '),
        },
      }));

      // Duplicate detection if a company/account context is available
      let duplicateMatches: any[] = [];
      if (companyId) {
        const accountId = (formData.get('accountId') as string) || '';
        if (accountId) {
          const existingForAccount = await db.transaction.findMany({
            where: { companyId, financialAccountId: accountId },
            select: { id: true, financialAccountId: true, date: true, amount: true, description: true },
          });
          duplicateMatches = detectPdfImportDuplicates(
            parsed.transactions,
            existingForAccount.map(tx => ({ ...tx, amount: tx.amount.toString() })),
            accountId,
          );
        }
      }

      const duplicateFingerprints = new Set(duplicateMatches.map(m => m.transaction.fingerprint));
      const cleanRows = rows.filter((_, i) => !duplicateFingerprints.has(parsed.transactions[i]?.fingerprint));

      return NextResponse.json({
        data: {
          fileName: file.name,
          fileType: 'pdf',
          headers: ['Date', 'Description', 'Amount', 'Balance', 'Merchant'],
          rows: cleanRows.slice(0, 100),
          totalRows: cleanRows.length,
          metadata: parsed.metadata,
          warnings: parsed.warnings,
          rejectedRows: parsed.rejectedRows,
          duplicates: duplicateMatches,
          errors: [...parsed.warnings, ...parsed.rejectedRows.map(r => r.reason)],
        },
      });
    }

    // ── OFX / QFX: binary, use existing parser ──
    if (fileName.endsWith('.ofx') || fileName.endsWith('.qfx')) {
      const result = await parseStatementFile(buffer, file.name);
      return NextResponse.json({
        data: {
          fileName: file.name,
          fileType: result.fileType,
          headers: result.headers,
          rows: result.rows.slice(0, 100),
          totalRows: result.rows.length,
          errors: result.errors,
        },
      });
    }

    // ── CSV / TXT: text-based ──
    const content = buffer.toString('utf-8');
    const result = await parseStatementFile(buffer, file.name);

    return NextResponse.json({
      data: {
        fileName: file.name,
        fileType: result.fileType,
        headers: result.headers,
        rows: result.rows.slice(0, 100),
        totalRows: result.rows.length,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('POST /api/import/parse error:', error);
    return NextResponse.json({ error: 'Failed to parse file' }, { status: 500 });
  }
}
