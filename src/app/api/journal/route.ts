import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { postJournalEntry } from '@/lib/journal';

export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
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
