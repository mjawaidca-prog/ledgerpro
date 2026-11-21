import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { validateGifiCode, gifiTypeWarning, hasValidGifiCode } from '@/lib/gifi';
import { gifiDecisionError } from '@/lib/gifi-readiness';
import { recordGifiSuggestionEvent, sanitizeShownCodes } from '@/lib/gifi-events-server';
export const dynamic = 'force-dynamic';

const VALID_SUBTYPES = [
  'current_asset', 'fixed_asset', 'other_asset',
  'current_liability', 'long_term_liability',
  'common_shares', 'retained_earnings', 'owners_equity', 'other_equity',
];

// PUT — edit an existing chart of account's presentation/classification fields.
// Code, type, and balance are not editable here — changing an account's
// fundamental type after it has activity would misclassify everything
// already posted to it.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.chartOfAccount.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const body = await req.json();
    const { name, detailType, subType, gifiCode, description, active, gifiUnmappedByChoice, gifiShownCodes } = body;

    if (subType !== undefined && subType !== null && !VALID_SUBTYPES.includes(subType)) {
      return NextResponse.json({ error: 'Invalid subType' }, { status: 400 });
    }

    // GIFI code: when supplied it must be an assignable CRA catalogue
    // code (or blank/null to clear). This closes the old free-text hole
    // where a typo was stored and silently exported as unmapped.
    let gifiUpdate: string | null | undefined;
    if (gifiCode !== undefined) {
      const gifi = validateGifiCode(gifiCode);
      if (!gifi.ok) {
        return NextResponse.json({ error: gifi.error }, { status: 400 });
      }
      gifiUpdate = gifi.code;
    }

    // GIFI-at-creation (improvement plan Phase 1, design §2.1): when a
    // save touches the GIFI state, the RESULTING state must be a
    // decision — a valid code, a design exemption, or the recorded
    // deliberate "leave unmapped" choice. Clearing a code silently
    // (blank + no choice) is refused, exactly as creating an undecided
    // account is. Saves that touch neither GIFI field are unaffected,
    // so unrelated edits to legacy undecided accounts still work; the
    // account forms always send both fields, so the decision is made
    // there. Choosing "leave unmapped" also clears an unusable legacy
    // stored value — the account is unmapped either way, and the flag
    // is now the truthful record of why.
    let gifiFlagUpdate: boolean | undefined;
    if (gifiCode !== undefined || gifiUnmappedByChoice !== undefined) {
      const resultingCode = gifiCode !== undefined ? gifiUpdate : existing.gifiCode;
      const resultingFlag = gifiUnmappedByChoice !== undefined
        ? gifiUnmappedByChoice === true
        : (existing as { gifiUnmappedByChoice?: boolean }).gifiUnmappedByChoice === true;
      const decisionError = gifiDecisionError({
        name: name !== undefined ? name : existing.name,
        type: existing.type,
        subType: subType !== undefined ? subType : existing.subType,
        detailType: detailType !== undefined ? detailType : existing.detailType,
        gifiCode: resultingCode ?? null,
        gifiUnmappedByChoice: resultingFlag,
      });
      if (decisionError) {
        return NextResponse.json({ error: decisionError }, { status: 400 });
      }
      if (hasValidGifiCode(resultingCode)) {
        // Coded is the decision; the flag is meaningless alongside it.
        gifiFlagUpdate = false;
      } else {
        gifiFlagUpdate = resultingFlag;
        if (resultingFlag) gifiUpdate = null;
      }
    }

    const updated = await db.chartOfAccount.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name : undefined,
        detailType: detailType !== undefined ? detailType : undefined,
        subType: subType !== undefined ? subType : undefined,
        gifiCode: gifiUpdate,
        gifiUnmappedByChoice: gifiFlagUpdate,
        description: description !== undefined ? description : undefined,
        active: active !== undefined ? active : undefined,
      },
    });

    await auditLog(companyId, userId, 'coa.update', 'chart_of_account', params.id, { before: existing, after: updated });

    // GIFI v2 learning (Phase 2): when this save touched the GIFI
    // state and the form reported the ranked suggestions it showed,
    // record the event (shown vs chosen) that re-ranks future
    // suggestions. Telemetry only — the recorder swallows its own
    // failures, so this can never fail the update.
    if (gifiCode !== undefined || gifiUnmappedByChoice !== undefined) {
      const shownCodes = sanitizeShownCodes(gifiShownCodes);
      if (shownCodes.length > 0) {
        await recordGifiSuggestionEvent({
          companyId,
          accountName: updated.name,
          accountType: existing.type,
          shownCodes,
          chosenCode: hasValidGifiCode(updated.gifiCode) ? updated.gifiCode : null,
        });
      }
    }

    const warning = gifiUpdate ? gifiTypeWarning(gifiUpdate, existing.type) : null;

    return NextResponse.json({ data: updated, ...(warning ? { warnings: [warning] } : {}) });
  } catch (error) {
    console.error('PUT /api/coa/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}
