import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// GET /api/v1 — friendly index for the API root. Public like openapi.json:
// it describes the API and grants nothing.
export async function GET() {
  return NextResponse.json(
    {
      name: 'LedgerPro API',
      version: 'v1',
      description: 'Versioned public API for LedgerPro accounting.',
      openapi: '/api/v1/openapi.json',
      docs: 'https://ledger.nexvarlab.com/help',
      webhooks: 'Signed HMAC-SHA256 events; see the OpenAPI document for verification.',
      auth: 'Authorization: Bearer lp_live_… (Settings → Developer / API Access)',
    },
    { headers: { 'cache-control': 'public, max-age=300' } }
  );
}
