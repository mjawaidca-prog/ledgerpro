import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { taxRegistrationCreateSchema } from '@/lib/tax/setup';
import { createTaxRegistration, loadTaxSetup } from '@/lib/tax/setup-service';
import { TaxPostingError } from '@/lib/tax/posting-service';

export const dynamic = 'force-dynamic';

/** Create a company tax registration. Owner/admin only. */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'], requireOnboarding: true });
    if (error) return error;
    const parsed = taxRegistrationCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid tax registration.', details: parsed.error.flatten() }, { status: 400 });
    }
    const created = await createTaxRegistration({ companyId: companyId!, userId: userId!, role: null, data: parsed.data });
    return NextResponse.json({ data: { registration: created, setup: await loadTaxSetup(companyId!, userId!) } }, { status: 201 });
  } catch (error) {
    if (error instanceof TaxPostingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Create tax registration error:', error);
    return NextResponse.json({ error: 'Failed to create tax registration.' }, { status: 500 });
  }
}
