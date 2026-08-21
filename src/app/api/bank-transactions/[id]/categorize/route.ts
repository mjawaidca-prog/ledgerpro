import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard, accountLockedGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { inclusiveTaxAmount } from '@/lib/banking/splits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/[id]/categorize — set category/tax/contact/memo,
 * optionally create a "«PAYEE» contains" rule, and optionally post.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const categoryCode = typeof body.categoryCode === 'string' ? body.categoryCode : null;
    const taxCode = body.taxCode ?? null;
    const taxRate = body.taxRate != null ? Number(body.taxRate) : null;
    const taxInclusive = body.taxInclusive !== false;
    const contactId = typeof body.contactId === 'string' ? body.contactId : null;
    const newContactName = typeof body.newContactName === 'string' ? body.newContactName.trim() : '';
    const memo = body.memo ?? null;
    const createRule = Boolean(body.createRule);
    const post = Boolean(body.post);

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { glAccountCode: true, currency: true } }, category: { select: { code: true } } },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });

    const lockGuard = await accountLockedGuard(companyId, tx.financialAccountId, tx.date);
    if (lockGuard) return lockGuard;
    const periodGuard = await closedPeriodGuard(companyId, tx.date);
    if (periodGuard) return periodGuard;

    // Resolve/validate the category.
    let categoryId: string | null = null;
    if (categoryCode) {
      const coa = await db.chartOfAccount.findFirst({
        where: { companyId, code: categoryCode, active: true },
        select: { id: true },
      });
      if (!coa) return NextResponse.json({ error: `GL account ${categoryCode} not found.` }, { status: 400 });
      categoryId = coa.id;
    }

    // New contact — created here, stored on the row.
    let finalContactId = contactId;
    if (newContactName) {
      const contact = await db.contact.create({
        data: { companyId, name: newContactName, type: Number(tx.amount) > 0 ? 'customer' : 'supplier', status: 'active' },
      });
      finalContactId = contact.id;
    }

    // Inclusive tax backout.
    const taxAmount = taxRate ? inclusiveTaxAmount(Math.abs(Number(tx.amount)), taxRate) : 0;

    // "Remember this for «PAYEE»" — create a rule.
    let appliedRuleId: string | null = null;
    if (createRule && tx.payeeGuess) {
      const rules = await db.bankRule.findMany({ where: { companyId }, orderBy: { order: 'desc' }, take: 1 });
      const rule = await db.bankRule.create({
        data: {
          companyId,
          name: `«${tx.payeeGuess}»`,
          order: (rules[0]?.order ?? 0) + 1,
          op: 'contains',
          value: tx.payeeGuess.toUpperCase(),
          anyOf: [],
          scope: { accountIds: 'all', direction: Number(tx.amount) > 0 ? 'in' : 'out' },
          setCategoryCode: categoryCode,
          setTaxCode: taxCode,
          setTaxRate: taxRate !== null ? taxRate : null,
          setTaxInclusive: taxInclusive,
          setContactId: finalContactId,
          autoPost: false,
          appliedCount: 0,
        },
      });
      appliedRuleId = rule.id;
    }

    await db.transaction.update({
      where: { id: params.id },
      data: {
        categoryId,
        taxCode,
        taxRate: taxRate !== null ? taxRate : null,
        taxAmount: taxAmount || null,
        contactId: finalContactId,
        memo,
        appliedRuleId,
        status: 'categorized',
      },
    });

    let entryId: string | null = null;
    if (post) {
      const { postBankRow } = await import('@/lib/banking/posting');
      const row = await db.transaction.findUnique({
        where: { id: params.id },
        include: {
          account: { select: { glAccountCode: true, currency: true } },
          category: { select: { code: true, name: true } },
        },
      });
      if (!row) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
      const company = await db.company.findUnique({ where: { id: companyId } });
      entryId = await postBankRow({
        row: row as any,
        companyId,
        homeCurrency: company?.currency ?? 'CAD',
      });
    }

    await auditLog(companyId, userId, 'bank_transaction.categorize', 'transaction', params.id, { categoryCode, taxCode, contactId: finalContactId, post } as any);

    return NextResponse.json({ data: { categorized: true, entryId, appliedRuleId } });
  } catch (err: any) {
    console.error('POST /api/bank-transactions/[id]/categorize error:', err);
    return NextResponse.json({ error: err.message || 'Failed to categorize' }, { status: 500 });
  }
}
