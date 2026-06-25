import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code'); // GL account code
    const startDate = searchParams.get('start') ?? '2026-01-01';
    const endDate = searchParams.get('end') ?? '2026-12-31';
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '50');

    const where: any = {
      journalEntry: {
        entryDate: { gte: new Date(startDate), lte: new Date(endDate) },
      },
    };

    if (code) {
      where.glAccountCode = code;
    }

    // Get the account info
    const account = code
      ? await db.chartOfAccount.findFirst({ where: { code } })
      : null;

    // Get total count
    const total = await db.journalLine.count({ where });

    // Get journal lines for this GL account
    const lines = await db.journalLine.findMany({
      where,
      include: {
        journalEntry: {
          select: {
            id: true,
            entryDate: true,
            description: true,
            sourceType: true,
            sourceId: true,
          },
        },
      },
      orderBy: { journalEntry: { entryDate: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    // For each journal entry, get the contra lines (other legs of same entry)
    const entryIds = [...new Set(lines.map((l) => l.journalEntryId))];
    const allEntryLines = entryIds.length > 0
      ? await db.journalLine.findMany({
          where: { journalEntryId: { in: entryIds } },
          include: {
            journalEntry: {
              select: { id: true, sourceType: true, sourceId: true },
            },
          },
        })
      : [];

    // Map entry ID → contra lines
    const contraByEntry: Record<string, { code: string; description: string | null; debit: number; credit: number }[]> = {};
    for (const line of allEntryLines) {
      if (!contraByEntry[line.journalEntryId]) contraByEntry[line.journalEntryId] = [];
      contraByEntry[line.journalEntryId].push({
        code: line.glAccountCode,
        description: line.description,
        debit: Number(line.debit),
        credit: Number(line.credit),
      });
    }

    // Resolve source document links
    function sourceLink(sourceType: string, sourceId: string | null): string | null {
      if (!sourceId) return null;
      switch (sourceType) {
        case 'invoice': return `/invoices/${sourceId}`;
        case 'bill': return `/expenses/${sourceId}`;
        case 'payment': return null;
        case 'transfer': return null;
        case 'manual': return null;
        default: return null;
      }
    }

    const rows = lines.map((line) => {
      const entry = line.journalEntry;
      const contras = (contraByEntry[line.journalEntryId] || [])
        .filter((c) => c.code !== line.glAccountCode);

      return {
        id: line.id,
        date: entry.entryDate,
        description: line.description || entry.description,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceLink: sourceLink(entry.sourceType, entry.sourceId),
        debit: Number(line.debit),
        credit: Number(line.credit),
        glAccountCode: line.glAccountCode,
        contraAccounts: contras.map((c) => ({
          code: c.code,
          description: c.description,
          debit: c.debit,
          credit: c.credit,
          link: `/reports/general-ledger?code=${c.code}`,
        })),
      };
    });

    // Running balance
    let runningBalance = account ? Number(account.balance) : 0;
    const rowsWithBalance = rows.reverse().map((row) => {
      if (account) {
        if (account.type === 'asset' || account.type === 'expense') {
          runningBalance = runningBalance - row.credit + row.debit;
        } else {
          runningBalance = runningBalance + row.credit - row.debit;
        }
      }
      return { ...row, balance: Math.round(runningBalance * 100) / 100 };
    }).reverse();

    // Totals
    const totalDebits = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
    const totalCredits = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;

    return NextResponse.json({
      data: {
        account: account ? {
          code: account.code,
          name: account.name,
          type: account.type,
          balance: Number(account.balance),
        } : null,
        period: { startDate, endDate },
        rows: rowsWithBalance,
        totals: { debits: totalDebits, credits: totalCredits },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/general-ledger error:', error);
    return NextResponse.json({ error: 'Failed to generate general ledger' }, { status: 500 });
  }
}
