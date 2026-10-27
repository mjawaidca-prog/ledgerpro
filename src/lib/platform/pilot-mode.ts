// Read-only display mirror of src/lib/bank-feed/pilot.ts for the Control
// Center banner. It does NOT gate anything — pilot.ts remains the enforcement.
export function bankFeedPilotMode(env: NodeJS.ProcessEnv = process.env): { pilotGated: boolean; label: string } {
  if (env.BANK_FEEDS_DISABLED === 'true') return { pilotGated: true, label: 'Bank feeds are globally paused (BANK_FEEDS_DISABLED).' };
  if (env.PLAID_ENV !== 'production') {
    return env.VERCEL_ENV === 'production'
      ? { pilotGated: true, label: 'Bank feeds are not live in production (Plaid is not in production mode).' }
      : { pilotGated: false, label: 'Non-production environment — bank feeds are not pilot-gated here.' };
  }
  const allowed = (env.BANK_FEED_PILOT_COMPANY_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { pilotGated: true, label: `Bank feeds are in pilot mode: ${allowed.length} compan${allowed.length === 1 ? 'y' : 'ies'} allow-listed.` };
}
