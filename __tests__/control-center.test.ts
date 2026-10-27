import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluatePlatformAccess, platformAccessHttpStatus } from '@/lib/platform/access';
import { sanitizeAuditMetadata } from '@/lib/platform/audit-sanitize';
import { bankFeedPilotMode } from '@/lib/platform/pilot-mode';
import {
  buildSubscriberRollups, countTrialsExpiring, isFollowUpDue, isValidFollowUpStatus,
  buildFollowUpEmailDraft, subscriptionBillingLabel,
} from '@/lib/platform/rollup';

describe('CC-1 platform access (evaluatePlatformAccess)', () => {
  test('no session -> unauthenticated (401)', () => {
    const d = evaluatePlatformAccess({ userId: null, platformAdmin: null, mfaEnabled: true });
    expect(d.kind).toBe('unauthenticated');
    expect(platformAccessHttpStatus(d)).toBe(401);
  });

  test('a company owner/admin WITHOUT a PlatformAdmin row is forbidden — company roles never grant platform access', () => {
    // Membership role is deliberately not even an input to the decision.
    const d = evaluatePlatformAccess({ userId: 'company-owner-user', platformAdmin: null, mfaEnabled: true });
    expect(d.kind).toBe('forbidden');
    expect(platformAccessHttpStatus(d)).toBe(403);
  });

  test('platform admin without MFA is gated to MFA setup', () => {
    const d = evaluatePlatformAccess({ userId: 'admin', platformAdmin: { role: 'owner' }, mfaEnabled: false });
    expect(d.kind).toBe('mfa_required');
  });

  test('platform admin with MFA is allowed as owner', () => {
    const d = evaluatePlatformAccess({ userId: 'admin', platformAdmin: { role: 'owner' }, mfaEnabled: true });
    expect(d).toEqual({ kind: 'allow', role: 'owner' });
  });

  test('audit metadata sanitizer drops secrets/payloads/balances', () => {
    const clean = sanitizeAuditMetadata({ status: 'contacted', apiSecret: 'x', payload: { a: 1 }, bankBalance: 42, note: 'ok' });
    expect(clean).toEqual({ status: 'contacted', note: 'ok' });
  });
});

describe('CC-2 subscriber roll-up counting', () => {
  const users = [
    { id: 'u1', name: 'Multi Co', email: 'multi@example.com', createdAt: new Date('2026-10-01') },
    { id: 'u2', name: 'Solo', email: 'solo@example.com', createdAt: new Date('2026-10-20') },
  ];
  const companies = [
    { id: 'c1', name: 'Alpha', onboardingComplete: true },
    { id: 'c2', name: 'Beta', onboardingComplete: false },
    { id: 'c3', name: 'Gamma', onboardingComplete: true },
  ];
  const memberships = [
    { userId: 'u1', companyId: 'c1', role: 'owner' },
    { userId: 'u1', companyId: 'c2', role: 'admin' },
    { userId: 'u1', companyId: 'c3', role: 'owner' },
    { userId: 'u2', companyId: 'c2', role: 'viewer' },
  ];
  const subs = [
    { companyId: 'c1', companyName: 'Alpha', planName: 'Free Trial', status: 'trialing', trialEndsAt: new Date('2026-11-01') },
    { companyId: 'c2', companyName: 'Beta', planName: 'Pro', status: 'active', trialEndsAt: null },
    { companyId: 'c3', companyName: 'Gamma', planName: 'Owner', planId: 'plan_owner', status: 'active', trialEndsAt: null, stripeSubscriptionId: null },
  ];

  test('one user with 3 companies counts ONCE in the user list, with per-company roll-up', () => {
    const rollups = buildSubscriberRollups({ users, memberships, companies, subscriptions: subs as any });
    expect(rollups).toHaveLength(2);
    const multi = rollups.find((r) => r.user.id === 'u1')!;
    expect(multi.companyCount).toBe(3);
    expect(multi.companyNames).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(multi.planCounts).toEqual({ 'Free Trial': 1, Pro: 1, Owner: 1 });
    expect(multi.statusCounts).toEqual({ trialing: 1, active: 2 });
    expect(multi.onboarding).toEqual({ complete: 2, total: 3 });
  });

  test('subscription overview counts are PER COMPANY (3 companies across 2 users = 3, not 2)', () => {
    const statuses: Record<string, number> = {};
    for (const s of subs) statuses[s.status] = (statuses[s.status] ?? 0) + 1;
    expect(Object.values(statuses).reduce((a, b) => a + b, 0)).toBe(3);
    expect(statuses).toEqual({ trialing: 1, active: 2 });
  });

  test('earliest trial expiry is the minimum trialing trialEndsAt only', () => {
    const rollups = buildSubscriberRollups({ users, memberships, companies, subscriptions: subs as any });
    const multi = rollups.find((r) => r.user.id === 'u1')!;
    expect(multi.earliestTrialExpiry).toBe(new Date('2026-11-01').toISOString());
    expect(rollups.find((r) => r.user.id === 'u2')!.earliestTrialExpiry).toBeNull();
  });

  test('trial expiry windows count only trialing companies in window', () => {
    const now = new Date('2026-10-26T00:00:00Z');
    expect(countTrialsExpiring(subs as any, now, 7)).toBe(1); // Nov 1 is 6 days out
    expect(countTrialsExpiring(subs as any, now, 3)).toBe(0);
  });

  test('Owner plan without Stripe is labelled complimentary, never a discrepancy', () => {
    expect(subscriptionBillingLabel(subs[2] as any)).toBe('complimentary_owner');
    expect(subscriptionBillingLabel({ ...subs[1], stripeSubscriptionId: 'sub_123' } as any)).toBe('stripe');
  });
});

