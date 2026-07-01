import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { postJournalEntry } from '@/lib/journal';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { entryDate, description, lines } = body as {
      entryDate: string;
      description: string;
      lines: { glAccountCode: string; description?: string; debit: number; credit: number }[];
    };

    if (!entryDate || !description || !lines?.length) {
      return NextResponse.json({ error: 'Date, description, and at least one line are required' }, { status: 400 });
    }

    if (lines.length < 2) {
      return NextResponse.json({ error: 'Journal entry must have at least 2 lines (debit and credit)' }, { status: 400 });
    }

    // Guard: prevent changes in closed periods
    if (entryDate) {
      const guardError = await closedPeriodGuard(companyId, new Date(entryDate));
      if (guardError) return guardError;
    }

    const entry = await postJournalEntry(
      {
        entryDate: new Date(entryDate),
        description,
        sourceType: 'manual',
        lines: lines.map((l) => ({
          glAccountCode: l.glAccountCode,
          description: l.description,
          debit: l.debit || 0,
          credit: l.credit || 0,
        })),
      },
      companyId
    );

    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/journal error:', error);
    return NextResponse.json({ error: error.message || 'Failed to post journal entry' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '20');

    const [entries, total] = await Promise.all([
      db.journalEntry.findMany({
        where: { companyId },
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lines: {
            select: { glAccountCode: true, description: true, debit: true, credit: true },
          },
        },
      }),
      db.journalEntry.count({ where: { companyId } }),
    ]);

    return NextResponse.json({
      data: entries,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/journal error:', error);
    return NextResponse.json({ error: 'Failed to fetch journal entries' }, { status: 500 });
  }
}

// DELETE — bulk delete all journal entries for the company
export async function DELETE(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get('ids');
    const all = searchParams.get('all');

    const where: any = { companyId };

    if (idsParam) {
      const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length === 0) return NextResponse.json({ error: 'No valid IDs' }, { status: 400 });
      where.id = { in: ids };
    } else if (all !== 'true') {
      return NextResponse.json({ error: 'Use ?all=true to delete all journal entries' }, { status: 400 });
    }

    // Find entries to reverse balances
    const entries = await db.journalEntry.findMany({
      where,
      include: { lines: true },
    });

    if (entries.length === 0) {
      return NextResponse.json({ data: { deleted: 0 } });
    }

    // Reverse COA balances and unlink transactions
    for (const entry of entries) {
      for (const line of entry.lines) {
        const acct = await db.chartOfAccount.findFirst({
          where: { code: line.glAccountCode, companyId },
        });
        if (!acct) continue;
        const net = Number(line.debit) - Number(line.credit);
        const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? -net : net;
        await db.chartOfAccount.update({
          where: { id: acct.id },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
        if (acct.parentCode) {
          await db.chartOfAccount.updateMany({
            where: { code: acct.parentCode, companyId },
            data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
          });
        }
      }

      // Unlink auto-generated entries from transactions
      if (entry.sourceType === 'payment' && entry.sourceId) {
        await db.transaction.updateMany({
          where: { id: entry.sourceId, companyId },
          data: { status: 'categorized', matchRef: null },
        });
      }

      await db.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
    }

    // Delete all matching entries
    const result = await db.journalEntry.deleteMany({ where });

    return NextResponse.json({ data: { deleted: result.count } });
  } catch (error: any) {
    console.error('DELETE /api/journal error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}
