import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { CONSOLIDATED_STATEMENTS } from '@/lib/consolidation/types';

export const dynamic = 'force-dynamic';

/** Saved consolidated-report packages — scoped to the authenticated user. */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const packages = await db.reportPackage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ data: packages });
  } catch (err) {
    console.error('GET /api/reports/packages error:', err);
    return NextResponse.json({ error: 'Failed to load packages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const setup = body.setup;

    if (!name) return NextResponse.json({ error: 'Package name is required.' }, { status: 400 });
    if (
      !setup ||
      typeof setup !== 'object' ||
      !CONSOLIDATED_STATEMENTS.includes(setup.statement) ||
      !Array.isArray(setup.companyIds) ||
      setup.companyIds.length < 1
    ) {
      return NextResponse.json({ error: 'Invalid package setup.' }, { status: 400 });
    }

    const pkg = await db.reportPackage.create({
      data: { userId, name, setup: setup as any },
    });
    return NextResponse.json({ data: pkg }, { status: 201 });
  } catch (err) {
    console.error('POST /api/reports/packages error:', err);
    return NextResponse.json({ error: 'Failed to save package' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing package id.' }, { status: 400 });

    const existing = await db.reportPackage.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ error: 'Package not found.' }, { status: 404 });

    await db.reportPackage.delete({ where: { id } });
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('DELETE /api/reports/packages error:', err);
    return NextResponse.json({ error: 'Failed to delete package' }, { status: 500 });
  }
}
