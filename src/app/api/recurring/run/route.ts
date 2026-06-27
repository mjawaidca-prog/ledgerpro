import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { postJournalEntry } from '@/lib/journal';
export const dynamic = 'force-dynamic';

// POST /api/recurring/run — process all due recurring templates
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const now = new Date();

    const dueTemplates = await db.recurringTemplate.findMany({
      where: {
        companyId,
        active: true,
        nextPostDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: { lines: true },
    });

    const results: { id: string; name: string; posted: boolean; error?: string }[] = [];

    for (const template of dueTemplates) {
      try {
        // Post journal entry from template
        await postJournalEntry({
          entryDate: now,
          description: template.description || template.name,
          sourceType: 'manual',
          lines: template.lines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description || undefined,
            debit: Number(l.debit),
            credit: Number(l.credit),
          })),
        }, companyId);

        // Calculate next post date
        const next = new Date(template.nextPostDate);
        switch (template.frequency) {
          case 'weekly': next.setDate(next.getDate() + 7); break;
          case 'monthly': next.setMonth(next.getMonth() + 1); break;
          case 'quarterly': next.setMonth(next.getMonth() + 3); break;
          case 'annual': next.setFullYear(next.getFullYear() + 1); break;
        }

        await db.recurringTemplate.update({
          where: { id: template.id },
          data: {
            nextPostDate: next,
            lastPostedAt: now,
            timesPosted: { increment: 1 },
          },
        });

        await auditLog(companyId, userId, 'recurring.post', 'recurring_template', template.id, null, { postedDate: now });

        results.push({ id: template.id, name: template.name, posted: true });
      } catch (err: any) {
        results.push({ id: template.id, name: template.name, posted: false, error: err.message });
      }
    }

    return NextResponse.json({
      data: { processed: results.length, results },
    });
  } catch (error) {
    console.error('POST /api/recurring/run error:', error);
    return NextResponse.json({ error: 'Failed to process recurring templates' }, { status: 500 });
  }
}
