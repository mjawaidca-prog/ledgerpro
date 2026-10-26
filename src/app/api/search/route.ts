import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ data: { invoices: [], bills: [], contacts: [], transactions: [], accounts: [], journal: [], bankAccounts: [] } });
    }

    const [invoices, bills, contacts, transactions, accounts, journal, bankAccounts] = await Promise.all([
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
      // Phase 0 (P0-8): journal entries were not indexed at all — a search
      // for text that exists ONLY in the journal (e.g. "Monthly fee" on a
      // posted entry whose bank row was already matched) returned
      // "No results found". Search entry descriptions and line memos.
      db.journalEntry.findMany({
        where: {
          companyId,
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { lines: { some: { description: { contains: q, mode: 'insensitive' } } } },
          ],
        },
        take: 5, orderBy: { entryDate: 'desc' },
      }),
      // Phase 0 (P0-8): bank/financial accounts were not indexed either —
      // searching "TD" found nothing even with a "TD Chequing" account.
      db.financialAccount.findMany({
        where: { companyId, isActive: true, name: { contains: q, mode: 'insensitive' } },
        take: 5, orderBy: { name: 'asc' },
      }),
    ]);

    return NextResponse.json({
      data: {
        invoices: invoices.map(i => ({ id: i.id, title: i.id, subtitle: i.customer?.name || 'Unknown', amount: Number(i.total), status: i.status, link: `/invoices/${i.id}` })),
        bills: bills.map(b => ({ id: b.id, title: b.id, subtitle: b.vendor?.name || 'Unknown', amount: Number(b.total), status: b.status, link: `/expenses/${b.id}` })),
        contacts: contacts.map(c => ({ id: c.id, title: c.companyName || c.name, subtitle: c.email || c.type, link: `/contacts?id=${c.id}` })),
        transactions: transactions.map(t => ({ id: t.id, title: t.description, subtitle: t.account?.name || '', amount: Number(t.amount), link: `/banking/transactions/${t.id}` })),
        accounts: accounts.map(a => ({ id: a.id, title: `${a.code} — ${a.name}`, subtitle: a.type, link: `/reports/general-ledger?code=${a.code}&name=${encodeURIComponent(a.name)}` })),
        journal: journal.map((j: any) => ({ id: j.id, title: j.description, subtitle: `Journal · ${new Date(j.entryDate).toISOString().slice(0, 10)}`, link: `/journal` })),
        bankAccounts: bankAccounts.map((a: any) => ({ id: a.id, title: a.name, subtitle: `Bank account · ${a.kind}`, link: `/banking?account=${a.id}` })),
      },
    });
  } catch (error) {
    console.error('GET /api/search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
