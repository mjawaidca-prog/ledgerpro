import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createDraftExpenseFromReceipt } from '@/lib/receipts/draft';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts/[id]/create-draft — build a DRAFT expense (Bill,
 * kind='expense', status='draft') from this receipt's AI extraction:
 * vendor, date, total and tax split pre-filled, the suggested category
 * on its lines, and the source document linked. Nothing is posted —
 * the reviewer opens the draft in Expenses, adjusts it, and posts it
 * through the bills flow like any other draft.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const result = await createDraftExpenseFromReceipt({ companyId: companyId!, receiptId: params.id });
    if (!result) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    await auditLog(companyId!, userId!, 'receipt.create_draft', 'receipt', params.id, {
      billId: result.billId,
      total: result.total,
      currency: result.currency,
    } as any);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/receipts/[id]/create-draft error:', err);
    const message = err?.message ?? '';
    const status = /already created/i.test(message)
      ? 409
      : /not found/i.test(message)
        ? 404
        : /AI read|vendor|total|date|closed period/i.test(message)
          ? 400
          : 500;
    return NextResponse.json({ error: message || 'Failed to create the draft expense' }, { status });
  }
}
