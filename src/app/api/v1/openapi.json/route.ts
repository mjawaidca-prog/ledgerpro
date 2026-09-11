import { NextResponse } from 'next/server';
import { openapiDocument } from '@/lib/api/openapi';
export const dynamic = 'force-dynamic';

// GET /api/v1/openapi.json — the public API's OpenAPI 3.0 document.
// Intentionally unauthenticated: it describes the API, it grants nothing.
export async function GET() {
  return NextResponse.json(openapiDocument(), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
