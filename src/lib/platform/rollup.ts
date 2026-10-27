// Pure aggregation helpers for the Control Center (CC-2/CC-3).
// Counting rules (revised plan §2.3):
//  - Subscription / trial counts are PER COMPANY-SUBSCRIPTION.
//  - The subscriber list is PER USER: one row per user no matter how many
//    companies they belong to; companies roll up inside that row.

export interface CompanySubscriptionLike {
  companyId: string;
  companyName: string;
  planId?: string | null;
  planName?: string | null;
  status: string; // SubscriptionStatus
  trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}

export interface UserLike {
  id: string;
  name: string;
  email: string;
  createdAt: Date | string;
}

export interface MembershipLike {
  userId: string;
  companyId: string;
  role: string;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** A subscription is "complimentary" when it carries no Stripe subscription
 *  and is on the Owner plan (created in production 2026-10-26) — or, more
 *  generally, has no Stripe subscription at all; the label distinguishes the
 *  Owner-plan case the console must never flag as a billing discrepancy. */
export function subscriptionBillingLabel(sub: CompanySubscriptionLike): 'stripe' | 'complimentary_owner' | 'no_stripe' {
  if (sub.stripeSubscriptionId) return 'stripe';
  if (sub.planId === 'plan_owner' || sub.planName === 'Owner') return 'complimentary_owner';
  return 'no_stripe';
}

export interface SubscriberRollup {
  user: UserLike;
  companyCount: number;
  companyNames: string[];
  companies: Array<CompanySubscriptionLike & { membershipRole: string | null; billingLabel: string }>;
  /** e.g. { "Free Trial": 2, "Pro": 1 } */
  planCounts: Record<string, number>;
  /** e.g. { trialing: 2, active: 1 } */
  statusCounts: Record<string, number>;
  earliestTrialExpiry: string | null; // ISO
  onboarding: { complete: number; total: number };
}

export function buildSubscriberRollups(input: {
  users: UserLike[];
  memberships: MembershipLike[];
  companies: Array<{ id: string; name: string; onboardingComplete: boolean }>;
  subscriptions: CompanySubscriptionLike[]; // latest subscription per company
}): SubscriberRollup[] {
  const companyById = new Map(input.companies.map((c) => [c.id, c]));
  const subByCompany = new Map(input.subscriptions.map((s) => [s.companyId, s]));
  const membershipsByUser = new Map<string, MembershipLike[]>();
  for (const m of input.memberships) {
    const arr = membershipsByUser.get(m.userId) ?? [];
    arr.push(m); membershipsByUser.set(m.userId, arr);
  }

  return input.users.map((user) => {
    const ms = membershipsByUser.get(user.id) ?? [];
    const companies: SubscriberRollup['companies'] = [];
    const planCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    let earliest: number | null = null;
    let onboardingComplete = 0;

    for (const m of ms) {
      const company = companyById.get(m.companyId);
      if (!company) continue;
      if (company.onboardingComplete) onboardingComplete += 1;
      const sub = subByCompany.get(m.companyId);
      const entry: CompanySubscriptionLike = sub ?? {
        companyId: m.companyId, companyName: company.name, planName: null, status: 'not_recorded',
      };
      if (sub) {
        const planKey = sub.planName ?? 'Unknown plan';
        planCounts[planKey] = (planCounts[planKey] ?? 0) + 1;
        statusCounts[sub.status] = (statusCounts[sub.status] ?? 0) + 1;
        if (sub.status === 'trialing') {
          const t = toTime(sub.trialEndsAt);
          if (t !== null && (earliest === null || t < earliest)) earliest = t;
        }
      }
      companies.push({ ...entry, companyName: company.name, membershipRole: m.role, billingLabel: sub ? subscriptionBillingLabel(sub) : 'no_stripe' });
    }

    companies.sort((a, b) => a.companyName.localeCompare(b.companyName));
    return {
      user,
      companyCount: companies.length,
      companyNames: companies.map((c) => c.companyName),
      companies,
      planCounts,
      statusCounts,
      earliestTrialExpiry: earliest !== null ? new Date(earliest).toISOString() : null,
      onboarding: { complete: onboardingComplete, total: companies.length },
    };
  });
}

export interface OverviewCounts {
  companiesBySubscriptionStatus: Record<string, number>; // per company-subscription
  totalCompanySubscriptions: number;
  trialsExpiringWithin7Days: number;
  trialsExpiringWithin14Days: number;
  signupsThisWeek: number; // users created since week start (input)
  bankConnectionsByStatus: Record<string, number>;
  activeApiKeys: number;
  deadWebhookDeliveries: number;
}

export function countTrialsExpiring(subs: CompanySubscriptionLike[], now: Date, days: number): number {
  const horizon = now.getTime() + days * 24 * 60 * 60 * 1000;
  return subs.filter((s) => {
    if (s.status !== 'trialing') return false;
    const t = toTime(s.trialEndsAt);
    return t !== null && t >= now.getTime() && t <= horizon;
  }).length;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0 Sun
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

export function isFollowUpDue(f: { status: string; nextFollowUpAt?: Date | string | null; contactOptOut: boolean }, now: Date): boolean {
  if (f.status === 'converted' || f.status === 'closed') return false;
  if (f.status === 'follow_up_due') return true;
  const t = toTime(f.nextFollowUpAt ?? null);
  return t !== null && t <= now.getTime();
}

/** Build a wa.me-free, sending-free email draft: title + body text the admin
 *  copies, plus a mailto: URL. There is deliberately no send function. */
export function buildFollowUpEmailDraft(input: { companyName: string; contactName?: string | null; trialEndsAt?: string | null; email?: string | null }): { subject: string; body: string; mailto: string; to: string } {
  const to = input.email ?? '';
  const subject = `Your LedgerPro trial — ${input.companyName}`;
  const greeting = input.contactName ? `Hi ${input.contactName.split(' ')[0]},` : 'Hi there,';
  const trialLine = input.trialEndsAt ? `I noticed the trial for ${input.companyName} runs to ${input.trialEndsAt}. ` : '';
  const body = `${greeting}\n\n${trialLine}I'm Muhammad from Nexvar Lab, the team behind LedgerPro. I'm checking in personally to see how the trial is going and whether anything is blocking you — setup, bank import, or GST settings.\n\nReply to this email and I'll help directly.\n\nThanks,\nMuhammad\nNexvar Lab Inc.`;
  return { subject, body, mailto: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, to };
}

export const FOLLOW_UP_STATUSES = ['new', 'reviewing', 'contacted', 'follow_up_due', 'converted', 'closed'] as const;
export function isValidFollowUpStatus(v: unknown): v is (typeof FOLLOW_UP_STATUSES)[number] {
  return typeof v === 'string' && (FOLLOW_UP_STATUSES as readonly string[]).includes(v);
}
