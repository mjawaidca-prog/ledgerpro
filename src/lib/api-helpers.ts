import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Get the authenticated user's companyId from the session.
 * Returns null + writes an error response if not authenticated.
 */
export async function requireCompany(req: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.companyId) {
    return {
      companyId: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return {
    companyId: session.user.companyId,
    userId: session.user.id,
    error: null,
  };
}

/**
 * Fetch the company record for the authenticated user.
 */
export async function getCompany(req: NextRequest) {
  const { companyId, error } = await requireCompany(req);
  if (error || !companyId) return { company: null, error };

  const company = await db.company.findUnique({
    where: { id: companyId },
  });

  if (!company) {
    return {
      company: null,
      error: NextResponse.json({ error: 'Company not found' }, { status: 404 }),
    };
  }

  return { company, error: null };
}
