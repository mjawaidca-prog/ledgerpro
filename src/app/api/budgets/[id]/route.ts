import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  lines: z.array(z.object({
    glAccountCode: z.string().min(1),
    amount: z.number(),
    period: z.string().optional(),
  })).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const budget = await db.budget.findUnique({
      where: { id: params.id },
      include: { lines: true },
    });
    if (!budget || budget.companyId !== companyId) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    return NextResponse.json({ data: budget });
  } catch (error) {
    console.error('GET /api/budgets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch budget' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const budget = await db.budget.findUnique({ where: { id: params.id } });
    if (!budget || budget.companyId !== companyId) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // If lines provided, replace them
    if (parsed.data.lines) {
      await db.budgetLine.deleteMany({ where: { budgetId: params.id } });
      await db.budgetLine.createMany({
        data: parsed.data.lines.map((l) => ({
          budgetId: params.id,
          glAccountCode: l.glAccountCode,
          amount: l.amount,
          period: l.period || null,
        })),
      });
    }

    const updated = await db.budget.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
      include: { lines: true },
    });

    await auditLog(companyId, userId, 'budget.update', 'budget', params.id, { name: updated.name });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/budgets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update budget' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin'] });
    if (error) return error;

    const budget = await db.budget.findUnique({ where: { id: params.id } });
    if (!budget || budget.companyId !== companyId) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    await db.budgetLine.deleteMany({ where: { budgetId: params.id } });
    await db.budget.delete({ where: { id: params.id } });

    await auditLog(companyId, userId, 'budget.delete', 'budget', params.id, { name: budget.name });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error('DELETE /api/budgets/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete budget' }, { status: 500 });
  }
}
