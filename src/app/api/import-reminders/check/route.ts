import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * GET /api/import-reminders/check — Vercel cron entrypoint (CRON_SECRET
 * bearer-guarded, same pattern as /api/fx/sync-cron). Fires due import
 * reminders as in-app notifications and advances nextRunAt.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const due = await db.importReminder.findMany({ where: { nextRunAt: { lte: now } } });
    let fired = 0;

    for (const reminder of due) {
      const accounts = await db.financialAccount.findMany({
        where: {
          companyId: reminder.companyId,
          isActive: true,
          ...(reminder.accountIds.length ? { id: { in: reminder.accountIds } } : {}),
        },
        select: { id: true, name: true, lastImportAt: true },
      });

      const stale = accounts.filter((a) => !a.lastImportAt || a.lastImportAt < new Date(now.getTime() - 14 * 86400000));
      const names = stale.map((a) => a.name);
      if (names.length > 0) {
        await createNotification({
          companyId: reminder.companyId,
          type: 'import_reminder',
          title: 'Import reminder',
          body: `Import statements for: ${names.join(', ')}.`,
          actionUrl: '/banking',
        });
        fired++;
      }

      // Advance nextRunAt by the cadence.
      const next = new Date(reminder.nextRunAt);
      if (reminder.cadence === 'weekly') {
        next.setDate(next.getDate() + 7);
      } else if (reminder.cadence === 'semimonthly') {
        next.setDate(next.getDate() + 14);
      } else {
        next.setMonth(next.getMonth() + 1);
      }
      await db.importReminder.update({ where: { id: reminder.id }, data: { nextRunAt: next } });
    }

    return NextResponse.json({ data: { fired } });
  } catch (err) {
    console.error('GET /api/import-reminders/check error:', err);
    return NextResponse.json({ error: 'Reminder check failed' }, { status: 500 });
  }
}
