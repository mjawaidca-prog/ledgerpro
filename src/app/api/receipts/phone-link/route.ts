import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createReceiptUploadLink } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts/phone-link — mint the "Add from phone" link for
 * the current company. The raw token is returned exactly once (the
 * receipts page renders it as a QR code + copyable link); only its
 * hash is stored. Minting a new link invalidates the previous one.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const link = await createReceiptUploadLink({ companyId: companyId!, userId: userId! });
    await auditLog(companyId!, userId!, 'receipt.phone_link', 'receipt', '', {
      expiresAt: link.expiresAt.toISOString(),
    } as any);
    return NextResponse.json({ data: link });
  } catch (err: any) {
    console.error('POST /api/receipts/phone-link error:', err);
    return NextResponse.json({ error: 'Failed to create the phone link' }, { status: 500 });
  }
}
