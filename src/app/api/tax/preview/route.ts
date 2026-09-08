import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isTaxDate } from '@/lib/tax/date';
import { requireCompany } from '@/lib/api-helpers';
import { previewTaxDraft } from '@/lib/tax/ui-service';
import { TaxPostingError } from '@/lib/tax/posting-service';

export const dynamic = 'force-dynamic';

const recoverySchema = z.object({ basisPoints: z.number().int().min(0).max(10000), reason: z.string(), evidence: z.record(z.unknown()), reviewedById: z.string() });
const schema = z.object({
  direction: z.enum(['sale', 'purchase']),
  documentDate: z.string().refine(isTaxDate, 'Invalid document date.'),
  documentCurrency: z.string().regex(/^[A-Z]{3}$/),
  fxRate: z.string().nullable().optional(),
  lines: z.array(z.object({
    clientLineId: z.string().min(1), categoryId: z.string().nullable(), amount: z.union([z.number(), z.string()]),
    taxCodeVersionId: z.string().min(1), jurisdictionEvidence: z.record(z.unknown()),
    jurisdictionOverrideReason: z.string().optional(), recovery: z.record(recoverySchema).optional(),
  })).min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid tax preview request.', details: parsed.error.flatten() }, { status: 400 });
    const plan = await previewTaxDraft({ ...parsed.data, companyId, userId, documentDate: new Date(`${parsed.data.documentDate}T00:00:00.000Z`) });
    return NextResponse.json({ data: plan });
  } catch (error) {
    if (error instanceof TaxPostingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error('POST /api/tax/preview error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Tax preview failed.' }, { status: 500 });
  }
}
