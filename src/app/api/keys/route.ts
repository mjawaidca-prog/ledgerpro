import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { generateApiKeyToken } from '@/lib/api-keys';
export const dynamic = 'force-dynamic';

// Only "read" exists until API-C ships write scopes. The whitelist lives
// server-side: a client cannot invent a permission.
const AVAILABLE_PERMISSIONS = ['read'];

const keyListSelect = {
  id: true,
  name: true,
  keyPrefix: true,
  permissions: true,
  expiresAt: true,
  lastUsedAt: true,
  requestCount: true,
  revokedAt: true,
  createdAt: true,
} as const;

// GET — list this company's API keys plus the company-level switch state.
// Secrets are never returned; only the display prefix.
export async function GET(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const company = await db.company.findUnique({
      where: { id: session.companyId! },
      select: { apiAccessEnabled: true },
    });

    const keys = await db.apiKey.findMany({
      where: { companyId: session.companyId! },
      select: keyListSelect,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: { apiAccessEnabled: company?.apiAccessEnabled ?? false, keys },
    });
  } catch (error) {
    console.error('GET /api/keys error:', error);
    return NextResponse.json({ error: 'Failed to load API keys' }, { status: 500 });
  }
}

// POST — create a key. The generated secret is returned exactly once; only
// its SHA-256 hash is stored. Owner-only, tenant-scoped to the owner's
// active company.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const body = await req.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const permissions = Array.isArray(body?.permissions) ? body.permissions : [];

    if (!name || name.length > 80) {
      return NextResponse.json({ error: 'A key name between 1 and 80 characters is required.' }, { status: 400 });
    }

    const unknown = permissions.filter((p: unknown) => !AVAILABLE_PERMISSIONS.includes(p as string));
    if (unknown.length || !permissions.includes('read')) {
      return NextResponse.json(
        { error: `Invalid permissions. Available scopes: ${AVAILABLE_PERMISSIONS.join(', ')}.` },
        { status: 400 }
      );
    }

    let expiresAt: Date | null = null;
    if (body?.expiresAt) {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Expiry must be a future date.' }, { status: 400 });
      }
      expiresAt = parsed;
    }

    const { token, prefix, hash } = generateApiKeyToken();

    const key = await db.apiKey.create({
      data: {
        companyId: session.companyId!,
        name,
        keyPrefix: prefix,
        keyHash: hash,
        permissions: permissions as ('read')[],
        expiresAt,
        createdById: session.userId ?? null,
      },
      select: keyListSelect,
    });

    await auditLog(session.companyId!, session.userId, 'api_key.create', 'api_key', key.id, undefined, {
      keyName: name,
      permissions,
    });

    // The secret appears in this response and nowhere else — not in the
    // database (hash only) and not in any log.
    return NextResponse.json({ data: { key, secret: token } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/keys error:', error);
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}
