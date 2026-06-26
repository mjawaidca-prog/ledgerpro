import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET /api/reports/custom — generate or list templates
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accounts = searchParams.get('accounts');
    const groupBy = searchParams.get('groupBy') || 'type';

    // If accounts param provided, generate the report
    if (accounts) {
      const accountCodes = accounts.split(',');
      const coaRows = await db.chartOfAccount.findMany({
        where: { companyId, code: { in: accountCodes }, active: true },
        select: { code: true, name: true, type: true, balance: true },
      });

      const rows = coaRows.map(r => ({
        code: r.code, name: r.name,
        type: r.type, balance: Number(r.balance),
      }));

      const total = rows.reduce((s, r) => s + r.balance, 0);

      return NextResponse.json({ data: { rows, total } });
    }

    // Otherwise, list saved templates
    const templates = await db.reportTemplate.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ data: templates });
  } catch (error) {
    console.error('GET /api/reports/custom error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/reports/custom — save a template
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { name, reportType, config } = body;

    if (!name || !reportType) {
      return NextResponse.json({ error: 'Name and reportType are required' }, { status: 400 });
    }

    const template = await db.reportTemplate.create({
      data: { companyId, name, reportType, config: config || {}, createdBy: userId },
    });

    await auditLog(companyId, userId, 'report_template.create', 'report_template', template.id);

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 });
  }
}
