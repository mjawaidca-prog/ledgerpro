import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET /api/reconciliation/[id] — get a single transaction's reconciliation status
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const tx = await db.transaction.findUnique({
      where: { id: params.id },
      include: {
        account: { select: { id: true, name: true, kind: true, mask: true } },
        category: { select: { code: true, name: true } },
        importBatch: { select: { id: true, fileName: true, fileType: true } },
        transferMatch: {
          include: {
            outflowTx: {
              select: { id: true, date: true, description: true, amount: true, financialAccountId: true },
            },
            inflowTx: {
              select: { id: true, date: true, description: true, amount: true, financialAccountId: true },
            },
          },
        },
      },
    });

    if (!tx || tx.companyId !== companyId) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        id: tx.id,
        date: tx.date,
        description: tx.description,
        merchant: tx.merchant,
        amount: Number(tx.amount),
        status: tx.status,
        reconciledAt: tx.reconciledAt,
        reconciledBy: tx.reconciledBy,
        account: tx.account,
        category: tx.category,
        importBatch: tx.importBatch,
        transferMatch: tx.transferMatch
          ? {
              id: tx.transferMatch.id,
              amount: Number(tx.transferMatch.amount),
              confirmed: tx.transferMatch.confirmed,
              matchDate: tx.transferMatch.matchDate,
              outflow: tx.transferMatch.outflowTx,
              inflow: tx.transferMatch.inflowTx,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('GET /api/reconciliation/[id] error:', error);
    return NextResponse.json({ error: 'Failed to load reconciliation' }, { status: 500 });
  }
}

// PUT /api/reconciliation/[id] — un-reconcile or update reconciliation of a transaction
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const { action, categoryId, status } = body;
    // action can be: "unreconcile" | "reclassify"
    // status can be: "reconciled" | "categorized" | "toreview" | "excluded"

    const tx = await db.transaction.findUnique({ where: { id: params.id } });
    if (!tx || tx.companyId !== companyId) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const updateData: any = {};

    if (action === 'unreconcile') {
      updateData.reconciledAt = null;
      updateData.reconciledBy = null;
      updateData.status = status || 'categorized';
    } else if (action === 'reclassify') {
      if (categoryId) {
        updateData.categoryId = categoryId;
        updateData.status = 'categorized';
      }
      if (status) {
        updateData.status = status;
      }
    } else if (status) {
      // Direct status update
      updateData.status = status;
      if (status === 'reconciled' && !tx.reconciledAt) {
        updateData.reconciledAt = new Date();
        updateData.reconciledBy = userId;
      }
      if (status !== 'reconciled') {
        updateData.reconciledAt = null;
        updateData.reconciledBy = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    const updated = await db.transaction.update({
      where: { id: params.id },
      data: updateData,
    });

    await auditLog(companyId, userId, 'transaction.update', 'transaction', params.id, { before: tx, after: updated });

    return NextResponse.json({
      data: {
        id: updated.id,
        status: updated.status,
        reconciledAt: updated.reconciledAt,
        categoryId: updated.categoryId,
      },
    });
  } catch (error) {
    console.error('PUT /api/reconciliation/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update reconciliation' }, { status: 500 });
  }
}
