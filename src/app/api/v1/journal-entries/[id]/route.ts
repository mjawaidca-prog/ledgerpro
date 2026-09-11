import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { moneyString, isoDate } from '@/lib/api/serialize';
export const dynamic = 'force-dynamic';

// GET /api/v1/journal-entries/[id] — one entry with GL lines, scoped to the
// key's company (foreign ids resolve to 404).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const entry = await db.journalEntry.findFirst({
    where: { id: params.id, companyId: context!.companyId },
    include: { lines: true },
  });

  if (!entry) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Journal entry not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      id: entry.id,
      entryDate: isoDate(entry.entryDate),
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      voidedAt: isoDate(entry.voidedAt),
      reversalOfId: entry.reversalOfId,
      createdAt: isoDate(entry.createdAt),
      lines: entry.lines.map((l) => ({
        id: l.id,
        glAccountCode: l.glAccountCode,
        description: l.description,
        debit: moneyString(l.debit),
        credit: moneyString(l.credit),
        currency: l.currency,
        fxRate: l.fxRate === null ? null : moneyString(l.fxRate, 8),
        debitForeign: l.debitForeign === null ? null : moneyString(l.debitForeign),
        creditForeign: l.creditForeign === null ? null : moneyString(l.creditForeign),
      })),
    },
  });
}
