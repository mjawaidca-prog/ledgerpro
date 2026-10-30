import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/api-helpers';
import {
  createReceiptFromUpload,
  resolveReceiptUploadLink,
  recordReceiptUploadUse,
} from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

const LINK_DEAD = 'This link has expired or is no longer valid. Open Receipts on your computer and choose “Add from phone” to get a new one.';

/**
 * The phone side of "Add from phone" — no session; the link token is
 * the credential. It can ONLY add receipts to the one company the
 * link was minted for.
 *
 * GET  ?token=…          → { companyName, expiresAt } for the capture page
 * POST multipart { token, file, extractedText? } → the stored receipt
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') ?? '';
    const link = await resolveReceiptUploadLink(token);
    if (!link) return NextResponse.json({ error: LINK_DEAD }, { status: 401 });
    return NextResponse.json({
      data: { companyName: link.company?.name ?? 'your company', expiresAt: link.expiresAt },
    });
  } catch (err: any) {
    console.error('GET /api/receipts/phone-upload error:', err);
    return NextResponse.json({ error: 'Something went wrong. Try the link again.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const token = String(form.get('token') ?? '');
    const link = await resolveReceiptUploadLink(token);
    if (!link) return NextResponse.json({ error: LINK_DEAD }, { status: 401 });

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a photo or PDF first.' }, { status: 400 });
    }
    const extractedTextRaw = form.get('extractedText');
    const providedText =
      typeof extractedTextRaw === 'string' && extractedTextRaw.trim()
        ? extractedTextRaw.slice(0, 20_000)
        : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const receipt = await createReceiptFromUpload({
      companyId: link.companyId,
      userId: link.userId,
      fileName: file.name || 'phone-receipt.jpg',
      mimeType: file.type || 'application/octet-stream',
      buffer,
      providedText,
    });
    await recordReceiptUploadUse(link.id);
    await auditLog(link.companyId, link.userId, 'receipt.phone_upload', 'receipt', receipt.id, {} as any);
    return NextResponse.json({ data: { receipt } }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/receipts/phone-upload error:', err);
    // Upload validation errors (type/size) are user-actionable; show them.
    const message = err?.message ?? '';
    const status = /MB|JPEG|PNG|WebP|PDF|HEIC|Most Compatible/i.test(message) ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? message : 'Upload failed. Check your connection and try again.' },
      { status },
    );
  }
}
