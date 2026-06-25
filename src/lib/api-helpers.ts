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
  opts?: { roles?: string[] }
) {
  // Try header first (injected by middleware from session token)
  const headerCompanyId = req.headers.get('x-company-id');
  const headerUserId = req.headers.get('x-user-id');

  if (headerCompanyId && headerUserId) {
    // Verify membership if roles specified
    if (opts?.roles?.length) {
      const membership = await db.membership.findUnique({
        where: { userId_companyId: { userId: headerUserId, companyId: headerCompanyId } },
      });
      if (!membership || !opts.roles.includes(membership.role)) {
        return {
          companyId: null,
          userId: null,
          error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
        };
      }
    }
    return { companyId: headerCompanyId, userId: headerUserId, error: null };
  }

  // Fallback to session
  const session = await getServerSession();

  if (!session?.user?.activeCompanyId) {
    return {
      companyId: null,
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — no company selected' }, { status: 401 }),
    };
  }

  if (opts?.roles?.length) {
    const membership = await db.membership.findUnique({
      where: {
        userId_companyId: {
          userId: session.user.id,
          companyId: session.user.activeCompanyId,
        },
      },
    });
    if (!membership || !opts.roles.includes(membership.role)) {
      return {
        companyId: null,
        userId: null,
        error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
      };
    }
  }

  return {
    companyId: session.user.activeCompanyId,
    userId: session.user.id,
    error: null,
  };
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
