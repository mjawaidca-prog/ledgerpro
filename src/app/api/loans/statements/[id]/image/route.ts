import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getLoanStatementImage } from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/loans/statements/[id]/image — the stored statement file,
 * served only to a member of the owning company (requireCompany is
 * the tenant boundary), so the reviewer can read the paper beside
 * the AI's read of it.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const image = await getLoanStatementImage(companyId!, params.id);
    if (!image) return NextResponse.json({ error: 'Statement image not found.' }, { status: 404 });

    return new NextResponse(image.buffer as any, {
      headers: {
        'Content-Type': image.mimeType,
        'Content-Disposition': `inline; filename="${image.fileName.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err: any) {
    console.error('GET /api/loans/statements/[id]/image error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load statement image' }, { status: 500 });
  }
}
