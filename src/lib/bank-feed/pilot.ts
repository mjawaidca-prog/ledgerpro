// Production remains closed until an operator selects the pilot companies.
// Disconnect deliberately does not use this guard: stopping sync does not
// remove provider consent or end provider billing.
export function bankFeedPilotAllowed(companyId: string): boolean {
  if (process.env.BANK_FEEDS_DISABLED === 'true') return false;
  if (process.env.PLAID_ENV !== 'production') return process.env.VERCEL_ENV !== 'production';
  const allowed = (process.env.BANK_FEED_PILOT_COMPANY_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  return allowed.includes(companyId);
}
