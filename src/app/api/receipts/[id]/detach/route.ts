import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { detachReceipt } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/** POST /api/receipts/[id]/detach — unlink from its transaction, back to the inbox. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const receipt = await detachReceipt(companyId!, params.id);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    await auditLog(companyId!, userId!, 'receipt.detach', 'receipt', params.id, {} as any);
    return NextResponse.json({ data: receipt });
  } catch (err: any) {
    console.error('POST /api/receipts/[id]/detach error:', err);
    return NextResponse.json({ error: err.message || 'Failed to detach receipt' }, { status: 500 });
  }
}
