import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getReceiptImage } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/receipts/[id]/image — the stored receipt file, served only to a
 * member of the owning company (requireCompany is the tenant boundary).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const image = await getReceiptImage(companyId!, params.id);
    if (!image) return NextResponse.json({ error: 'Receipt image not found.' }, { status: 404 });

    return new NextResponse(image.buffer as any, {
      headers: {
        'Content-Type': image.mimeType,
        'Content-Disposition': `inline; filename="${image.fileName.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('GET /api/receipts/[id]/image error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load receipt image' }, { status: 500 });
  }
}
