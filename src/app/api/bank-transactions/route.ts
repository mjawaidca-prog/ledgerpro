import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank-transactions?accountId=&queue=1
 * The review queue with derived status pills + the four stat tiles (real
 * counts). Suggested matches are computed per row when requested.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const queue = searchParams.get('queue') === '1';
    const limit = Math.min(Number(searchParams.get('limit') ?? 100) || 100, 500);

    const where: any = { companyId };
    if (accountId) where.financialAccountId = accountId;

    const rows = await db.transaction.findMany({
      where: { ...where, status: { notIn: ['excluded', 'transfer', 'voided'] } },
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        account: { select: { name: true, glAccountCode: true, currency: true } },
        category: { select: { id: true, code: true, name: true } },
        contact: { select: { id: true, name: true, companyName: true } },
        appliedRule: { select: { id: true, name: true } },
      },
    });

    const openInvoices = await db.invoice.findMany({
      where: { companyId, status: { in: ['sent', 'overdue'] } },
      select: { id: true, customerId: true, dueDate: true, total: true, paidAmount: true },
    });

    const contacts = await db.contact.findMany({
      where: { companyId },
      select: { id: true, name: true, companyName: true },
    });

    const queueRows = rows.map((t) => {
      const posted = t.status === 'reconciled' && t.matchRef;
      let pill: 'Match found' | 'To categorize' | 'Needs match' | 'Categorized' | 'Posted' = 'To categorize';
      let suggested: { id: string; ref: string; contactName: string; confidence: string } | null = null;

      if (posted) pill = 'Posted';
      else if (t.matchedDocs) pill = 'Match found';
      else if (t.categoryId && t.appliedRuleId) pill = 'Categorized';
      else if (t.categoryId) pill = 'To categorize';
      else {
        pill = 'Needs match';
        // Suggest only for inflows with a payee resolving to a customer with
        // exactly one open invoice of the same amount.
        if (Number(t.amount) > 0 && t.payeeGuess) {
          const contact = contacts.find(
            (c) =>
              c.name.toLowerCase().includes(t.payeeGuess!.toLowerCase().split(' ')[0]) ||
              t.payeeGuess!.toLowerCase().includes(c.name.toLowerCase())
          );
          if (contact) {
            const matching = openInvoices.filter(
              (inv) => inv.customerId === contact.id && Math.abs(Number(inv.total) - Number(inv.paidAmount) - Math.abs(Number(t.amount))) <= 0.01
            );
            if (matching.length === 1) {
              suggested = {
                id: matching[0].id,
                ref: matching[0].id,
                contactName: contact.companyName || contact.name,
                confidence: 'high',
              };
              pill = 'Match found';
            }
          }
        }
      }

      return {
        id: t.id,
        date: t.date.toISOString().slice(0, 10),
        description: t.description,
        merchant: t.merchant,
        amount: Number(t.amount),
        currency: t.currency,
        status: t.status,
        pill,
        suggested,
        category: t.category ? { code: t.category.code, name: t.category.name } : null,
        contact: t.contact ? { id: t.contact.id, name: t.contact.companyName || t.contact.name } : null,
        appliedRule: t.appliedRule ? { id: t.appliedRule.id, name: t.appliedRule.name } : null,
        payeeGuess: t.payeeGuess,
        taxCode: t.taxCode,
        splits: t.splits,
        matchedDocs: t.matchedDocs,
        posted: posted,
        account: { name: t.account.name, glAccountCode: t.account.glAccountCode, currency: t.account.currency },
      };
    });

    // Stat tiles — real counts.
    const [toReview, categorized, postedThisMonth, suggestedCount] = await Promise.all([
      db.transaction.count({ where: { ...where, status: 'toreview' } }),
      db.transaction.count({ where: { ...where, categoryId: { not: null }, status: { not: 'reconciled' } } }),
      db.transaction.count({
        where: {
          ...where,
          status: 'reconciled',
          updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      db.transaction.count({ where: { ...where, matchedDocs: { not: null } } }),
    ]);

    return NextResponse.json({
      data: {
        rows: queue ? queueRows : queueRows,
        tiles: {
          toReview,
          suggestedMatches: suggestedCount,
          categorizedByRules: categorized,
          postedThisMonth,
        },
      },
    });
  } catch (err) {
    console.error('GET /api/bank-transactions error:', err);
    return NextResponse.json({ error: 'Failed to load bank transactions' }, { status: 500 });
  }
}
