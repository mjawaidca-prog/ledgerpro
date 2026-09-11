import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
export const dynamic = 'force-dynamic';

// GET /api/v1/company — the API-A proof endpoint. Returns the authenticated
// key's own company profile (safe fields only — no registration numbers or
// internal identifiers). It exercises the whole v1 pipeline: key auth,
// permission check, rate limiting, and tenant scoping from the key itself.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const company = await db.company.findUnique({
    where: { id: context!.companyId },
    select: {
      id: true,
      name: true,
      legalName: true,
      fiscalYearStart: true,
      fiscalYearEnd: true,
      businessType: true,
      province: true,
      currency: true,
      locale: true,
      timezone: true,
      onboardingComplete: true,
    },
  });

  if (!company) {
    return NextResponse.json({ error: { code: 'company_not_found', message: 'Company not found.' } }, { status: 404 });
  }

  return NextResponse.json({ data: company });
}
