import { db } from '@/lib/db';
import { buildSubscriberRollups, subscriptionBillingLabel, type CompanySubscriptionLike } from './rollup';

// Read models for CC-2. Every select is an allowlist: no passwordHash, no
// ApiKey.keyHash, no BankConnection.accessTokenEncrypted, no balances, no
// WebhookDelivery.payload — anywhere, including nested includes.

export async function latestSubscriptionsByCompany() {
  const subs = await db.subscription.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      companyId: true, planId: true, status: true, trialEndsAt: true,
      currentPeriodStart: true, currentPeriodEnd: true, canceledAt: true,
      stripeSubscriptionId: true, stripeCustomerId: true, createdAt: true, updatedAt: true,
      plan: { select: { id: true, name: true } },
    },
  });
  const byCompany = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!byCompany.has(s.companyId)) byCompany.set(s.companyId, s);
  return byCompany;
}

function toSubLike(companyId: string, companyName: string, s: any): CompanySubscriptionLike {
  return {
    companyId, companyName, planId: s?.planId ?? s?.plan?.id ?? null, planName: s?.plan?.name ?? null,
    status: s?.status ?? 'not_recorded', trialEndsAt: s?.trialEndsAt ?? null,
    currentPeriodEnd: s?.currentPeriodEnd ?? null,
    stripeSubscriptionId: s?.stripeSubscriptionId ?? null, stripeCustomerId: s?.stripeCustomerId ?? null,
  };
}

/** Derived milestones for one company, from existing tables only.
 *  Returns ISO dates or null (-> displayed as "Not recorded"). */
export async function derivedMilestones(companyId: string, companyCreatedAt: Date, onboardingComplete: boolean) {
  const [firstImport, firstStatement, firstInvoice, firstBank, firstKey, latestKey] = await Promise.all([
    (db as any).importBatch?.findFirst ? (db as any).importBatch.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null) : Promise.resolve(null),
    db.statementImport.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    db.invoice.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    db.bankConnection.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    db.apiKey.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    db.apiKey.findFirst({ where: { companyId, lastUsedAt: { not: null } }, orderBy: { lastUsedAt: 'desc' }, select: { lastUsedAt: true } }).catch(() => null),
  ]);
  const iso = (d: any) => (d ? new Date(d).toISOString() : null);
  return {
    companyCreated: iso(companyCreatedAt),
    onboardingCompleted: onboardingComplete ? iso(companyCreatedAt) /* date not stored separately; state only */ : null,
    onboardingComplete,
    firstStatementImport: iso(firstImport?.createdAt ?? firstStatement?.createdAt),
    firstInvoice: iso(firstInvoice?.createdAt),
    firstBankConnection: iso(firstBank?.createdAt),
    apiKeyCreated: iso(firstKey?.createdAt),
    apiKeyFirstUsed: iso(latestKey?.lastUsedAt),
  };
}

export interface SubscriberListParams {
  search?: string; plan?: string; status?: string; expiry?: string; // expiry: '7' | '14' | 'expired' | ''
  page: number; limit: number;
}

export async function listSubscribers(params: SubscriberListParams) {
  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  const [memberships, companies, subByCompany, followUps] = await Promise.all([
    db.membership.findMany({ select: { userId: true, companyId: true, role: true } }),
    db.company.findMany({ select: { id: true, name: true, onboardingComplete: true } }),
    latestSubscriptionsByCompany(),
    (db as any).subscriberFollowUp.findMany({ select: { companyId: true, status: true, contactOptOut: true, nextFollowUpAt: true } }).catch(() => []),
  ]);
  const subsLike: CompanySubscriptionLike[] = companies.map((c) => toSubLike(c.id, c.name, subByCompany.get(c.id)));
  let rollups = buildSubscriberRollups({ users, memberships, companies, subscriptions: subsLike });

  const followByCompany = new Map((followUps as any[]).map((f) => [f.companyId, f]));
  let enriched = rollups.map((r) => ({
    ...r,
    user: { id: r.user.id, name: r.user.name, email: r.user.email, createdAt: new Date(r.user.createdAt).toISOString() },
    followUps: r.companies.map((c) => {
      const f = followByCompany.get(c.companyId);
      return { companyId: c.companyId, status: f?.status ?? null, contactOptOut: !!f?.contactOptOut };
    }),
  }));

  // Filters (server-side, applied to the per-user roll-up)
  const now = Date.now();
  if (params.search) {
    const q = params.search.toLowerCase();
    enriched = enriched.filter((r) => r.user.name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q) || r.companyNames.some((n) => n.toLowerCase().includes(q)));
  }
  if (params.plan) enriched = enriched.filter((r) => (r.planCounts[params.plan!] ?? 0) > 0);
  if (params.status) enriched = enriched.filter((r) => (r.statusCounts[params.status!] ?? 0) > 0);
  if (params.expiry) {
    const days = params.expiry === 'expired' ? null : Number(params.expiry);
    enriched = enriched.filter((r) => {
      if (!r.earliestTrialExpiry) return false;
      const t = Date.parse(r.earliestTrialExpiry);
      if (days === null) return t < now;
      return t >= now && t <= now + days * 86400000;
    });
  }

  const total = enriched.length;
  const start = (params.page - 1) * params.limit;
  return { data: enriched.slice(start, start + params.limit), total, page: params.page, limit: params.limit, totalPages: Math.max(1, Math.ceil(total / params.limit)) };
}

