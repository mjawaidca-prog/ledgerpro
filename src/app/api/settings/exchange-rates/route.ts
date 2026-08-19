import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { CURRENCIES } from '@/lib/currencies';

export const dynamic = 'force-dynamic';

/**
 * Dated FX rates used by consolidated reports.
 * GET: list (optional from/to/type filters), newest first.
 * POST: upsert on (date, from, to, type). owner|admin only.
 * DELETE: ?id= — owner|admin only.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const type = searchParams.get('type');

    const where: any = {};
    if (from) where.from = from;
    if (to) where.to = to;
    if (type === 'closing' || type === 'average' || type === 'daily') where.type = type;

    const rows = await db.exchangeRate.findMany({
      where,
      orderBy: [{ date: 'desc' }, { from: 'asc' }],
      take: 500,
    });

    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('GET /api/settings/exchange-rates error:', err);
    return NextResponse.json({ error: 'Failed to load exchange rates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;
    if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const date = typeof body.date === 'string' ? body.date.slice(0, 10) : '';
    const from = typeof body.from === 'string' ? body.from.toUpperCase() : '';
    const to = typeof body.to === 'string' ? body.to.toUpperCase() : '';
    const rate = Number(body.rate);
    const type = body.type;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    }
    if (!CURRENCIES[from] || !CURRENCIES[to]) {
      return NextResponse.json({ error: 'Unsupported currency code.' }, { status: 400 });
    }
    if (from === to) {
      return NextResponse.json({ error: 'From and to currencies must differ.' }, { status: 400 });
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'Rate must be a positive number.' }, { status: 400 });
    }
    if (type !== 'closing' && type !== 'average' && type !== 'daily') {
      return NextResponse.json({ error: 'Type must be daily, closing or average.' }, { status: 400 });
    }

    const row = await db.exchangeRate.upsert({
      where: {
        date_from_to_type_source: { date: new Date(date), from, to, type, source: 'manual' },
      },
      update: { rate, enteredBy: userId },
      create: { date: new Date(date), from, to, rate, type, source: 'manual', enteredBy: userId },
    });

    await auditLog(companyId, userId, 'exchange_rate.upsert', 'ExchangeRate', row.id, {
      date, from, to, rate, type,
    });

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    console.error('POST /api/settings/exchange-rates error:', err);
    return NextResponse.json({ error: 'Failed to save exchange rate' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;
    if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing rate id.' }, { status: 400 });

    const existing = await db.exchangeRate.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Rate not found.' }, { status: 404 });

    await db.exchangeRate.delete({ where: { id } });
    await auditLog(companyId, userId, 'exchange_rate.delete', 'ExchangeRate', id);

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('DELETE /api/settings/exchange-rates error:', err);
    return NextResponse.json({ error: 'Failed to delete exchange rate' }, { status: 500 });
  }
}
