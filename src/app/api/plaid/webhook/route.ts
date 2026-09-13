import { NextRequest, NextResponse } from 'next/server';
import { verifyPlaidWebhook } from '@/lib/bank-feed/webhook';
import { syncConnection } from '@/lib/bank-feed/sync';
export const dynamic = 'force-dynamic';

// POST /api/plaid/webhook — Plaid's entrypoint (NOT session-authed; the
// Plaid-Verification JWT is the only credential). SYNC_UPDATES_AVAILABLE is
// the primary sync trigger; other codes are acknowledged without action.
export async function POST(req: NextRequest) {
  const verification = req.headers.get('plaid-verification');
  const body = await req.json().catch(() => null);
  const itemId = body?.item_id as string | undefined;
  const webhookCode = body?.webhook_code as string | undefined;
  const webhookType = body?.webhook_type as string | undefined;

  // Unverified payloads are rejected before anything else runs.
  const verified = await verifyPlaidWebhook({ verificationHeader: verification, itemId: itemId ?? '' });
  if (!verified) {
    return NextResponse.json({ error: 'Unverified webhook.' }, { status: 400 });
  }

  if (webhookType === 'TRANSACTIONS' && webhookCode === 'SYNC_UPDATES_AVAILABLE') {
    // Awaited and bounded inside syncConnection (page + time budgets) — the
    // daily cron is the safety net if this invocation is cut short.
    try {
      await syncConnection(verified.connectionId, 'webhook');
    } catch (error) {
      console.error('[plaid-webhook] sync failed:', error);
    }
  }

  return NextResponse.json({ received: true });
}
