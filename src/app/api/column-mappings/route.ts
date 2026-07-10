import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// GET /api/column-mappings?accountId=...&headers=date|description|withdrawals|deposits
// Returns saved mappings for a financial account, optionally filtered by header signature match.
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const headers = searchParams.get('headers'); // normalized header signature to match

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    }

    // Verify account belongs to company
    const account = await db.financialAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const where: any = { financialAccountId: accountId };

    // If headers provided, try to find a matching mapping by header signature
    if (headers) {
      where.headerSignature = headers;
    }

    const mappings = await db.columnMapping.findMany({
      where,
      orderBy: { lastUsedAt: 'desc' },
      take: headers ? 1 : 10, // if matching by signature, return best match; otherwise return recent
    });

    // If no exact match by signature, return the most recently used mapping for this account
    if (headers && mappings.length === 0) {
      const recent = await db.columnMapping.findMany({
        where: { financialAccountId: accountId },
        orderBy: { lastUsedAt: 'desc' },
        take: 1,
      });
      return NextResponse.json({ data: recent, matched: false });
    }

    return NextResponse.json({ data: mappings, matched: true });
  } catch (error) {
    console.error('GET /api/column-mappings error:', error);
    return NextResponse.json({ error: 'Failed to fetch column mappings' }, { status: 500 });
  }
}

// POST /api/column-mappings
// Save a new column mapping after a successful import.
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const {
      financialAccountId,
      dateColumn,
      descriptionColumn,
      amountColumn,
      debitColumn,
      creditColumn,
      balanceColumn,
      signDirection,
      headerSignature,
      mappingsJson,
      profileName,
    } = body;

    if (!financialAccountId || !dateColumn || !descriptionColumn) {
      return NextResponse.json(
        { error: 'financialAccountId, dateColumn, and descriptionColumn are required' },
        { status: 400 }
      );
    }

    // Verify account belongs to company
    const account = await db.financialAccount.findFirst({
      where: { id: financialAccountId, companyId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Upsert: if a mapping with the same account + header signature exists, update it.
    // Otherwise create a new one.
    const existing = headerSignature
      ? await db.columnMapping.findFirst({
          where: {
            financialAccountId,
            headerSignature,
          },
        })
      : null;

    const data = {
      dateColumn,
      descriptionColumn,
      amountColumn: amountColumn || null,
      debitColumn: debitColumn || null,
      creditColumn: creditColumn || null,
      balanceColumn: balanceColumn || null,
      signDirection: signDirection || 'normal',
      headerSignature: headerSignature || null,
      mappingsJson: mappingsJson || null,
      lastUsedAt: new Date(),
    };

    let mapping;
    if (existing) {
      mapping = await db.columnMapping.update({
        where: { id: existing.id },
        data,
      });
    } else {
      mapping = await db.columnMapping.create({
        data: {
          financialAccountId,
          profileName: profileName || null,
          ...data,
        },
      });
    }

    return NextResponse.json({ data: mapping }, { status: 201 });
  } catch (error) {
    console.error('POST /api/column-mappings error:', error);
    return NextResponse.json({ error: 'Failed to save column mapping' }, { status: 500 });
  }
}

// DELETE /api/column-mappings?id=...
export async function DELETE(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const mapping = await db.columnMapping.findFirst({
      where: { id },
      include: { account: { select: { companyId: true } } },
    });

    if (!mapping || mapping.account.companyId !== companyId) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    await db.columnMapping.delete({ where: { id } });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error('DELETE /api/column-mappings error:', error);
    return NextResponse.json({ error: 'Failed to delete mapping' }, { status: 500 });
  }
}
