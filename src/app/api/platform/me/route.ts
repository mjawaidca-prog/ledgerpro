import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform/auth';
export const dynamic = 'force-dynamic';
// GET /api/platform/me — used by the Rail to show the Control Center link
// ONLY to platform admins. Non-admins get 403 (link stays hidden).
export async function GET() {
  const { ctx, error } = await requirePlatformAdmin();
  if (error) return error;
  return NextResponse.json({ data: { isPlatformAdmin: true, role: ctx!.role, email: ctx!.email } });
}
