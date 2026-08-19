import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { getServerSession } from '@/lib/auth';
import { createCompanyForUser } from '@/lib/create-company';
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

    const companies = memberships.map((m) => {
      const subscription = m.company.subscriptions[0];
      const status = subscription?.status || 'trialing';
      const trialEndsAt = subscription?.trialEndsAt ?? null;
      const trialDaysLeft = status === 'trialing' && trialEndsAt
        ? Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      return {
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
        plan: subscription?.plan?.name || 'Free Trial',
        status,
        trialEndsAt,
        trialDaysLeft,
      };
    });

    return NextResponse.json({ data: companies });
  } catch (error) {
    console.error('GET /api/companies error:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}

// POST — add a new company to the currently logged-in user's account
// (as its owner), distinct from /api/auth/register which creates a new user.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) {
      return NextResponse.json({ error: 'Company name must be at least 2 characters' }, { status: 400 });
    }

    const company = await db.$transaction((tx) => createCompanyForUser(tx, userId, name));

    await auditLog(company.id, userId, 'company.create', 'company', company.id, { name });

    return NextResponse.json({ data: { companyId: company.id, companyName: company.name } }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/companies error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create company' }, { status: 500 });
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

    // ── FX settings — guarded mutations ──
    if (body.enabledCurrencies !== undefined) {
      if (!Array.isArray(body.enabledCurrencies) || !body.enabledCurrencies.length) {
        return NextResponse.json({ error: 'enabledCurrencies must be a non-empty array.' }, { status: 400 });
      }
      // Disabling a currency while foreign balances exist is blocked.
      const current = await db.company.findUnique({ where: { id: companyId }, select: { enabledCurrencies: true } });
      const removed = (current?.enabledCurrencies ?? []).filter((c: string) => !body.enabledCurrencies.includes(c));
      for (const ccy of removed) {
        const openDocs = await db.invoice.count({ where: { companyId, currency: ccy, status: { in: ['sent', 'overdue'] } } })
          + await db.bill.count({ where: { companyId, currency: ccy, status: { in: ['open', 'overdue'] } } });
        if (openDocs > 0) {
          return NextResponse.json(
            { error: `${ccy} cannot be turned off while ${openDocs} open document${openDocs === 1 ? '' : 's'} still use it.` },
            { status: 409 }
          );
        }
      }
      data.enabledCurrencies = body.enabledCurrencies;
    }
    if (body.rateSource !== undefined) {
      if (!['bank_of_canada', 'exchangerate_host', 'manual_only'].includes(body.rateSource)) {
        return NextResponse.json({ error: 'Unknown rate source.' }, { status: 400 });
      }
      data.rateSource = body.rateSource;
    }
    for (const key of ['realizedFxAccountCode', 'unrealizedFxAccountCode', 'fxRoundingAccountCode']) {
      if (body[key] !== undefined) data[key] = body[key] || null;
    }

    // The home currency can only change on an empty set of books.
    if (body.currency !== undefined && body.currency !== (await db.company.findUnique({ where: { id: companyId }, select: { currency: true } }))?.currency) {
      const entryCount = await db.journalEntry.count({ where: { companyId } });
      if (entryCount > 0) {
        return NextResponse.json(
          { error: `${entryCount} entries are posted in the current currency. Changing the home currency would restate every one of them, so it can only be done on an empty set of books.` },
          { status: 409 }
        );
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
