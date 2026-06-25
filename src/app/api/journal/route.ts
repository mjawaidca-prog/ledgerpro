import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { postJournalEntry } from '@/lib/journal';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { entryDate, description, lines, companyId } = body as {
      entryDate: string;
      description: string;
      lines: { glAccountCode: string; description?: string; debit: number; credit: number }[];
      companyId?: string;
    };

    if (!entryDate || !description || !lines?.length) {
      return NextResponse.json({ error: 'Date, description, and at least one line are required' }, { status: 400 });
    }

    if (lines.length < 2) {
      return NextResponse.json({ error: 'Journal entry must have at least 2 lines (debit and credit)' }, { status: 400 });
    }

    // Get companyId from the first company if not provided
    let cid = companyId;
    if (!cid) {
      const company = await db.company.findFirst();
      if (!company) return NextResponse.json({ error: 'No company found' }, { status: 400 });
      cid = company.id;
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
      cid
    );

    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/journal error:', error);
    return NextResponse.json({ error: error.message || 'Failed to post journal entry' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '20');

    const [entries, total] = await Promise.all([
      db.journalEntry.findMany({
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lines: {
            select: { glAccountCode: true, description: true, debit: true, credit: true },
          },
        },
      }),
      db.journalEntry.count(),
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