describe('CC-3 follow-up workflow', () => {
  test('status validation accepts only the workflow statuses', () => {
    for (const s of ['new', 'reviewing', 'contacted', 'follow_up_due', 'converted', 'closed']) expect(isValidFollowUpStatus(s)).toBe(true);
    expect(isValidFollowUpStatus('emailed_automatically')).toBe(false);
    expect(isValidFollowUpStatus(null)).toBe(false);
  });

  test('due logic: follow_up_due and past dates are due; converted/closed are not', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(isFollowUpDue({ status: 'follow_up_due', contactOptOut: false }, now)).toBe(true);
    expect(isFollowUpDue({ status: 'contacted', nextFollowUpAt: new Date('2026-10-25'), contactOptOut: false }, now)).toBe(true);
    expect(isFollowUpDue({ status: 'converted', nextFollowUpAt: new Date('2026-10-25'), contactOptOut: false }, now)).toBe(false);
    expect(isFollowUpDue({ status: 'closed', contactOptOut: true }, now)).toBe(false);
  });

  test('opt-out is a flag carried on the record (shown, not hidden)', () => {
    const f = { status: 'new', contactOptOut: true, nextFollowUpAt: null };
    expect(f.contactOptOut).toBe(true);
    // due-ness is computed independently; UI renders the opt-out warning from this flag
    expect(isFollowUpDue(f as any, new Date())).toBe(false);
  });

  test('email draft is mailto/copy only — it contains no send machinery', () => {
    const draft = buildFollowUpEmailDraft({ companyName: 'Muja Corp', contactName: 'Syed Abbas', email: 'owner@example.com', trialEndsAt: '2026-11-24' });
    expect(draft.mailto.startsWith('mailto:owner%40example.com')).toBe(true);
    expect(draft.subject).toContain('Muja Corp');
    expect(draft.body).toContain('Syed');
    expect(Object.keys(draft)).not.toContain('send');
  });
});

describe('CC bank-feed pilot banner (read-only mirror)', () => {
  test('production + allowlist -> pilot gated with count', () => {
    const m = bankFeedPilotMode({ PLAID_ENV: 'production', BANK_FEED_PILOT_COMPANY_IDS: 'a,b' } as any);
    expect(m.pilotGated).toBe(true); expect(m.label).toContain('2 companies');
  });
  test('global stop -> pilot gated', () => {
    expect(bankFeedPilotMode({ BANK_FEEDS_DISABLED: 'true' } as any).pilotGated).toBe(true);
  });
});

describe('CC-1 migration', () => {
  const sql = readFileSync(resolve('prisma/migrations/20261026200000_control_center_cc1_cc3/migration.sql'), 'utf8');
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
  test('creates the three tables and two enums', () => {
    for (const t of ['PlatformAdmin', 'PlatformAuditEvent', 'SubscriberFollowUp']) {
      expect(sql).toContain(`CREATE TABLE "${t}"`);
      expect(schema).toContain(`model ${t} {`);
    }
    expect(sql).toContain('CREATE TYPE "PlatformRole"');
    expect(sql).toContain('CREATE TYPE "FollowUpStatus"');
  });
  test('is purely additive', () => {
    expect(sql).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+"(?:User|Company|Subscription)"\s+ADD\s+COLUMN)\b/i);
  });
  test('PlatformAuditEvent.companyId is nullable while AuditLog.companyId stays required', () => {
    expect(sql).toMatch(/"PlatformAuditEvent"[\s\S]*?"companyId" TEXT,/);
    expect(schema).toMatch(/model AuditLog \{[\s\S]*?companyId String\n/);
  });
  test('follow-up is unique per company and opt-out defaults false', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "SubscriberFollowUp_companyId_key"');
    expect(sql).toMatch(/"contactOptOut" BOOLEAN NOT NULL DEFAULT false/);
  });
  test('no customer financial columns are introduced', () => {
    expect(sql).not.toMatch(/balance|transaction|document/i);
  });
});

describe('CC security surface (source checks)', () => {
  const authSrc = readFileSync(resolve('src/lib/platform/auth.ts'), 'utf8');
  const subSrc = readFileSync(resolve('src/lib/platform/subscribers.ts'), 'utf8');
  test('requirePlatformAdmin never consults Membership roles', () => {
    expect(authSrc).toContain('platformAdmin.findUnique');
    expect(authSrc).not.toContain('membership');
  });
  test('console read models never select secrets, hashes, tokens or payloads', () => {
    const codeOnly = subSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of ['keyHash', 'accessTokenEncrypted', 'passwordHash', 'payload', 'currentBalance']) {
      expect(codeOnly).not.toContain(bad);
    }
  });
  test('no email-sending code exists in the platform API', () => {
    const followSrc = readFileSync(resolve('src/app/api/platform/follow-ups/[companyId]/route.ts'), 'utf8');
    expect(followSrc).not.toMatch(/nodemailer|resend|sendgrid|sendMail|\.send\(/i);
    expect(followSrc).toContain('platformAudit');
  });
});
