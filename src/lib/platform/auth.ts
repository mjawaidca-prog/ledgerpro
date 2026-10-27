import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { evaluatePlatformAccess, platformAccessErrorMessage, platformAccessHttpStatus, type PlatformAccessDecision } from './access';
import { sanitizeAuditMetadata } from './audit-sanitize';

// Server-side platform authorization (CC-1). EVERY /api/platform/* route and
// every /control-center page goes through this helper. It looks up the
// PlatformAdmin row by the session user id; company Membership roles are
// never consulted.

export interface PlatformAdminContext {
  userId: string;
  email: string;
  name: string;
  role: string;
}

async function resolvePlatformAccess(): Promise<{ decision: PlatformAccessDecision; ctx: PlatformAdminContext | null }> {
  const session = await getServerSession();
  const user = session?.user as any;
  const userId: string | null = user?.id ?? null;
  if (!userId) return { decision: { kind: 'unauthenticated' }, ctx: null };
  const admin = await (db as any).platformAdmin.findUnique({
    where: { userId },
    select: { role: true },
  });
  const dbUser = await db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true, email: true, name: true } });
  const decision = evaluatePlatformAccess({ userId, platformAdmin: admin, mfaEnabled: dbUser?.mfaEnabled ?? user?.mfaEnabled });
  if (decision.kind !== 'allow') return { decision, ctx: null };
  return { decision, ctx: { userId, email: dbUser?.email ?? user.email ?? '', name: dbUser?.name ?? user.name ?? '', role: decision.role } };
}

/** For API routes: returns { ctx } or { error } (401/403). */
export async function requirePlatformAdmin(): Promise<{ ctx: PlatformAdminContext; error: null } | { ctx: null; error: NextResponse }> {
  const { decision, ctx } = await resolvePlatformAccess();
  if (!ctx) {
    return { ctx: null, error: NextResponse.json({ error: platformAccessErrorMessage(decision), code: decision.kind }, { status: platformAccessHttpStatus(decision) }) };
  }
  return { ctx, error: null };
}

/** For server-component pages: redirects instead of returning an error.
 *  - no session -> /login
 *  - platform admin without MFA -> /settings/security (with explanation flag)
 *  - signed-in non-admin -> /dashboard (the console simply is not theirs) */
export async function requirePlatformAdminPage(): Promise<PlatformAdminContext> {
  const { decision, ctx } = await resolvePlatformAccess();
  if (ctx) return ctx;
  if (decision.kind === 'unauthenticated') redirect('/login?next=/control-center');
  if (decision.kind === 'mfa_required') redirect('/settings/security?platform=mfa_required');
  redirect('/dashboard?platform=forbidden');
}

/** Lightweight check for navigation visibility (Rail): is this session user a
 *  platform admin? Returns false for everyone else, including company owners. */
export async function isPlatformAdminUser(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const admin = await (db as any).platformAdmin.findUnique({ where: { userId }, select: { id: true } });
  return !!admin;
}

/** Write a PlatformAuditEvent with sanitized metadata. Never throws into the
 *  caller's flow (mirrors auditLog's behaviour in api-helpers). */
export async function platformAudit(input: {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const clean = sanitizeAuditMetadata(input.metadata);
    await (db as any).platformAuditEvent.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        companyId: input.companyId ?? null,
        metadata: Object.keys(clean).length ? clean : undefined,
      },
    });
  } catch (e) {
    console.error('[platformAudit] Failed to record:', input.action, e);
  }
}
