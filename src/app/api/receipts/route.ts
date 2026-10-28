import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createReceiptFromUpload, listReceipts, attachReceipt } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/receipts?status=inbox|attached|all — receipt metadata for the
 * active company (never the image bytes; those go through /[id]/image).
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    const status = new URL(req.url).searchParams.get('status');
    const data = await listReceipts(companyId!, status);
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('GET /api/receipts error:', err);
    return NextResponse.json({ error: err.message || 'Failed to list receipts' }, { status: 500 });
  }
}

/**
 * POST /api/receipts — multipart upload of one receipt (field "file",
 * optional "transactionId"). Stores the file, extracts text, parses the
 * fields, and suggests a category from the company's rules. Nothing is
 * posted to the GL; the receipt lands in the inbox as suggestions.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Attach a receipt file in the "file" field.' }, { status: 400 });
    }

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const receipt = await createReceiptFromUpload({
      companyId: companyId!,
      userId: userId!,
      fileName: (file as File).name || 'receipt',
      mimeType: (file as File).type || 'application/octet-stream',
      buffer,
    });

    await auditLog(companyId!, userId!, 'receipt.create', 'receipt', receipt.id, {
      fileName: receipt.originalFileName,
      ocrStatus: receipt.ocrStatus,
    } as any);

    const transactionId = form.get('transactionId');
    if (typeof transactionId === 'string' && transactionId) {
      const attached = await attachReceipt({ companyId: companyId!, receiptId: receipt.id, transactionId });
      return NextResponse.json({ data: attached }, { status: 201 });
    }

    return NextResponse.json({ data: { receipt } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/receipts error:', err);
    const status = /empty|5 MB|supported|HEIC|Most Compatible/i.test(err?.message ?? '') ? 400 : 500;
    return NextResponse.json({ error: err.message || 'Failed to upload receipt' }, { status });
  }
}
