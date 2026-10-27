import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { taxRegistrationUpdateSchema } from '@/lib/tax/setup';
import { loadTaxSetup, updateTaxRegistration } from '@/lib/tax/setup-service';
import { TaxPostingError } from '@/lib/tax/posting-service';

export const dynamic = 'force-dynamic';

/** Edit a tax registration, toggle it active, or record its review. Owner/admin only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'], requireOnboarding: true });
    if (error) return error;
    const parsed = taxRegistrationUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid tax registration update.', details: parsed.error.flatten() }, { status: 400 });
    }
    const updated = await updateTaxRegistration({
      companyId: companyId!, userId: userId!, role: null, registrationId: params.id, data: parsed.data,
    });
    return NextResponse.json({ data: { registration: updated, setup: await loadTaxSetup(companyId!, userId!) } });
  } catch (error) {
    if (error instanceof TaxPostingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Update tax registration error:', error);
    return NextResponse.json({ error: 'Failed to update tax registration.' }, { status: 500 });
  }
}
