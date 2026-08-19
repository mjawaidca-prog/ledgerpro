import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';

export const dynamic = 'force-dynamic';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * GET /api/contacts/balances?type=customer|supplier&asOf
 * Open-document balances grouped by currency — one subtotal per currency with
 * a translated equivalent at each document's frozen rate. The grand total is
 * explicitly informational ("not a bookable figure").
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') === 'supplier' ? 'supplier' : 'customer';
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);

    const company = await db.company.findUnique({ where: { id: companyId } });
    const home = company?.currency ?? 'CAD';

    const contacts = await db.contact.findMany({
      where: { companyId, type },
      include: {
        invoices: { where: { status: { in: ['sent', 'overdue'] } } },
        bills: { where: { status: { in: ['open', 'overdue'] } } },
      },
    });

    const byCurrency = new Map<
      string,
      {
        currency: string;
        rate: number | null;
        foreign: number;
        home: number;
        rows: { name: string; daysOverdue: number; foreign: number; home: number | null }[];
      }
    >();

    const asOfDate = new Date(asOf).getTime();

    for (const c of contacts) {
      const docs = type === 'customer' ? c.invoices : c.bills;
      for (const d of docs) {
        const remaining = Number(d.total) - Number(d.paidAmount);
        if (remaining <= 0) continue;
        const ccy = d.currency ?? 'CAD';
        const rate = d.fxRate ? Number(d.fxRate) : null;
        const homeVal = ccy === home ? remaining : rate ? round2(remaining * rate) : null;

        let entry = byCurrency.get(ccy);
        if (!entry) {
          entry = { currency: ccy, rate, foreign: 0, home: 0, rows: [] };
          byCurrency.set(ccy, entry);
        }
        entry.foreign = round2(entry.foreign + remaining);
        if (homeVal !== null) entry.home = round2(entry.home + homeVal);

        const docDate = (d as any).issueDate ?? (d as any).billDate ?? null;
        const due = new Date(d.dueDate ?? docDate ?? 0).getTime();
        const daysOverdue = Math.max(0, Math.floor((asOfDate - due) / 86400000));
        entry.rows.push({
          name: c.companyName || c.name,
          daysOverdue,
          foreign: round2(remaining),
          home: homeVal,
        });
      }
    }

    const cards = [...byCurrency.values()].sort((a, b) => (a.currency === home ? -1 : b.currency === home ? 1 : a.currency.localeCompare(b.currency)));
    const grandHome = round2(cards.reduce((s, x) => s + x.home, 0));
    const currencyCount = cards.length;

    return NextResponse.json({
      data: {
        type,
        asOf,
        homeCurrency: home,
        cards: cards.map((x) => ({
          ...x,
          rate: x.currency === home ? null : x.rate,
          rows: x.rows.sort((a, b) => b.foreign - a.foreign),
        })),
        grandTotal: grandHome,
        currencyCount,
      },
    });
  } catch (err) {
    console.error('GET /api/contacts/balances error:', err);
    return NextResponse.json({ error: 'Failed to load balances' }, { status: 500 });
  }
}
