import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { postJournalEntry } from '@/lib/journal';
export const dynamic = 'force-dynamic';

const VALID_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

interface ConfirmRow {
  code: string;
  name: string;
  debit: number;
  credit: number;
  matched: boolean;
  type?: string; // required when matched === false
}

// POST — create any missing GL accounts and post the opening balances as a
// single balanced journal entry dated `asOfDate`. This is what makes a
// migrated trial balance a real part of the ledger rather than a one-off
// import artifact — every dollar in it is a normal, auditable posting.
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { asOfDate, rows } = body as { asOfDate: string; rows: ConfirmRow[] };

    if (!asOfDate || !rows?.length) {
      return NextResponse.json({ error: 'asOfDate and rows are required' }, { status: 400 });
    }

    const entryDate = new Date(asOfDate);
    const guardError = await closedPeriodGuard(companyId, entryDate);
    if (guardError) return guardError;

    const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.02) {
      return NextResponse.json(
        { error: `Rows are not balanced: total debits ${totalDebit.toFixed(2)} vs total credits ${totalCredit.toFixed(2)}` },
        { status: 400 }
      );
    }

    for (const row of rows) {
      if (!row.matched && !VALID_TYPES.includes(row.type || '')) {
        return NextResponse.json({ error: `Account ${row.code} (${row.name}) needs a valid account type before it can be created` }, { status: 400 });
      }
    }

    const result = await db.$transaction(async (tx) => {
      let created = 0;
      for (const row of rows) {
        if (row.matched) continue;
        const existing = await tx.chartOfAccount.findUnique({ where: { companyId_code: { companyId, code: row.code } } });
        if (existing) continue; // race/duplicate row in the same file — skip
        await tx.chartOfAccount.create({
          data: {
            companyId,
            code: row.code,
            name: row.name,
            type: row.type as any,
            balance: 0,
            active: true,
          },
        });
        created++;
      }

      const entry = await postJournalEntry(
        {
          entryDate,
          description: `Opening balance import as of ${asOfDate}`,
          sourceType: 'manual',
          createdBy: userId,
          lines: rows.map((r) => ({
            glAccountCode: r.code,
            description: 'Opening balance',
            debit: r.debit || 0,
            credit: r.credit || 0,
          })),
        },
        companyId,
        tx
      );

      return { entry, created };
    });

    await auditLog(companyId, userId, 'trial_balance.import', 'journal_entry', result.entry.id, {
      accountsCreated: result.created,
      rowCount: rows.length,
      asOfDate,
    });

    return NextResponse.json({ data: { journalEntryId: result.entry.id, accountsCreated: result.created } }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/import/trial-balance/confirm error:', error);
    return NextResponse.json({ error: error.message || 'Failed to import trial balance' }, { status: 500 });
  }
}
