import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { taxConfigurationInputSchema } from '@/lib/tax/setup';
import { loadTaxSetup, saveTaxConfiguration } from '@/lib/tax/setup-service';
import { TaxPostingError } from '@/lib/tax/posting-service';

export const dynamic = 'force-dynamic';

function taxError(error: unknown, fallback: string) {
  if (error instanceof TaxPostingError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('Tax setup error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;
    return NextResponse.json({ data: await loadTaxSetup(companyId!, userId!) });
  } catch (error) {
    return taxError(error, 'Failed to load tax setup.');
  }
}

/** Save the company tax configuration (GL mappings + workflow switches). Owner/admin only. */
export async function PUT(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'], requireOnboarding: true });
    if (error) return error;
    const parsed = taxConfigurationInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid tax configuration.', details: parsed.error.flatten() }, { status: 400 });
    }
    await saveTaxConfiguration({ companyId: companyId!, userId: userId!, role: null, data: parsed.data });
    return NextResponse.json({ data: await loadTaxSetup(companyId!, userId!) });
  } catch (error) {
    return taxError(error, 'Failed to save tax configuration.');
  }
}
