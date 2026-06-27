import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// GET — list companies for the current user (with full details for settings)
export async function GET(req: NextRequest) {
  try {
    const session = await requireCompany(req);
    if (session.error) return session.error;

    const memberships = await db.membership.findMany({
      where: { userId: session.userId! },
      include: {
        company: {
          include: {
            subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const companies = memberships.map((m) => ({
      id: m.company.id,
      name: m.company.name,
      legalName: m.company.legalName,
      fiscalYearStart: m.company.fiscalYearStart,
      fiscalYearEnd: m.company.fiscalYearEnd,
      businessType: m.company.businessType,
      businessNumber: m.company.businessNumber,
      gstNumber: m.company.gstNumber,
      province: m.company.province,
      currency: m.company.currency,
      locale: m.company.locale,
      timezone: m.company.timezone,
      onboardingComplete: m.company.onboardingComplete,
      role: m.role,
      plan: m.company.subscriptions[0]?.plan?.name || 'Free Trial',
      status: m.company.subscriptions[0]?.status || 'trialing',
    }));

    return NextResponse.json({ data: companies });
  } catch (error) {
    console.error('GET /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}

// PUT — update the active company profile (used by onboarding + settings)
export async function PUT(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const allowed = [
      'name', 'legalName', 'fiscalYearStart', 'fiscalYearEnd',
      'businessType', 'businessNumber', 'gstNumber', 'province',
      'currency', 'locale', 'timezone', 'onboardingComplete',
    ];

    const data: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    // Convert date strings
    if (data.fiscalYearStart && typeof data.fiscalYearStart === 'string') {
      data.fiscalYearStart = new Date(data.fiscalYearStart);
    }
    if (data.fiscalYearEnd && typeof data.fiscalYearEnd === 'string') {
      data.fiscalYearEnd = new Date(data.fiscalYearEnd);
    }

    const updated = await db.company.update({
      where: { id: companyId },
      data,
    });

    await auditLog(companyId, userId, 'company.update', 'company', companyId, body);

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 });
  }
}
