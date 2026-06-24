import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { categoryId, status, matchRef } = body;

    const existing = await db.transaction.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const updateData: any = {};
    if (categoryId !== undefined) {
      updateData.categoryId = categoryId;
      updateData.status = 'categorized';
    }
    if (status) updateData.status = status;
    if (matchRef !== undefined) updateData.matchRef = matchRef;

    const tx = await db.transaction.update({
      where: { id: params.id },
      data: updateData,
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, code: true, name: true } },
      },
    });

    return NextResponse.json({ data: tx });
  } catch (error) {
    console.error('PUT /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}
