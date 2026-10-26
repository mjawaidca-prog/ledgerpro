import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { auditLog } from '@/lib/api-helpers';
import { getServerSession } from '@/lib/auth';
import { purgeCompany, confirmationMatches } from '@/lib/delete-company';
export const dynamic = 'force-dynamic';

// DELETE — permanently delete one of the caller's OWN companies and all
// of its data. Phase 0.2: LedgerPro had no delete path at all (no UI,
// no route), so dead stub companies could never be removed.
//
// Guardrails (all enforced here, server-side):
//  - Authenticated session required.
//  - The caller must be a member of the TARGET company with role
//    'owner' — checked against the target id, NOT the active company
//    (requireCompany() resolves the ACTIVE company, which by design is
//    never the one being deleted here).
//  - The ACTIVE company cannot be deleted (409): switch to another
//    company first. The active id is resolved the same way the rest of
//    the app resolves it (x-company-id header, lp-active-company-id
//    cookie, session), because a deletion aimed at the company the
//    user is currently working in is almost certainly a mistake.
//  - The caller's ONLY company cannot be deleted (409) — an account
//    must always keep at least one company.
//  - The request body must carry { confirmName } exactly matching the
//    company's name or legal name (400 on mismatch).
// The purge itself is src/lib/delete-company.ts: most Company relations
// are Restrict/no-cascade in the schema, so children are deleted
// explicitly, in FK-safe order, inside one transaction. If anything
// fails, the transaction rolls back and the company is untouched.
//
// Audit note: the deletion IS audit-logged ('company.delete') via the
// app's auditLog() helper before the purge — but AuditLog rows are
// company-scoped and company.delete has no cascade survivor, so the
// entry is removed together with the company's own history. There is
// no cross-company audit store in this codebase; the durable record of
// a deletion is the server log line below plus this response.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const targetId = params.id;

    const session = await getServerSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Owner check on the TARGET company.
    const membership = await db.membership.findUnique({
      where: { userId_companyId: { userId, companyId: targetId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    if (membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the company owner can delete a company' }, { status: 403 });
    }

    // Only-company refusal.
    const membershipCount = await db.membership.count({ where: { userId } });
    if (membershipCount <= 1) {
      return NextResponse.json(
        { error: 'You cannot delete your only company. Create another company first if you need a fresh start.' },
        { status: 409 }
      );
    }

    // Active-company refusal, resolved in the app's own order
    // (header → cookie → session), mirroring requireCompany() and
    // src/lib/active-company.ts.
    const sessionUser = session?.user as any;
    const activeCandidates = [
      req.headers.get('x-company-id'),
      req.cookies.get('lp-active-company-id')?.value,
      sessionUser?.activeCompanyId,
      sessionUser?.companyId,
    ];
    const activeCompanyId = activeCandidates.find((c) => c && c !== 'undefined') ?? null;
    if (activeCompanyId && activeCompanyId === targetId) {
      return NextResponse.json(
        { error: 'This is your active company. Switch to another company first, then delete this one.' },
        { status: 409 }
      );
    }

    const company = await db.company.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, legalName: true },
    });
    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Typed-name confirmation.
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    if (!confirmationMatches(body?.confirmName, company)) {
      return NextResponse.json(
        { error: `Confirmation does not match. Type the company name exactly to confirm deletion.` },
        { status: 400 }
      );
    }

    // Audit first (best-effort, the app's standard mechanism), then the
    // purge in a single transaction.
    await auditLog(company.id, userId, 'company.delete', 'company', company.id, {
      name: company.name,
      legalName: company.legalName,
    });
    console.info(`[company.delete] user ${userId} permanently deleted company ${company.id} ("${company.name}")`);

    await db.$transaction(async (tx: any) => {
      await purgeCompany(tx, company.id);
    });

    return NextResponse.json({ data: { deletedCompanyId: company.id, name: company.name } });
  } catch (error) {
    console.error('DELETE /api/companies/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 });
  }
}
