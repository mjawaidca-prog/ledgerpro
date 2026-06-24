import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { postTransfer } from '@/lib/journal';

/**
 * GET /api/transfers
 * Detects potential transfer pairs across all accounts.
 * Logic from HANDOFF §6.2: outflow on one account ≈ inflow on another, same date ±3 days.
 */
export async function GET() {
  try {
    // Find unmatched outflows (negative amounts, not already in a transfer)
    const outflows = await db.transaction.findMany({
      where: {
        status: { in: ['toreview', 'categorized'] },
        transferMatchId: null,
        amount: { lt: 0 },
      },
      include: {
        account: { select: { id: true, name: true, kind: true } },
      },
    });

    // Find unmatched inflows (positive amounts, not already in a transfer)
    const inflows = await db.transaction.findMany({
      where: {
        status: { in: ['toreview', 'categorized'] },
        transferMatchId: null,
        amount: { gt: 0 },
      },
      include: {
        account: { select: { id: true, name: true, kind: true } },
      },
    });

    const suggestions: {
      outflowTx: typeof outflows[0];
      inflowTx: typeof inflows[0];
      matchedAmount: number;
    }[] = [];

    // Match by amount + date window (±3 days)
    for (const outflow of outflows) {
      for (const inflow of inflows) {
        // Must be on different accounts
        if (outflow.financialAccountId === inflow.financialAccountId) continue;

        const amountMatch = Math.abs(Math.abs(Number(outflow.amount)) - Math.abs(Number(inflow.amount))) < 0.02;
        if (!amountMatch) continue;

        const dayDiff = Math.abs(
          (outflow.date.getTime() - inflow.date.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (dayDiff <= 3) {
          suggestions.push({
            outflowTx: outflow,
            inflowTx: inflow,
            matchedAmount: Math.abs(Number(outflow.amount)),
          });
        }
      }
    }

    return NextResponse.json({ data: suggestions });
  } catch (error) {
    console.error('GET /api/transfers error:', error);
    return NextResponse.json({ error: 'Failed to detect transfers' }, { status: 500 });
  }
}

/**
 * POST /api/transfers
 * Confirm a transfer match: creates a TransferMatch record, updates both transactions,
 * and posts a journal entry for the transfer.
 */
export async function POST(req: NextRequest) {
  try {
    const { outflowTxId, inflowTxId } = await req.json();

    if (!outflowTxId || !inflowTxId) {
      return NextResponse.json(
        { error: 'Both outflowTxId and inflowTxId are required' },
        { status: 400 }
      );
    }

    const [outflow, inflow] = await Promise.all([
      db.transaction.findUnique({ where: { id: outflowTxId } }),
      db.transaction.findUnique({ where: { id: inflowTxId } }),
    ]);

    if (!outflow || !inflow) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Create the transfer match
    const match = await db.transferMatch.create({
      data: {
        companyId: 'default',
        outflowTxId,
        inflowTxId,
        amount: Math.abs(Number(outflow.amount)),
        matchDate: new Date(),
        confirmed: true,
        confirmedAt: new Date(),
      },
    });

    // Update both transactions to status: transfer
    await Promise.all([
      db.transaction.update({
        where: { id: outflowTxId },
        data: { status: 'transfer', transferMatchId: match.id },
      }),
      db.transaction.update({
        where: { id: inflowTxId },
        data: { status: 'transfer', transferMatchId: match.id },
      }),
    ]);

    // Post journal entry for the transfer
    const outflowAccount = await db.financialAccount.findUnique({
      where: { id: outflow.financialAccountId },
    });
    const inflowAccount = await db.financialAccount.findUnique({
      where: { id: inflow.financialAccountId },
    });

    if (outflowAccount?.glAccountCode && inflowAccount?.glAccountCode) {
      const journalEntry = await postTransfer(
        outflowAccount.glAccountCode,  // source (bank — credit)
        inflowAccount.glAccountCode,   // destination (card liability — debit)
        Math.abs(Number(outflow.amount)),
        `Transfer: ${outflow.description} → ${inflow.description}`,
        match.id,
        'default',
      );

      // Link journal entry to transfer match
      await db.transferMatch.update({
        where: { id: match.id },
        data: { journalEntryId: journalEntry.id },
      });
    }

    return NextResponse.json({ data: match }, { status: 201 });
  } catch (error) {
    console.error('POST /api/transfers error:', error);
    return NextResponse.json({ error: 'Failed to create transfer match' }, { status: 500 });
  }
}
