// Bank feeds launched to all customers on 2026-11-09: in production the
// pilot allow-list (BANK_FEED_PILOT_COMPANY_IDS) no longer restricts access —
// any company whose plan includes bank feeds may connect and sync (the plan
// entitlement itself is enforced separately, at token exchange).
//
// Two operator controls remain:
//   BANK_FEEDS_DISABLED=true — global pause; blocks connect and sync.
//   BANK_FEED_PILOT_MODE=true — emergency rollback that re-arms the
//     BANK_FEED_PILOT_COMPANY_IDS allow-list below.
// Disconnect deliberately does not use this guard: stopping sync does not
// remove provider consent or end provider billing.
export function bankFeedPilotAllowed(companyId: string): boolean {
  if (process.env.BANK_FEEDS_DISABLED === 'true') return false;
  if (process.env.PLAID_ENV !== 'production') return process.env.VERCEL_ENV !== 'production';
  if (process.env.BANK_FEED_PILOT_MODE !== 'true') return true;
  const allowed = (process.env.BANK_FEED_PILOT_COMPANY_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  return allowed.includes(companyId);
}
