import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createExpenseFromReceipt } from '@/lib/receipts/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts/[id]/create-expense { paidFrom } — record the
 * receipt as a new expense when there is no bank transaction to attach
 * it to (cash purchases). `paidFrom` is a financial account id, or
 * 'cash' (the default) for the company's Cash account, created on
 * first use. Creates the transaction, attaches the receipt and applies
 * the suggested category split — unposted; posting stays in Banking.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const paidFrom = typeof body.paidFrom === 'string' && body.paidFrom ? body.paidFrom : 'cash';

    const result = await createExpenseFromReceipt({ companyId: companyId!, receiptId: params.id, paidFrom });
    if (!result) return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });

    await auditLog(companyId!, userId!, 'receipt.create_expense', 'receipt', params.id, {
      transactionId: result.transactionId,
      accountId: result.accountId,
      accountKind: result.accountKind,
    } as any);
    return NextResponse.json({ data: result });
  } catch (err: any) {
    console.error('POST /api/receipts/[id]/create-expense error:', err);
    const message = err?.message ?? '';
    const status = /already attached/i.test(message)
      ? 409
      : /not found/i.test(message)
        ? 404
        : /total|date|closed period|locked/i.test(message)
          ? 400
          : 500;
    return NextResponse.json({ error: message || 'Failed to create the expense' }, { status });
  }
}
