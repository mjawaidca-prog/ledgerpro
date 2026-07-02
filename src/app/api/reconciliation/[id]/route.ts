import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { voidJournalEntry, postTransactionToLedger } from '@/lib/journal';
export const dynamic = 'force-dynamic';

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

    const tx = await db.transaction.findUnique({
      where: { id: params.id },
      include: { account: { select: { glAccountCode: true } } },
    });
    if (!tx || tx.companyId !== companyId) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const updateData: any = {};

    if (action === 'unreconcile') {
      if (tx.matchRef) {
        // The transaction was already posted — reverse the posting instead of
        // silently detaching it, otherwise the GL still shows the old entry
        // while the transaction claims to be un-reconciled.
        const guardError = await closedPeriodGuard(companyId, new Date());
        if (guardError) return guardError;
        await voidJournalEntry(tx.matchRef, companyId, userId);
      }
      updateData.reconciledAt = null;
      updateData.reconciledBy = null;
      updateData.matchRef = null;
      updateData.status = status || 'categorized';
    } else if (action === 'reclassify') {
      if (categoryId && categoryId !== tx.categoryId) {
        if (tx.status === 'reconciled' && tx.matchRef) {
          // Already posted to the GL under the old category — void that entry
          // and repost under the new one so the ledger matches what's on screen.
          const category = await db.chartOfAccount.findFirst({ where: { id: categoryId, companyId } });
          if (!category) {
            return NextResponse.json({ error: 'Category not found' }, { status: 400 });
          }

          let entryDate = tx.date;
          if (await closedPeriodGuard(companyId, entryDate)) {
            entryDate = new Date(); // original period is closed — post the correction in the current period
          }
          const guardError = await closedPeriodGuard(companyId, entryDate);
          if (guardError) return guardError;

          const newEntry = await db.$transaction(async (dtx) => {
            await voidJournalEntry(tx.matchRef!, companyId, userId, entryDate, dtx);
            return postTransactionToLedger(
              { id: tx.id, date: tx.date, description: tx.description, amount: Number(tx.amount) },
              tx.account?.glAccountCode ?? undefined,
              category.code,
              companyId,
              entryDate,
              dtx
            );
          });
          updateData.matchRef = newEntry.id;
        }
        updateData.categoryId = categoryId;
        if (tx.status !== 'reconciled') {
          updateData.status = 'categorized';
        }
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
