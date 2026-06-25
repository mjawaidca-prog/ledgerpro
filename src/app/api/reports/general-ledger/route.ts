import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

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
      ? await db.chartOfAccount.findFirst({ where: { code, companyId } })
      : null;

    // Get ALL journal lines before endDate for this account to compute running balance
    const allLinesWhere: any = {
      journalEntry: { entryDate: { lte: end }, companyId },
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
          journalEntry: { companyId },
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
            where: { journalEntryId: { in: entryIds }, journalEntry: { companyId } },
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

    function sourceLink(sourceType: string, sourceId: string | null, journalEntryId: string): string | null {
      // For all types, the journal entry itself is always linkable
      if (sourceType === 'manual') return `/journal/${journalEntryId}`;
      if (!sourceId) return `/journal/${journalEntryId}`; // fallback: link to journal entry
      switch (sourceType) {
        case 'invoice': return `/invoices/${sourceId}`;
        case 'bill': return `/expenses/${sourceId}`;
        case 'payment': return sourceId.startsWith('BILL') ? `/expenses/${sourceId}` : `/invoices/${sourceId}`;
        case 'transfer': return `/journal/${journalEntryId}`;
        default: return `/journal/${journalEntryId}`;
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
        sourceLink: sourceLink(entry.sourceType, entry.sourceId, entry.id),
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

    // When viewing ALL accounts (no code filter), group by GL account
    let grouped: any[] | null = null;
    if (!code) {
      // Get all unique account codes in this period
      const allCodes = [...new Set(periodLines.map((l) => l.glAccountCode))];
      const allAccounts = await db.chartOfAccount.findMany({
        where: { code: { in: allCodes }, companyId },
        select: { code: true, name: true, type: true },
      });
      const acctMap = new Map(allAccounts.map((a) => [a.code, a]));

      // Group lines by account code
      const groups: Record<string, { lines: typeof periodLines; totalDebit: number; totalCredit: number }> = {};
      for (const line of periodLines) {
        if (!groups[line.glAccountCode]) groups[line.glAccountCode] = { lines: [], totalDebit: 0, totalCredit: 0 };
        groups[line.glAccountCode].lines.push(line);
        groups[line.glAccountCode].totalDebit += Number(line.debit);
        groups[line.glAccountCode].totalCredit += Number(line.credit);
      }

      grouped = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([glCode, g]) => {
          const acct = acctMap.get(glCode);
          const net = g.totalDebit - g.totalCredit;
          const acctType = acct?.type || 'expense';
          const balanceEffect = (acctType === 'asset' || acctType === 'expense') ? net : -net;
          return {
            glAccountCode: glCode,
            accountName: acct?.name || glCode,
            accountType: acctType,
            entryCount: g.lines.length,
            totalDebit: Math.round(g.totalDebit * 100) / 100,
            totalCredit: Math.round(g.totalCredit * 100) / 100,
            netChange: Math.round(balanceEffect * 100) / 100,
            link: `/reports/general-ledger?code=${glCode}&name=${encodeURIComponent(acct?.name || '')}`,
          };
        });
    }

    return NextResponse.json({
      data: {
        account: account ? { code: account.code, name: account.name, type: account.type } : null,
        period: { startDate, endDate },
        balances: {
          opening: Math.round(openingBalance * 100) / 100,
          closing: closingBalance,
        },
        rows: code ? rows : [],
        grouped: code ? null : grouped,
        totals: { debits: totalDebits, credits: totalCredits },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/general-ledger error:', error);
    return NextResponse.json({ error: 'Failed to generate general ledger' }, { status: 500 });
  }
}
