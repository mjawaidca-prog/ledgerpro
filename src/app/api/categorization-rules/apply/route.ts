import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// POST /api/categorization-rules/apply — run all active rules against unreviewed transactions
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const rules = await db.categorizationRule.findMany({
      where: { companyId, active: true },
      orderBy: { priority: 'desc' },
    });

    if (rules.length === 0) {
      return NextResponse.json({ data: { matched: 0, message: 'No active rules' } });
    }

    const unreviewed = await db.transaction.findMany({
      where: { companyId, status: 'toreview', categoryId: null },
      select: { id: true, description: true, merchant: true, amount: true },
      take: 500,
    });

    let matched = 0;

    for (const tx of unreviewed) {
      for (const rule of rules) {
        let isMatch = false;

        switch (rule.patternType) {
          case 'merchant_match':
            isMatch = tx.merchant?.toLowerCase() === rule.pattern.toLowerCase();
            break;
          case 'description_contains':
            isMatch = tx.description.toLowerCase().includes(rule.pattern.toLowerCase());
            break;
          case 'amount_range':
            const txAmt = Math.abs(Number(tx.amount));
            const min = rule.minAmount ? Number(rule.minAmount) : 0;
            const max = rule.maxAmount ? Number(rule.maxAmount) : Infinity;
            isMatch = txAmt >= min && txAmt <= max;
            break;
          case 'regex':
            try {
              isMatch = new RegExp(rule.pattern, 'i').test(tx.description);
            } catch { isMatch = false; }
            break;
        }

        if (isMatch) {
          await db.transaction.update({
            where: { id: tx.id },
            data: { categoryId: rule.categoryId, status: 'categorized' },
          });
          await db.categorizationRule.update({
            where: { id: rule.id },
            data: { matchCount: { increment: 1 }, lastMatchedAt: new Date() },
          });
          matched++;
          break; // stop at first matching rule
        }
      }
    }

    await auditLog(companyId, userId, 'rules.apply', 'categorization_rule', undefined, { matched, total: unreviewed.length });

    return NextResponse.json({
      data: { matched, total: unreviewed.length, message: `${matched} of ${unreviewed.length} transactions auto-categorized` },
    });
  } catch (error) {
    console.error('POST /api/categorization-rules/apply error:', error);
    return NextResponse.json({ error: 'Failed to apply rules' }, { status: 500 });
  }
}
