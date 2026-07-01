import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Get the authenticated user's companyId and userId.
 * Reads from x-company-id header (set by middleware) or session directly.
 * Returns error response if not authenticated or no company selected.
 */
export async function requireCompany(
  req: NextRequest,
  opts?: { roles?: string[]; requireOnboarding?: boolean }
) {
  let companyId: string | null = null;
  let userId: string | undefined;

  // Try header first (injected by middleware from cookie/session)
  const headerCompanyId = req.headers.get('x-company-id');
  const headerUserId = req.headers.get('x-user-id');
  const cookieCompanyId = req.cookies.get('lp-active-company-id')?.value;

  if (headerCompanyId && headerCompanyId !== 'undefined') {
    companyId = headerCompanyId;
  }
  if (headerUserId && headerUserId !== 'undefined') {
    userId = headerUserId;
  }

  if (!companyId && cookieCompanyId && cookieCompanyId !== 'undefined') {
    // Fall back to the active-company cookie directly. This covers requests where
    // middleware headers are not present yet but the browser already has the tenant selected.
    companyId = cookieCompanyId;
  }

  if (!companyId) {
    // Fallback to session
    const session = await getServerSession();
    const user = session?.user as any;
    companyId = user?.activeCompanyId || user?.companyId || null;
    userId = user?.id || undefined;
  }

  if (!companyId) {
    return {
      companyId: null,
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — no company selected. Please log out and back in.' }, { status: 401 }),
    };
  }

  // Verify membership if roles specified
  if (opts?.roles?.length && userId) {
    const membership = await db.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership || !opts.roles.includes(membership.role)) {
      return {
        companyId: null,
        userId: null,
        error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
      };
    }
  }

  // Guard: require completed onboarding before mutations
  if (opts?.requireOnboarding) {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { onboardingComplete: true, name: true },
    });
    if (company && !company.onboardingComplete) {
      return {
        companyId: null,
        userId: null,
        error: NextResponse.json(
          { error: 'Company setup is incomplete. Please complete onboarding first.' },
          { status: 400 }
        ),
      };
    }
  }

  return { companyId, userId, error: null };
}

/**
 * Fetch the full company record for the authenticated user.
 */
export async function getCompany(req: NextRequest) {
  const { companyId, error } = await requireCompany(req);
  if (error || !companyId) return { company: null, error };

  const company = await db.company.findUnique({
    where: { id: companyId },
    include: {
      subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!company) {
    return {
      company: null,
      error: NextResponse.json({ error: 'Company not found' }, { status: 404 }),
    };
  }

  return { company, error: null };
}

/**
 * Record an audit log entry for compliance.
 */
export async function auditLog(
  companyId: string,
  userId: string | undefined,
  action: string,
  entityType: string,
  entityId?: string,
  changes?: any,
  metadata?: any
) {
  try {
    await db.auditLog.create({
      data: {
        companyId,
        userId: userId || null,
        action,
        entityType,
        entityId,
        changes: changes ? (changes as any) : undefined,
        metadata: metadata ? (metadata as any) : undefined,
      },
    });
  } catch (e) {
    console.error('[auditLog] Failed to record:', action, e);
  }
}

/**
 * Guards mutation APIs against edits to closed periods.
 * If the given date falls within any closed period, returns a 409 Conflict response.
 * Returns null if the date is in an open period (mutation allowed).
 */
export async function closedPeriodGuard(
  companyId: string,
  date: Date
): Promise<NextResponse | null> {
  const closed = await db.periodClose.findFirst({
    where: {
      companyId,
      status: 'closed',
      periodStart: { lte: date },
      periodEnd: { gte: date },
    },
  });

  if (closed) {
    return NextResponse.json(
      {
        error: `This date falls within a closed period (${closed.periodStart.toISOString().slice(0, 10)} — ${closed.periodEnd.toISOString().slice(0, 10)}). Changes to closed periods are not allowed.`,
      },
      { status: 409 }
    );
  }

  return null;
}
