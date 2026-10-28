import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { attachReceipt } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts/[id]/attach { transactionId } — link the receipt to a
 * bank transaction of the same company. Returns the receipt and, when a
 * category is known, the suggestedSplit the UI passes to the existing
 * POST /api/bank-transactions/[id]/split endpoint to categorize the row.
 * Attaching alone changes nothing in the GL.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : null;
    if (!transactionId) return NextResponse.json({ error: 'transactionId is required.' }, { status: 400 });

    const result = await attachReceipt({ companyId: companyId!, receiptId: params.id, transactionId });
    if (!result) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    await auditLog(companyId!, userId!, 'receipt.attach', 'receipt', params.id, { transactionId } as any);
    return NextResponse.json({ data: result });
  } catch (err: any) {
    console.error('POST /api/receipts/[id]/attach error:', err);
    const status = /already attached|not found/i.test(err?.message ?? '') ? 409 : 500;
    return NextResponse.json({ error: err.message || 'Failed to attach receipt' }, { status });
  }
}
