import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ data: { invoices: [], bills: [], contacts: [], transactions: [], accounts: [] } });
    }

    const [invoices, bills, contacts, transactions, accounts] = await Promise.all([
      db.invoice.findMany({
        where: { companyId, OR: [{ id: { contains: q, mode: 'insensitive' } }, { customer: { name: { contains: q, mode: 'insensitive' } } }, { customer: { companyName: { contains: q, mode: 'insensitive' } } }] },
        include: { customer: { select: { name: true } } },
        take: 5, orderBy: { issueDate: 'desc' },
      }),
      db.bill.findMany({
        where: { companyId, OR: [{ id: { contains: q, mode: 'insensitive' } }, { vendor: { name: { contains: q, mode: 'insensitive' } } }, { vendor: { companyName: { contains: q, mode: 'insensitive' } } }, { referenceNo: { contains: q, mode: 'insensitive' } }] },
        include: { vendor: { select: { name: true } } },
        take: 5, orderBy: { billDate: 'desc' },
      }),
      db.contact.findMany({
        where: { companyId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { companyName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
        take: 5, orderBy: { updatedAt: 'desc' },
      }),
      db.transaction.findMany({
        where: { companyId, status: { not: 'excluded' }, OR: [{ description: { contains: q, mode: 'insensitive' } }, { merchant: { contains: q, mode: 'insensitive' } }] },
        include: { account: { select: { name: true } } },
        take: 5, orderBy: { date: 'desc' },
      }),
      db.chartOfAccount.findMany({
        where: { companyId, active: true, OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
        take: 5, orderBy: { code: 'asc' },
      }),
    ]);

    return NextResponse.json({
      data: {
        invoices: invoices.map(i => ({ id: i.id, title: i.id, subtitle: i.customer?.name || 'Unknown', amount: Number(i.total), status: i.status, link: `/invoices/${i.id}` })),
        bills: bills.map(b => ({ id: b.id, title: b.id, subtitle: b.vendor?.name || 'Unknown', amount: Number(b.total), status: b.status, link: `/expenses/${b.id}` })),
        contacts: contacts.map(c => ({ id: c.id, title: c.companyName || c.name, subtitle: c.email || c.type, link: `/contacts?id=${c.id}` })),
        transactions: transactions.map(t => ({ id: t.id, title: t.description, subtitle: t.account?.name || '', amount: Number(t.amount), link: `/banking/transactions/${t.id}` })),
        accounts: accounts.map(a => ({ id: a.id, title: `${a.code} — ${a.name}`, subtitle: a.type, link: `/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}` })),
      },
    });
  } catch (error) {
    console.error('GET /api/search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
