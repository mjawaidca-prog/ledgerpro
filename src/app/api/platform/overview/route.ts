import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePlatformAdmin, platformAudit } from '@/lib/platform/auth';
import { countTrialsExpiring, startOfWeek, isFollowUpDue } from '@/lib/platform/rollup';
import { bankFeedPilotMode } from '@/lib/platform/pilot-mode';
import { latestSubscriptionsByCompany } from '@/lib/platform/subscribers';
export const dynamic = 'force-dynamic';

// GET /api/platform/overview — CC-2 overview. All subscription counts are
// PER COMPANY-SUBSCRIPTION and labelled as such in the UI.
export async function GET() {
  const { ctx, error } = await requirePlatformAdmin();
  if (error) return error;
  const now = new Date();
  const [subByCompany, userCount, signups, bankGrouped, activeKeys, deadWebhooks, followUps] = await Promise.all([
    latestSubscriptionsByCompany(),
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: startOfWeek(now) } } }),
    db.bankConnection.groupBy({ by: ['status'], _count: { _all: true } }),
    db.apiKey.count({ where: { revokedAt: null } }),
    db.webhookDelivery.count({ where: { status: 'dead' } }),
    (db as any).subscriberFollowUp.findMany({ select: { status: true, nextFollowUpAt: true, contactOptOut: true } }).catch(() => []),
  ]);
  const subs = [...subByCompany.values()] as any[];
  const companiesByStatus: Record<string, number> = { trialing: 0, active: 0, past_due: 0, canceled: 0, expired: 0 };
  for (const s of subs) companiesByStatus[s.status] = (companiesByStatus[s.status] ?? 0) + 1;
  const subLikes = subs.map((s: any) => ({ companyId: s.companyId, companyName: '', status: s.status, trialEndsAt: s.trialEndsAt }));
  const bankByStatus: Record<string, number> = {};
  for (const g of bankGrouped as any[]) bankByStatus[g.status] = g._count._all;
  const followUpsDue = (followUps as any[]).filter((f) => isFollowUpDue(f, now)).length;

  await platformAudit({ adminUserId: ctx!.userId, action: 'control_center.overview_view', targetType: 'platform' });
  return NextResponse.json({
    data: {
      asOf: now.toISOString(),
      units: { subscriptionCounts: 'companies (latest subscription per company)', signups: 'users', bankConnections: 'connections', apiKeys: 'keys', webhookDeliveries: 'deliveries' },
      companiesBySubscriptionStatus: companiesByStatus,
      totalCompanySubscriptions: subs.length,
      totalUsers: userCount,
      trialsExpiringWithin7Days: countTrialsExpiring(subLikes, now, 7),
      trialsExpiringWithin14Days: countTrialsExpiring(subLikes, now, 14),
      signupsThisWeek: signups,
      bankConnectionsByStatus: bankByStatus,
      activeApiKeys: activeKeys,
      deadWebhookDeliveries: deadWebhooks,
      followUpsDue,
      bankFeedPilot: bankFeedPilotMode(),
    },
  });
}
