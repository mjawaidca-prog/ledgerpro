// The Owner plan is an internal, platform-only plan ($0, all features)
// reserved for the platform operator's own companies. It is not a public
// tier: it must never appear in public plan listings, and only a platform
// admin (see src/lib/platform/auth.ts) may assign it to a company.
//
// There is deliberately no isPublic column on Plan — the production Owner
// row (id 'plan_owner', created outside the seeds) is identified here by id,
// with the exact name as a belt-and-braces match.
export const OWNER_PLAN_ID = 'plan_owner';

export function isOwnerPlan(plan: { id: string; name?: string | null }): boolean {
  return plan.id === OWNER_PLAN_ID || plan.name === 'Owner';
}
