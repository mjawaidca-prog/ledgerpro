import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { getReceipt, updateReceiptSuggestion } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/** GET /api/receipts/[id] — one receipt's metadata + suggestion fields. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    const receipt = await getReceipt(companyId!, params.id);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });
    return NextResponse.json({ data: receipt });
  } catch (err: any) {
    console.error('GET /api/receipts/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load receipt' }, { status: 500 });
  }
}

/**
 * PATCH /api/receipts/[id] — the human confirmation step: edit the
 * OCR-suggested merchant / date / total / tax, or set the category.
 * Edits change suggestion fields only; nothing posts from here.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const patch: Parameters<typeof updateReceiptSuggestion>[2] = {};
    if (body.merchant !== undefined) patch.merchant = body.merchant === null ? null : String(body.merchant);
    if (body.date !== undefined) patch.date = body.date === null ? null : String(body.date);
    if (body.total !== undefined) patch.total = body.total === null ? null : Number(body.total);
    if (body.taxAmount !== undefined) patch.taxAmount = body.taxAmount === null ? null : Number(body.taxAmount);
    if (body.categoryId !== undefined) patch.categoryId = body.categoryId === null ? null : String(body.categoryId);

    const receipt = await updateReceiptSuggestion(companyId!, params.id, patch);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    await auditLog(companyId!, userId!, 'receipt.update', 'receipt', params.id, patch as any);
    return NextResponse.json({ data: receipt });
  } catch (err: any) {
    console.error('PATCH /api/receipts/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update receipt' }, { status: 500 });
  }
}

/**
 * DELETE /api/receipts/[id] — hard-delete an UNATTACHED receipt (and its
 * stored bytes). Attached receipts are audit evidence: detach first.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const receipt = await (db as any).receipt.findFirst({
      where: { id: params.id, companyId },
      select: { id: true, status: true, transactionId: true },
    });
    if (!receipt) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });
    if (receipt.transactionId) {
      return NextResponse.json(
        { error: 'This receipt is attached to a transaction. Detach it before deleting — attached receipts are audit evidence.' },
        { status: 409 },
      );
    }

    await (db as any).receipt.delete({ where: { id: params.id } });
    await auditLog(companyId!, userId!, 'receipt.delete', 'receipt', params.id, {} as any);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err: any) {
    console.error('DELETE /api/receipts/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete receipt' }, { status: 500 });
  }
}
