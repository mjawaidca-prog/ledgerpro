import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { runReceiptExtraction } from '@/lib/receipts/extraction-pipeline';
import { getReceipt } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts/[id]/extract — (re-)run the AI document read on a
 * stored receipt: for receipts uploaded before a provider was
 * configured, and to retry a failed read. The outcome lands on the
 * receipt row (extracted | failed | unavailable); the response is the
 * refreshed receipt either way — a failed read is a state, not a
 * request error.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await getReceipt(companyId!, params.id);
    if (!existing) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    const result = await runReceiptExtraction({ companyId: companyId!, receiptId: params.id });

    await auditLog(companyId!, userId!, 'receipt.extract', 'receipt', params.id, {
      status: result.status,
      provider: result.providerId,
    } as any);

    const receipt = await getReceipt(companyId!, params.id);
    return NextResponse.json({ data: { receipt, extraction: result } });
  } catch (err: any) {
    console.error('POST /api/receipts/[id]/extract error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to run the AI read' }, { status: 500 });
  }
}
