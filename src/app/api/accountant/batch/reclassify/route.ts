import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const { transactionIds, categoryId } = body as { transactionIds: string[]; categoryId: string };

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json({ error: 'transactionIds array is required' }, { status: 400 });
    }
    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
    }

    // Verify category exists
    const cat = await db.chartOfAccount.findFirst({
      where: { id: categoryId, companyId },
    });
    if (!cat) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    // Batch update
    const result = await db.transaction.updateMany({
      where: { id: { in: transactionIds }, companyId },
      data: { categoryId, status: 'categorized' },
    });

    await auditLog(companyId, userId, 'transaction.batch_reclassify', 'transaction', undefined, {
      transactionIds,
      categoryId,
      categoryName: cat.name,
      count: result.count,
    });

    return NextResponse.json({ data: { reclassifiedCount: result.count } });
  } catch (error) {
    console.error('POST /api/accountant/batch/reclassify error:', error);
    return NextResponse.json({ error: 'Batch reclassify failed' }, { status: 500 });
  }
}
