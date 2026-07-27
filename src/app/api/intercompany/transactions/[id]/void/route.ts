import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { voidInterCompany } from '@/lib/intercompany/void';
export const dynamic = 'force-dynamic';

// POST — void an inter-company transaction (reverses both entries)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
    });
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    const result = await voidInterCompany(userId!, params.id, reason);

    await auditLog(companyId, userId, 'intercompany.void', 'InterCompanyTransaction', params.id, {
      reason,
      status: result.status,
    } as any);

    return NextResponse.json({ data: result });
  } catch (error: any) {
    console.error('POST /api/intercompany/transactions/[id]/void error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to void inter-company transaction' },
      { status: 500 }
    );
  }
}
