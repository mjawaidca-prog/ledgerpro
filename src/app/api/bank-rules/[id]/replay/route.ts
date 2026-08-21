import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { ruleMatches } from '@/lib/banking/rules';

export const dynamic = 'force-dynamic';

/** POST /api/bank-rules/[id]/replay — apply one rule to existing toreview rows. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const accountId = typeof body.accountId === 'string' ? body.accountId : null;

    const rule = await db.bankRule.findUnique({ where: { id: params.id, companyId } });
    if (!rule) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });

    const where: any = { companyId, status: 'toreview' };
    if (accountId) where.financialAccountId = accountId;

    const rows = await db.transaction.findMany({ where, take: 2000 });

    let matched = 0;
    for (const row of rows) {
      const hit = ruleMatches(rule as any, {
        description: row.description,
        amount: Number(row.amount),
        accountId: row.financialAccountId,
      });
      if (!hit) continue;

      let categoryId: string | null = null;
      if (rule.setCategoryCode) {
        const coa = await db.chartOfAccount.findFirst({
          where: { companyId, code: rule.setCategoryCode, active: true },
          select: { id: true },
        });
        categoryId = coa?.id ?? null;
      }

      await db.transaction.update({
        where: { id: row.id },
        data: {
          categoryId,
          taxCode: rule.setTaxCode,
          taxRate: rule.setTaxRate,
          contactId: rule.setContactId,
          appliedRuleId: rule.id,
          status: 'categorized',
        },
      });
      matched++;
    }

    await db.bankRule.update({ where: { id: rule.id }, data: { appliedCount: { increment: matched } } });
    await auditLog(companyId, userId, 'bank_rule.replay', 'BankRule', rule.id, { matched } as any);

    return NextResponse.json({ data: { matched, total: rows.length } });
  } catch (err) {
    console.error('POST /api/bank-rules/[id]/replay error:', err);
    return NextResponse.json({ error: 'Failed to replay the rule' }, { status: 500 });
  }
}
