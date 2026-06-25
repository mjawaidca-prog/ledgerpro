import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const startDate = searchParams.get('start') ?? '2026-01-01';
    const endDate = searchParams.get('end') ?? new Date().toISOString().slice(0, 10);
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '100');

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // end of day

    // Get account info
    const account = code
      ? await db.chartOfAccount.findFirst({ where: { code } })
      : null;

    // Get ALL journal lines before endDate for this account to compute running balance
    const allLinesWhere: any = {
      journalEntry: { entryDate: { lte: end } },
    };
    if (code) allLinesWhere.glAccountCode = code;

    const allLines = await db.journalLine.findMany({
      where: allLinesWhere,
      include: { journalEntry: { select: { entryDate: true } } },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    });

    // Compute opening balance (all entries before startDate)
    let openingBalance = 0;
    const accountType = account?.type;
    for (const line of allLines) {
      const entryDate = new Date(line.journalEntry.entryDate);
      if (entryDate < start) {
        if (accountType === 'asset' || accountType === 'expense') {
          openingBalance += Number(line.debit) - Number(line.credit);
        } else {
          openingBalance += Number(line.credit) - Number(line.debit);
        }
      }
    }

    // Get journal lines for the selected period
    const periodLines = allLines.filter((l) => {
      const d = new Date(l.journalEntry.entryDate);
      return d >= start && d <= end;
    });

    // Get full entry details for period lines
    const entryIds = [...new Set(periodLines.map((l) => l.journalEntryId))];

    const [detailedLines, allEntryLines] = await Promise.all([
      db.journalLine.findMany({
        where: {
          journalEntryId: { in: entryIds },
          ...(code ? { glAccountCode: code } : {}),
        },
        include: {
          journalEntry: {
            select: { id: true, entryDate: true, description: true, sourceType: true, sourceId: true },
          },
        },
        orderBy: { journalEntry: { entryDate: 'desc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      entryIds.length > 0
        ? db.journalLine.findMany({
            where: { journalEntryId: { in: entryIds } },
            select: { journalEntryId: true, glAccountCode: true, description: true, debit: true, credit: true },
          })
        : [],
    ]);

    // Build contra lookup
    const contraByEntry: Record<string, { code: string; description: string | null; debit: number; credit: number }[]> = {};
    for (const l of allEntryLines) {
      if (!contraByEntry[l.journalEntryId]) contraByEntry[l.journalEntryId] = [];
      contraByEntry[l.journalEntryId].push({
        code: l.glAccountCode,
        description: l.description,
        debit: Number(l.debit),
        credit: Number(l.credit),
      });
    }

    function sourceLink(sourceType: string, sourceId: string | null): string | null {
      if (!sourceId) return null;
      switch (sourceType) {
        case 'invoice': return `/invoices/${sourceId}`;
        case 'bill': return `/expenses/${sourceId}`;
        case 'payment': return sourceId?.startsWith('BILL') ? `/expenses/${sourceId}` : `/invoices/${sourceId}`;
        case 'transfer': return null;
        case 'manual': return null;
        default: return null;
      }
    }

    // Build rows with running balance
    let runningBalance = openingBalance;
    const rows = detailedLines.map((line) => {
      const entry = line.journalEntry;
      const contras = (contraByEntry[line.journalEntryId] || [])
        .filter((c) => c.code !== line.glAccountCode);

      const netEffect = accountType === 'asset' || accountType === 'expense'
        ? Number(line.debit) - Number(line.credit)
        : Number(line.credit) - Number(line.debit);

      runningBalance += netEffect;

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
        balance: Math.round(runningBalance * 100) / 100,
        contraAccounts: contras
          .filter((c) => c.code !== line.glAccountCode)
          .slice(0, 3)
          .map((c) => ({
            code: c.code,
            description: c.description,
            debit: c.debit,
            credit: c.credit,
            link: `/reports/general-ledger?code=${c.code}`,
          })),
      };
    });

    const totalDebits = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
    const totalCredits = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
    const closingBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance;
    const total = periodLines.length;

    return NextResponse.json({
      data: {
        account: account ? { code: account.code, name: account.name, type: account.type } : null,
        period: { startDate, endDate },
        balances: {
          opening: Math.round(openingBalance * 100) / 100,
          closing: closingBalance,
        },
        rows,
        totals: { debits: totalDebits, credits: totalCredits },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/general-ledger error:', error);
    return NextResponse.json({ error: 'Failed to generate general ledger' }, { status: 500 });
  }
}
