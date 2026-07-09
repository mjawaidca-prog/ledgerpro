import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

/**
 * GET /api/repair/fix-credit-card-signs
 *
 * Preview: shows credit card transactions from import batches created before
 * the signMultiplier fix (July 1, 2026) that may have incorrect amount signs.
 *
 * The old import flow applied signMultiplier = -1 for credit-card accounts on
 * the server side. That multiplier was removed when the frontend took over sign
 * direction (BUG-8 fix, July 2026). Transactions imported before that date may
 * have the wrong sign — flipping them corrects the amounts.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    // Cutoff: July 1, 2026 — date the signMultiplier was removed (BUG-1 fix batch)
    const fixCutoff = new Date('2026-07-01T00:00:00.000Z');

    // Find credit card accounts
    const ccAccounts = await db.financialAccount.findMany({
      where: { companyId, kind: 'creditcard', isActive: true },
      select: { id: true, name: true, currentBalance: true, glAccountCode: true },
    });

    if (ccAccounts.length === 0) {
      return NextResponse.json({
        data: { message: 'No credit card accounts found for this company.', affectedCount: 0, batches: [] },
      });
    }

    const ccAccountIds = ccAccounts.map((a) => a.id);

    // Find import batches for credit card accounts created BEFORE the fix
    const oldBatches = await db.importBatch.findMany({
      where: {
        financialAccountId: { in: ccAccountIds },
        createdAt: { lt: fixCutoff },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    if (oldBatches.length === 0) {
      return NextResponse.json({
        data: {
          message: 'No old import batches found for credit card accounts.',
          affectedCount: 0,
          batches: [],
        },
      });
    }

    // Count affected transactions
    let totalAffected = 0;
    const batches = [];

    for (const batch of oldBatches) {
      const txns = await db.transaction.findMany({
        where: { importBatchId: batch.id },
        select: {
          id: true,
          date: true,
          description: true,
          amount: true,
          status: true,
        },
      });

      if (txns.length === 0) continue;

      // Only count transactions where flipping would change the sign meaningfully
      const affected = txns.filter((t) => {
        const amt = Number(t.amount);
        return Math.abs(amt) > 0.01;
      });

      const account = ccAccounts.find((a) => a.id === batch.financialAccountId);

      batches.push({
        batchId: batch.id,
        fileName: batch.fileName,
        fileType: batch.fileType,
        createdAt: batch.createdAt,
        accountName: account?.name || 'Unknown',
        totalTransactions: txns.length,
        affectedCount: affected.length,
        postedCount: affected.filter((t) => t.status === 'reconciled' || t.status === 'voided').length,
        sampleTransactions: affected.slice(0, 5).map((t) => ({
          id: t.id,
          date: t.date,
          description: t.description,
          currentAmount: Number(t.amount),
          fixedAmount: -Number(t.amount),
          status: t.status,
        })),
        totalAmountAdjustment: Math.round(
          affected.reduce((sum, t) => sum + -2 * Number(t.amount), 0) * 100
        ) / 100,
      });

      totalAffected += affected.length;
    }

    return NextResponse.json({
      data: {
        message:
          totalAffected > 0
            ? `Found ${totalAffected} credit card transactions across ${batches.length} import batches that may have incorrect signs.`
            : 'No affected transactions found.',
        affectedCount: totalAffected,
        batches,
        hint: 'POST to this endpoint with { confirm: true } to apply the fix. This flips the amount sign for affected transactions and adjusts account balances. Posted (reconciled) transactions will be excluded from auto-fix and require manual review.',
      },
    });
  } catch (error) {
    console.error('GET /api/repair/fix-credit-card-signs error:', error);
    return NextResponse.json({ error: 'Failed to analyze credit card transactions' }, { status: 500 });
  }
}

/**
 * POST /api/repair/fix-credit-card-signs
 *
 * Apply the sign fix: flips amount signs for affected credit card transactions
 * from old import batches and adjusts account balances.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { confirm, batchIds } = body;

    if (!confirm) {
      return NextResponse.json(
        { error: 'Set { confirm: true } to apply the fix. Use GET first to preview affected transactions.' },
        { status: 400 }
      );
    }

    const fixCutoff = new Date('2026-07-01T00:00:00.000Z');

    // Find credit card accounts
    const ccAccounts = await db.financialAccount.findMany({
      where: { companyId, kind: 'creditcard', isActive: true },
      select: { id: true, name: true, glAccountCode: true },
    });

    if (ccAccounts.length === 0) {
      return NextResponse.json({ data: { message: 'No credit card accounts found.' } });
    }

    const ccAccountIds = ccAccounts.map((a) => a.id);

    // Find old import batches (optionally filtered by batchIds)
    const batchWhere: any = {
      financialAccountId: { in: ccAccountIds },
      createdAt: { lt: fixCutoff },
    };
    if (batchIds && Array.isArray(batchIds) && batchIds.length > 0) {
      batchWhere.id = { in: batchIds };
    }

    const oldBatches = await db.importBatch.findMany({
      where: batchWhere,
      select: { id: true, financialAccountId: true },
    });

    if (oldBatches.length === 0) {
      return NextResponse.json({ data: { message: 'No old batches to fix.' } });
    }

    let fixedCount = 0;
    let skippedCount = 0;
    const balanceAdjustments: Record<string, number> = {};
    const coaAdjustments: Record<string, number> = {};

    for (const batch of oldBatches) {
      // Only fix non-posted transactions — reconciled/voided need manual review
      const txns = await db.transaction.findMany({
        where: {
          importBatchId: batch.id,
          status: { notIn: ['reconciled', 'voided'] },
        },
        select: { id: true, amount: true },
      });

      const account = ccAccounts.find((a) => a.id === batch.financialAccountId);

      for (const tx of txns) {
        const oldAmount = Number(tx.amount);
        if (Math.abs(oldAmount) < 0.01) {
          skippedCount++;
          continue;
        }

        const newAmount = -oldAmount;
        const diff = newAmount - oldAmount; // e.g. -100 → +100, diff = +200

        // Flip the transaction amount
        await db.transaction.update({
          where: { id: tx.id },
          data: { amount: newAmount },
        });

        // Track balance adjustment for this account
        const glCode = account?.glAccountCode;
        if (glCode) {
          balanceAdjustments[glCode] = (balanceAdjustments[glCode] || 0) + diff;
          coaAdjustments[glCode] = (coaAdjustments[glCode] || 0) + diff;
        }

        fixedCount++;
      }
    }

    // Apply financial account balance adjustments
    for (const [glCode, adj] of Object.entries(balanceAdjustments)) {
      await db.financialAccount.updateMany({
        where: { glAccountCode: glCode, companyId },
        data: { currentBalance: { increment: adj } },
      });

      // Also update the linked COA account
      await db.chartOfAccount.updateMany({
        where: { code: glCode, companyId },
        data: { balance: { increment: adj } },
      });
    }

    return NextResponse.json({
      data: {
        message: `Fixed ${fixedCount} credit card transactions across ${oldBatches.length} import batches. Skipped ${skippedCount} zero-amount transactions.`,
        fixedCount,
        skippedCount,
        batchesProcessed: oldBatches.length,
        balanceAdjustments: Object.fromEntries(
          Object.entries(balanceAdjustments).map(([code, adj]) => [code, Math.round(adj * 100) / 100])
        ),
        warning:
          'Transactions with status "reconciled" or "voided" were skipped — review these manually. Their journal entries may also need correction.',
      },
    });
  } catch (error) {
    console.error('POST /api/repair/fix-credit-card-signs error:', error);
    return NextResponse.json({ error: 'Failed to fix credit card transactions' }, { status: 500 });
  }
}
