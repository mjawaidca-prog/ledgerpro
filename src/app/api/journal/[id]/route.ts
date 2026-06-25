import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET — single journal entry with full line details
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const entry = await db.journalEntry.findUnique({
      where: { id: params.id, companyId },
      include: {
        lines: {
          select: { id: true, glAccountCode: true, description: true, debit: true, credit: true },
          orderBy: [{ debit: 'desc' }, { credit: 'desc' }],
        },
      },
    });

    if (!entry) {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
    }

    // Get account names for each line
    const codes = [...new Set(entry.lines.map((l) => l.glAccountCode))];
    const accounts = await db.chartOfAccount.findMany({
      where: { code: { in: codes }, companyId },
      select: { code: true, name: true, type: true },
    });
    const acctMap = new Map(accounts.map((a) => [a.code, a]));

    const linesWithNames = entry.lines.map((l) => ({
      ...l,
      debit: Number(l.debit),
      credit: Number(l.credit),
      accountName: acctMap.get(l.glAccountCode)?.name || l.glAccountCode,
      accountType: acctMap.get(l.glAccountCode)?.type || 'unknown',
    }));

    return NextResponse.json({
      data: {
        ...entry,
        lines: linesWithNames,
        totalDebits: linesWithNames.reduce((s, l) => s + l.debit, 0),
        totalCredits: linesWithNames.reduce((s, l) => s + l.credit, 0),
      },
    });
  } catch (error) {
    console.error('GET /api/journal/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch journal entry' }, { status: 500 });
  }
}

// PUT — update a manual journal entry (reverse old, post new)
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { entryDate, description, lines } = body as {
      entryDate?: string;
      description?: string;
      lines?: { glAccountCode: string; description?: string; debit: number; credit: number }[];
    };

    const existing = await db.journalEntry.findUnique({
      where: { id: params.id, companyId },
      include: { lines: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
    }

    if (existing.sourceType !== 'manual') {
      return NextResponse.json({ error: 'Only manual journal entries can be edited' }, { status: 403 });
    }

    const newLines = lines || existing.lines.map((l) => ({
      glAccountCode: l.glAccountCode,
      description: l.description || undefined,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));

    // Validate balance
    const totalDebit = newLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = newLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.02) {
      return NextResponse.json({ error: `Not balanced: D=${totalDebit.toFixed(2)} C=${totalCredit.toFixed(2)}` }, { status: 400 });
    }

    // Reverse old entry's balance effects
    for (const line of existing.lines) {
      const acct = await db.chartOfAccount.findFirst({ where: { code: line.glAccountCode, companyId } });
      if (!acct) continue;
      const net = Number(line.debit) - Number(line.credit);
      const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? -net : net;
      await db.chartOfAccount.update({
        where: { id: acct.id },
        data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
      });
      if (acct.parentCode) {
        await db.chartOfAccount.updateMany({
          where: { code: acct.parentCode, companyId },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }

    // Delete old lines and update entry
    await db.journalLine.deleteMany({ where: { journalEntryId: params.id } });
    await db.journalEntry.update({
      where: { id: params.id },
      data: {
        entryDate: entryDate ? new Date(entryDate) : undefined,
        description: description || undefined,
        lines: {
          create: newLines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });

    // Apply new balance effects
    for (const line of newLines) {
      const acct = await db.chartOfAccount.findFirst({ where: { code: line.glAccountCode, companyId } });
      if (!acct) continue;
      const net = line.debit - line.credit;
      const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? net : -net;
      await db.chartOfAccount.update({
        where: { id: acct.id },
        data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
      });
      if (acct.parentCode) {
        await db.chartOfAccount.updateMany({
          where: { code: acct.parentCode, companyId },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }

    const updated = await db.journalEntry.findUnique({
      where: { id: params.id, companyId },
      include: { lines: true },
    });

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    console.error('PUT /api/journal/[id] error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}

// DELETE — void a journal entry (reverse balances, keep record for audit trail)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const existing = await db.journalEntry.findUnique({
      where: { id: params.id, companyId },
      include: { lines: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 });
    }

    if (existing.sourceType !== 'manual') {
      return NextResponse.json({ error: 'Only manual journal entries can be deleted' }, { status: 403 });
    }

    // Reverse balance effects
    for (const line of existing.lines) {
      const acct = await db.chartOfAccount.findFirst({ where: { code: line.glAccountCode, companyId } });
      if (!acct) continue;
      const net = Number(line.debit) - Number(line.credit);
      const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? -net : net;
      await db.chartOfAccount.update({
        where: { id: acct.id },
        data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
      });
      if (acct.parentCode) {
        await db.chartOfAccount.updateMany({
          where: { code: acct.parentCode, companyId },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }

    // Delete lines then entry
    await db.journalLine.deleteMany({ where: { journalEntryId: params.id } });
    await db.journalEntry.delete({ where: { id: params.id, companyId } });

    return NextResponse.json({ data: { deleted: true, id: params.id } });
  } catch (error: any) {
    console.error('DELETE /api/journal/[id] error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}
