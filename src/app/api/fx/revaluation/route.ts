import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { resolveRate } from '@/lib/fx/rate';
import { isMonetaryAccount, buildRevaluationRows, revaluationJournalLines, type ForeignBalance } from '@/lib/fx/revaluation';
import { postJournalEntry } from '@/lib/journal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/fx/revaluation — post the month-end entry AND its first-of-next-
 * month reversal, atomically. Idempotent per company-month via
 * @@unique([companyId, asOf]); a re-run returns 409 with the posted record.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const asOf = typeof body.asOf === 'string' ? body.asOf : new Date().toISOString().slice(0, 10);
    const fxAccountCode = typeof body.glAccountCode === 'string' ? body.glAccountCode : null;

    const guardError = await closedPeriodGuard(companyId, new Date(asOf));
    if (guardError) return guardError;

    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const home = company.currency;
    const unrealizedCode = fxAccountCode ?? company.unrealizedFxAccountCode ?? '4320';

    // Idempotency: an existing non-voided run for this month loads its state.
    const existing = await db.fxRevaluation.findFirst({
      where: { companyId, asOf: new Date(asOf), voidedAt: null },
      include: { journalEntry: true, reversalEntry: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'A revaluation is already posted for this month. Void it before running again.', data: existing },
        { status: 409 }
      );
    }

    const accounts = await db.chartOfAccount.findMany({ where: { companyId, active: true } });
    const monetary = accounts.filter((a) => isMonetaryAccount(a as any));

    const lines = await db.journalLine.findMany({
      where: {
        glAccountCode: { in: monetary.map((a) => a.code) },
        journalEntry: { companyId, voidedAt: null, entryDate: { lte: new Date(asOf) } },
      },
      select: { glAccountCode: true, currency: true, debit: true, credit: true, debitForeign: true, creditForeign: true },
    });

    const byAccount = new Map<string, ForeignBalance>();
    for (const l of lines) {
      if (!l.currency || l.currency === home) continue;
      const key = l.glAccountCode;
      let b = byAccount.get(key);
      if (!b) {
        const acct = monetary.find((a) => a.code === key)!;
        b = { accountCode: key, accountName: acct.name, type: acct.type as 'asset' | 'liability', currency: l.currency, balanceForeign: 0, carryingHome: 0 };
        byAccount.set(key, b);
      }
      b.balanceForeign += Number(l.debitForeign ?? 0) - Number(l.creditForeign ?? 0);
      b.carryingHome += Number(l.debit) - Number(l.credit);
    }

    const currencies = [...new Set([...byAccount.values()].map((b) => b.currency))];
    const rates: Record<string, number> = {};
    for (const ccy of currencies) {
      const resolved = await resolveRate(ccy, home, asOf, 'closing');
      if (resolved.rate) rates[ccy] = resolved.rate;
    }

    const { rows, net, missingRates } = buildRevaluationRows({ balances: [...byAccount.values()], rates });
    if (missingRates.length) {
      return NextResponse.json(
        { error: `Missing closing rates for: ${missingRates.join(', ')}. Add them in Settings › FX Rates.` },
        { status: 400 }
      );
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nothing to revalue — every foreign-currency balance is either nil or already carried at the closing rate.' }, { status: 400 });
    }

    const entryLines = revaluationJournalLines(rows, unrealizedCode, asOf);
    const reversalDate = new Date(asOf);
    reversalDate.setDate(reversalDate.getDate() + 1);
    while (reversalDate.getMonth() === new Date(asOf).getMonth()) {
      reversalDate.setDate(reversalDate.getDate() + 1);
    }

    const result = await db.$transaction(async (tx) => {
      const entry = await postJournalEntry(
        {
          entryDate: new Date(asOf),
          description: `FX revaluation as at ${asOf}`,
          sourceType: 'revaluation',
          createdBy: userId ?? undefined,
          lines: entryLines,
        },
        companyId,
        tx
      );

      const reversal = await postJournalEntry(
        {
          entryDate: reversalDate,
          description: `Reversal of: FX revaluation as at ${asOf}`,
          sourceType: 'revaluation',
          createdBy: userId ?? undefined,
          lines: entryLines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description,
            debit: l.credit,
            credit: l.debit,
            currency: l.currency,
            fxRate: l.fxRate,
          })),
        },
        companyId,
        tx
      );
      await tx.journalEntry.update({
        where: { id: reversal.id },
        data: { reversalOfId: entry.id },
      });

      const reval = await tx.fxRevaluation.create({
        data: {
          companyId,
          asOf: new Date(asOf),
          rateType: 'closing',
          netAmount: net,
          journalEntryId: entry.id,
          reversalEntryId: reversal.id,
          lines: rows as any,
          postedById: userId ?? '',
        },
      });

      await tx.journalEntry.updateMany({
        where: { id: { in: [entry.id, reversal.id] } },
        data: { sourceId: reval.id },
      });

      return { reval, entry, reversal };
    });

    await auditLog(companyId, userId, 'fx_revaluation.post', 'FxRevaluation', result.reval.id, { asOf, net } as any);

    return NextResponse.json({ data: result.reval }, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/fx/revaluation error:', err);
    return NextResponse.json({ error: err.message || 'Failed to post revaluation' }, { status: 500 });
  }
}
