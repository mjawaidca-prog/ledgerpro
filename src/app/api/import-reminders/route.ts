import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

function computeNextRun(cadence: string, dayOfMonth: number | null, dayOfWeek: number | null): Date {
  const now = new Date();
  const next = new Date(now);
  if (cadence === 'weekly') {
    const target = dayOfWeek ?? 1; // Monday
    const diff = (target - now.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + diff);
  } else {
    const day = cadence === 'semimonthly' ? Math.min(dayOfMonth ?? 15, 28) : dayOfMonth ?? 1;
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    next.setDate(day);
  }
  next.setHours(9, 0, 0, 0);
  return next;
}

/** GET /api/import-reminders — the company's reminder settings (defaults if unset). */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const reminder = await db.importReminder.findUnique({ where: { companyId } });
    if (!reminder) {
      return NextResponse.json({
        data: {
          cadence: 'monthly',
          dayOfMonth: 1,
          dayOfWeek: 1,
          accountIds: [],
          channel: ['in_app'],
          nextRunAt: computeNextRun('monthly', 1, null).toISOString(),
        },
      });
    }
    return NextResponse.json({ data: reminder });
  } catch (err) {
    console.error('GET /api/import-reminders error:', err);
    return NextResponse.json({ error: 'Failed to load the reminder' }, { status: 500 });
  }
}

/** PUT /api/import-reminders — update cadence/scope; recomputes nextRunAt. */
export async function PUT(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const cadence = ['monthly', 'semimonthly', 'weekly'].includes(body.cadence) ? body.cadence : 'monthly';
    const dayOfMonth = body.dayOfMonth != null ? Number(body.dayOfMonth) : null;
    const dayOfWeek = body.dayOfWeek != null ? Number(body.dayOfWeek) : null;
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds : [];

    const nextRunAt = computeNextRun(cadence, dayOfMonth, dayOfWeek);

    const reminder = await db.importReminder.upsert({
      where: { companyId },
      update: { cadence, dayOfMonth, dayOfWeek, accountIds, nextRunAt, channel: ['in_app'] },
      create: { companyId, cadence, dayOfMonth, dayOfWeek, accountIds, nextRunAt, channel: ['in_app'] },
    });

    await auditLog(companyId, userId, 'import_reminder.update', 'ImportReminder', reminder.id, { cadence, accountIds } as any);
    return NextResponse.json({ data: reminder });
  } catch (err) {
    console.error('PUT /api/import-reminders error:', err);
    return NextResponse.json({ error: 'Failed to save the reminder' }, { status: 500 });
  }
}
