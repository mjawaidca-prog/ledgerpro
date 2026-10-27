import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { applyCategorizationRules, loadActiveCategorizationRules } from '@/lib/banking/categorization-apply';
export const dynamic = 'force-dynamic';

// POST /api/categorization-rules/apply — run all active rules against unreviewed transactions.
// The matching/stamping engine lives in lib/banking/categorization-apply and
// is shared with the statement-import commit path (auto-apply on import).
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const rules = await loadActiveCategorizationRules(db, companyId);

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

    const { matched } = await applyCategorizationRules(db, {
      companyId,
      rules,
      transactions: unreviewed.map((t) => ({
        id: t.id,
        description: t.description,
        merchant: t.merchant,
        rawStatementText: t.rawStatementText,
        amount: Number(t.amount),
      })),
    });

    // Sample descriptions for debugging when nothing matched (the first
    // few unreviewed descriptions, as the inline engine used to collect).
    const sampleDescriptions: string[] = matched === 0
      ? unreviewed.filter((t) => t.description).slice(0, 5).map((t) => t.description.substring(0, 60))
      : [];

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
