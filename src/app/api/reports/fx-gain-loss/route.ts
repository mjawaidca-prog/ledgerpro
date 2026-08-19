import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { buildFxReport, type FxMovementLine } from '@/lib/fx/gainloss';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/fx-gain-loss?from&to&groupBy=currency|month|contact
 * Realized + unrealized FX movement for the period, plus the largest
 * realized movements with their rate pairs.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const company = await db.company.findUnique({ where: { id: companyId } });
    const home = company?.currency ?? 'CAD';
    const realizedCode = company?.realizedFxAccountCode ?? '4310';
    const unrealizedCode = company?.unrealizedFxAccountCode ?? '4320';

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const [realizedLines, unrealizedLines] = await Promise.all([
      db.journalLine.findMany({
        where: {
          glAccountCode: realizedCode,
          journalEntry: { companyId, voidedAt: null, sourceType: 'payment', entryDate: dateFilter },
        },
        include: { journalEntry: true },
      }),
      db.journalLine.findMany({
        where: {
          glAccountCode: unrealizedCode,
          journalEntry: { companyId, voidedAt: null, sourceType: 'revaluation', entryDate: dateFilter },
        },
        include: { journalEntry: true },
      }),
    ]);

    const build = async (lines: any[], kind: 'realized' | 'unrealized'): Promise<FxMovementLine[]> => {
      const out: FxMovementLine[] = [];
      for (const l of lines) {
        const entry = l.journalEntry;
        const docId = entry.sourceId;
        let fromRate: number | null = null;
        let contactName: string | null = null;
        let amountForeign: number | null = null;
        let description = entry.description;

        if (kind === 'realized' && docId) {
          const doc = await db.invoice.findUnique({ where: { id: docId }, include: { customer: true } }).catch(() => null);
          if (doc) {
            fromRate = doc.fxRate ? Number(doc.fxRate) : null;
            contactName = doc.customer?.companyName || doc.customer?.name || null;
            amountForeign = Number(doc.paidAmount);
            description = `${contactName} — ${amountForeign.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${doc.currency}`;
          } else {
            const bill = await db.bill.findUnique({ where: { id: docId }, include: { vendor: true } }).catch(() => null);
            if (bill) {
              fromRate = bill.fxRate ? Number(bill.fxRate) : null;
              contactName = bill.vendor?.companyName || bill.vendor?.name || null;
              amountForeign = Number(bill.paidAmount);
              description = `${contactName} — ${amountForeign.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${bill.currency}`;
            }
          }
        }

        out.push({
          currency: l.currency,
          signedAmount: Number(l.credit) - Number(l.debit),
          entryId: entry.id,
          entryDate: entry.entryDate,
          documentId: docId,
          fromRate,
          toRate: l.fxRate ? Number(l.fxRate) : null,
          description,
          amountForeign,
          contactName,
          kind,
        });
      }
      return out;
    };

    const realized = await build(realizedLines, 'realized');
    const unrealized = await build(unrealizedLines, 'unrealized');

    const report = buildFxReport(realized, unrealized);

    return NextResponse.json({
      data: {
        homeCurrency: home,
        period: { from: from ?? null, to: to ?? null },
        ...report,
        hasActivity: realized.length > 0 || unrealized.length > 0,
      },
    });
  } catch (err) {
    console.error('GET /api/reports/fx-gain-loss error:', err);
    return NextResponse.json({ error: 'Failed to generate FX gain/loss report' }, { status: 500 });
  }
}
