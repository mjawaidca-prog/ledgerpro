import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { hasApiPlanAccess } from '@/lib/api/auth';
import { payrollConnectionState } from '@/lib/payroll-status';
export const dynamic = 'force-dynamic';

// GET — payroll-sync status for the active company, derived from LedgerPro's
// own records: the company's API switch + plan, its API keys, and the
// journals the Nexvar Pay sync has posted (sourceType 'payroll').
export async function GET(req: NextRequest) {
  try {
    const session = await requireCompany(req);
    if (session.error) return session.error;
    const companyId = session.companyId!;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { apiAccessEnabled: true },
    });
    const apiAccessEnabled = company?.apiAccessEnabled ?? false;
    const planApiAccess = await hasApiPlanAccess(companyId);

    const keys: Array<{
      id: string; name: string; keyPrefix: string; permissions: string[];
      lastUsedAt: Date | null; requestCount: number; createdAt: Date;
    }> = await db.apiKey.findMany({
      where: { companyId, revokedAt: null },
      select: {
        id: true, name: true, keyPrefix: true, permissions: true,
        lastUsedAt: true, requestCount: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const writeKeys = keys.filter((k) => k.permissions.includes('write_posting'));

    const payrollRunCount = await db.journalEntry.count({
      where: { companyId, sourceType: 'payroll', reversalOfId: null },
    });
    const lastRun = payrollRunCount > 0
      ? await db.journalEntry.findFirst({
          where: { companyId, sourceType: 'payroll', reversalOfId: null },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, description: true },
        })
      : null;

    const state = payrollConnectionState({
      apiAccessEnabled,
      planApiAccess,
      activeWriteKeyCount: writeKeys.length,
      payrollRunCount,
    });

    return NextResponse.json({
      data: {
        state,
        apiAccessEnabled,
        planApiAccess,
        writeKeyCount: writeKeys.length,
        latestWriteKey: writeKeys[0]
          ? {
              name: writeKeys[0].name,
              keyPrefix: writeKeys[0].keyPrefix,
              lastUsedAt: writeKeys[0].lastUsedAt,
              requestCount: writeKeys[0].requestCount,
            }
          : null,
        payrollRunCount,
        lastPayrollRunAt: lastRun?.createdAt ?? null,
        lastPayrollRunDescription: lastRun?.description ?? null,
      },
    });
  } catch (error) {
    console.error('GET /api/payroll/status error:', error);
    return NextResponse.json({ error: 'Failed to load payroll status.' }, { status: 500 });
  }
}
