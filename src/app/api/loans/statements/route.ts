import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import {
  createLoanStatementFromUpload,
  listLoanStatements,
} from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/loans/statements — captured lender statements for the
 * active company (metadata + the AI read; never the document bytes).
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    const data = await listLoanStatements(companyId!);
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('GET /api/loans/statements error:', err);
    return NextResponse.json({ error: err.message || 'Failed to list loan statements' }, { status: 500 });
  }
}

/**
 * POST /api/loans/statements — multipart upload of one lender
 * statement (field "file": PDF or photo). Stores the document and
 * runs the AI read best-effort; the statement lands as a draft for
 * review. NOTHING is applied to any loan by this route.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Attach a statement file in the "file" field.' }, { status: 400 });
    }

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const statement = await createLoanStatementFromUpload({
      companyId: companyId!,
      userId: userId!,
      fileName: (file as File).name || 'statement',
      mimeType: (file as File).type || 'application/octet-stream',
      buffer,
    });

    await auditLog(companyId!, userId!, 'loan_statement.create', 'loanStatement', statement.id, {
      fileName: statement.originalFileName,
      extractionStatus: statement.extractionStatus,
    } as any);

    return NextResponse.json({ data: { statement } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/loans/statements error:', err);
    const status = /empty|5 MB|supported|HEIC|Most Compatible/i.test(err?.message ?? '') ? 400 : 500;
    return NextResponse.json({ error: err.message || 'Failed to upload statement' }, { status });
  }
}