export async function subscriberDetail(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } });
  if (!user) return null;
  const memberships = await db.membership.findMany({ where: { userId }, include: { company: { select: { id: true, name: true, legalName: true, province: true, onboardingComplete: true, apiAccessEnabled: true, createdAt: true } } }, orderBy: { createdAt: 'asc' } });
  const subByCompany = await latestSubscriptionsByCompany();

  const companies = [] as any[];
  for (const m of memberships) {
    const c = m.company;
    const sub: any = subByCompany.get(c.id);
    const [milestones, bankSummary, apiSummary, followUp] = await Promise.all([
      derivedMilestones(c.id, c.createdAt, c.onboardingComplete),
      db.bankConnection.findMany({ where: { companyId: c.id }, select: { id: true, institutionName: true, status: true, lastSyncAt: true, createdAt: true } }),
      db.apiKey.findMany({ where: { companyId: c.id }, select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, requestCount: true, revokedAt: true, createdAt: true } }),
      (db as any).subscriberFollowUp.findUnique({ where: { companyId: c.id } }).catch(() => null),
    ]);
    companies.push({
      id: c.id, name: c.name, legalName: c.legalName, province: c.province,
      membershipRole: m.role, onboardingComplete: c.onboardingComplete, apiAccessEnabled: c.apiAccessEnabled,
      createdAt: c.createdAt.toISOString(),
      subscription: sub ? {
        planId: sub.planId, planName: sub.plan?.name ?? null, status: sub.status,
        trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        canceledAt: sub.canceledAt?.toISOString() ?? null,
        billingLabel: subscriptionBillingLabel(toSubLike(c.id, c.name, sub)),
        stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
        stripeCustomerId: sub.stripeCustomerId ?? null,
      } : null,
      milestones,
      bankConnections: bankSummary.map((b: any) => ({ id: b.id, institutionName: b.institutionName, status: b.status, lastSyncAt: b.lastSyncAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString() })),
      apiKeys: apiSummary.map((k: any) => ({ id: k.id, name: k.name, keyPrefix: k.keyPrefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, requestCount: k.requestCount, revoked: !!k.revokedAt, createdAt: k.createdAt.toISOString() })),
      followUp: followUp ? serializeFollowUp(followUp) : null,
    });
  }
  return { user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified?.toISOString() ?? null, createdAt: user.createdAt.toISOString() }, companies };
}

export function serializeFollowUp(f: any) {
  return {
    id: f.id, companyId: f.companyId, status: f.status, assignedAdminId: f.assignedAdminId ?? null,
    note: f.note ?? null, history: f.history ?? [],
    nextFollowUpAt: f.nextFollowUpAt?.toISOString?.() ?? f.nextFollowUpAt ?? null,
    lastContactedAt: f.lastContactedAt?.toISOString?.() ?? f.lastContactedAt ?? null,
    contactOptOut: !!f.contactOptOut,
    createdAt: f.createdAt?.toISOString?.() ?? f.createdAt, updatedAt: f.updatedAt?.toISOString?.() ?? f.updatedAt,
  };
}
