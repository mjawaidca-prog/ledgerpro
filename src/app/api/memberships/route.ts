import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['owner', 'admin', 'bookkeeper', 'viewer']),
});

// GET /api/memberships — list all members of the current company
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '50');
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    if (role && ['owner', 'admin', 'bookkeeper', 'viewer'].includes(role)) {
      where.role = role;
    }

    const [memberships, total] = await Promise.all([
      db.membership.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      }),
      db.membership.count({ where }),
    ]);

    return NextResponse.json({
      data: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: m.user.name,
        userEmail: m.user.email,
        userImage: m.user.image,
        role: m.role,
        createdAt: m.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/memberships error:', error);
    return NextResponse.json({ error: 'Failed to fetch memberships' }, { status: 500 });
  }
}

// POST /api/memberships — invite a new member to the company
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, role } = parsed.data;

    // Find user by email
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: 'No user found with that email address. They need to create an account first.' },
        { status: 404 }
      );
    }

    // Check if already a member
    const existing = await db.membership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'This user is already a member of this company.' },
        { status: 409 }
      );
    }

    // Check plan limits
    const subscription = await db.subscription.findFirst({
      where: { companyId, status: { in: ['trialing', 'active'] } },
      include: { plan: true },
    });
    if (subscription?.plan) {
      const currentCount = await db.membership.count({ where: { companyId } });
      if (currentCount >= subscription.plan.maxUsers) {
        return NextResponse.json(
          { error: `Your ${subscription.plan.name} plan allows up to ${subscription.plan.maxUsers} user(s). Upgrade to add more.` },
          { status: 403 }
        );
      }
    }

    const membership = await db.membership.create({
      data: { userId: user.id, companyId, role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    // Notify the invited user
    await db.notification.create({
      data: {
        userId: user.id,
        companyId,
        type: 'member_joined',
        title: `Added to ${membership.companyId}`,
        body: `You've been added as a ${role} to a company on LedgerPro.`,
      },
    });

    // Audit log
    await auditLog(companyId, userId, 'membership.create', 'membership', membership.id,
      { role: membership.role, invitedEmail: email });

    return NextResponse.json({
      data: {
        id: membership.id,
        userId: membership.userId,
        userName: membership.user.name,
        userEmail: membership.user.email,
        role: membership.role,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/memberships error:', error);
    return NextResponse.json({ error: 'Failed to invite member' }, { status: 500 });
  }
}
