import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST /api/categorization-rules/apply — run all active rules against unreviewed transactions
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
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
      select: { id: true, description: true, merchant: true, rawStatementText: true, amount: true },
      take: 2000, // process up to 2000 at once
    });

    // Debug: count total unreviewed
    const totalUnreviewed = await db.transaction.count({
      where: { companyId, status: 'toreview', categoryId: null },
    });

    let matched = 0;
    const sampleDescriptions: string[] = [];

    for (const tx of unreviewed) {
      for (const rule of rules) {
        let isMatch = false;

        switch (rule.patternType) {
          case 'merchant_match':
            isMatch = (tx.merchant?.toLowerCase().trim() || '') === rule.pattern.toLowerCase().trim();
            break;
          case 'description_contains': {
            // Search description + merchant + rawStatementText
            const searchText = [
              tx.description || '',
              tx.merchant || '',
              tx.rawStatementText || '',
            ].join(' ').toLowerCase().trim();
            const searchPattern = rule.pattern.toLowerCase().trim();
            isMatch = searchText.includes(searchPattern);
            break;
          }
          case 'amount_range': {
            const txAmt = Math.abs(Number(tx.amount));
            const min = rule.minAmount ? Number(rule.minAmount) : 0;
            const max = rule.maxAmount ? Number(rule.maxAmount) : Infinity;
            isMatch = txAmt >= min && txAmt <= max;
            break;
          }
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
          break;
        }
      }

      // Collect up to 5 sample descriptions for debugging
      if (matched === 0 && sampleDescriptions.length < 5 && tx.description) {
        sampleDescriptions.push(tx.description.substring(0, 60));
      }
    }

    await auditLog(companyId, userId, 'rules.apply', 'categorization_rule', undefined, { matched, total: totalUnreviewed });

    let message: string;
    if (matched > 0) {
      message = `${matched} of ${totalUnreviewed} transactions auto-categorized`;
    } else if (totalUnreviewed === 0) {
      message = 'No unreviewed transactions found. Import a statement or go to Banking to see pending transactions.';
    } else {
      message = `0 of ${totalUnreviewed} matched. Sample descriptions: [${sampleDescriptions.join(' | ')}]. Check that your pattern appears in these texts.`;
    }

    return NextResponse.json({
      data: { matched, total: totalUnreviewed, sampleDescriptions: matched === 0 ? sampleDescriptions : [], message },
    });
  } catch (error) {
    console.error('POST /api/categorization-rules/apply error:', error);
    return NextResponse.json({ error: 'Failed to apply rules' }, { status: 500 });
  }
}
