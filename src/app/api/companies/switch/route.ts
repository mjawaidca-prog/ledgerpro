import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { getToken } from 'next-auth/jwt';

// POST — switch active company (updates JWT token)
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

    // The actual switch happens on next request when JWT callback reads from session
    // We return the new company info so the client can update UI
    return NextResponse.json({
      data: {
        companyId: membership.company.id,
        companyName: membership.company.name,
        role: membership.role,
      },
    });
  } catch (error) {
    console.error('POST /api/companies/switch error:', error);
    return NextResponse.json({ error: 'Failed to switch company' }, { status: 500 });
  }
}
