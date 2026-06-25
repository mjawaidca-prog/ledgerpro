import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET — list companies for the current user
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
