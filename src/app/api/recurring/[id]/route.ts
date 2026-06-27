import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const template = await db.recurringTemplate.findUnique({
      where: { id: params.id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template || template.companyId !== companyId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: template });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const existing = await db.recurringTemplate.findUnique({ where: { id: params.id } });
    if (!existing || existing.companyId !== companyId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { lines, ...data } = body;

    // Delete old lines and recreate
    await db.recurringLine.deleteMany({ where: { templateId: params.id } });

    const template = await db.recurringTemplate.update({
      where: { id: params.id },
      data: {
        ...data,
        nextPostDate: data.nextPostDate ? new Date(data.nextPostDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : null,
        lines: lines ? { create: lines.map((l: any, i: number) => ({ ...l, sortOrder: i })) } : undefined,
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });

    await auditLog(companyId, userId, 'recurring.update', 'recurring_template', params.id);

    return NextResponse.json({ data: template });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin'] });
    if (error) return error;

    const existing = await db.recurringTemplate.findUnique({ where: { id: params.id } });
    if (!existing || existing.companyId !== companyId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.recurringTemplate.delete({ where: { id: params.id } });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
