import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// POST — switch active company
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companyId } = body as { companyId: string };

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
    }

    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is a member of this company
    const membership = await db.membership.findUnique({
      where: {
        userId_companyId: {
          userId: session.user.id,
          companyId,
        },
      },
      include: { company: true },
    });

    if (!membership) {
      return NextResponse.json({ error: 'You are not a member of this company' }, { status: 403 });
    }

    const companyName = membership.company.name;

    // lp-active-company-id must be readable client-side too: AppShell needs
    // it to know which company is actually active (and to tell a stale,
    // foreign-account cookie apart from a legitimate switch) rather than
    // falling back to the session's stale login-time company. Server-side
    // trust in this cookie never depended on httpOnly anyway — requireCompany
    // always re-verifies the resolved user actually belongs to it.
    const cookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    };

    const response = NextResponse.json({
      data: {
        companyId: membership.company.id,
        companyName,
        role: membership.role,
      },
    });

    response.cookies.set('lp-active-company-id', companyId, {
      ...cookieOptions,
      httpOnly: false,
    });

    response.cookies.set('lp-active-company-name', companyName, {
      ...cookieOptions,
      httpOnly: false,
    });

    response.cookies.set('lp-active-company-role', membership.role, {
      ...cookieOptions,
      httpOnly: false,
    });

    return response;
  } catch (error) {
    console.error('POST /api/companies/switch error:', error);
    return NextResponse.json({ error: 'Failed to switch company' }, { status: 500 });
  }
}
