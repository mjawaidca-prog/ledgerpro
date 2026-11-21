import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getLoanStatement } from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

/** GET /api/loans/statements/[id] — one captured statement + its read. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const statement = await getLoanStatement(companyId!, params.id);
    if (!statement) return NextResponse.json({ error: 'Loan statement not found.' }, { status: 404 });
    return NextResponse.json({ data: { statement } });
  } catch (err: any) {
    console.error('GET /api/loans/statements/[id] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load loan statement' }, { status: 500 });
  }
}
