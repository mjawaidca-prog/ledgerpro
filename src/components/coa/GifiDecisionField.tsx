'use client';

/**
 * GIFI-at-creation decision field (LedgerPro improvement plan,
 * Phase 1 item 1; design §2.1).
 *
 * Wraps the existing GifiCodePicker with the decision rule: an
 * account cannot be saved until its GIFI state is DECIDED. The field
 * presents the decision in the design's order —
 *
 *  1. one suggested code with a plain-language reason and a one-tap
 *     [Use NNNN] button (suggestions come from
 *     src/lib/gifi-suggestions.ts — template twins, then keyword
 *     rules over the CRA catalogue);
 *  2. the full searchable picker, for "a different code";
 *  3. a quiet, deliberate "Leave unmapped — I'll code it later"
 *     checkbox: the only way to save without a code, and it is
 *     RECORDED on the account (gifiUnmappedByChoice), never a silent
 *     blank.
 *
 * Two special cases are handled before any of that:
 *  - Design-exempt accounts (Retained Earnings, Opening Balance
 *    Equity, Owner's Capital / Owner's Draw) are decided BY DESIGN —
 *    the field says so and asks for nothing (a code may still be
 *    assigned voluntarily through the picker).
 *  - A name that sounds like a mixed loan payment (principal +
 *    interest in one account — Muja's "Ford Credit Payments" case)
 *    gets the split-it notice instead of a confident suggestion:
 *    no single code is honest for a mixed account.
 *
 * The parent form owns the state and disables Save until
 * hasGifiDecision() (src/lib/gifi-readiness.ts) is true; the API
 * enforces the same rule server-side.
 */

import { useMemo } from 'react';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GifiCodePicker } from '@/components/coa/GifiCodePicker';
import { hasValidGifiCode } from '@/lib/gifi';
import { isGifiDesignExempt } from '@/lib/gifi-readiness';
import { mixedGifiAccountNotice, suggestGifiCodes } from '@/lib/gifi-suggestions';

interface GifiDecisionFieldProps {
  /** Account name as currently typed — drives suggestions/exemption. */
  name: string;
  /** LedgerPro account type — drives the picker's section filter. */
  accountType: string;
  detailType?: string | null;
  subType?: string | null;
  /** Current code ('' = none). May hold a legacy invalid value in Edit. */
  value: string;
  onChange: (code: string) => void;
  /** The recorded deliberate "leave unmapped" choice. */
  unmappedByChoice: boolean;
  onUnmappedByChoiceChange: (choice: boolean) => void;
}

export function GifiDecisionField({
  name,
  accountType,
  detailType,
  subType,
  value,
  onChange,
  unmappedByChoice,
  onUnmappedByChoiceChange,
}: GifiDecisionFieldProps) {
  const exempt = useMemo(
    () => isGifiDesignExempt({ code: '', name, type: accountType, subType: subType ?? null, detailType: detailType ?? null }),
    [name, accountType, subType, detailType],
  );

  const suggestions = useMemo(
    () => (exempt ? [] : suggestGifiCodes({ name, type: accountType, detailType: detailType ?? null, gifiCode: value || null })),
    [exempt, name, accountType, detailType, value],
  );
  const topSuggestion = suggestions[0] ?? null;

  const mixedNotice = useMemo(
    () => (exempt ? null : mixedGifiAccountNotice({ name })),
    [exempt, name],
  );

  const coded = hasValidGifiCode(value);

  function pick(code: string) {
    // Choosing a code IS the decision — it supersedes a recorded
    // "leave unmapped" choice (the API keeps the two exclusive too).
    if (code.trim() !== '') onUnmappedByChoiceChange(false);
    onChange(code);
  }

  function toggleUnmapped(choice: boolean) {
    onUnmappedByChoiceChange(choice);
    // Choosing "leave unmapped" supersedes any (unusable) code value.
    if (choice) onChange('');
  }

  return (
    <div>
      {exempt && (
        <p className="text-xs text-[var(--text-muted)] mb-2">
          No GIFI decision needed — this account stays uncoded by design, because the tax
          software handles retained earnings and opening balances itself. You can still
          assign a code below if you ever need one.
        </p>
      )}

      {!exempt && mixedNotice && !coded && (
        <div className="flex gap-2 rounded-xl border border-[var(--border)] bg-[var(--warning-soft)] px-3 py-2.5 mb-2">
          <AlertTriangle size={15} className="text-[var(--warning)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text)]">{mixedNotice}</p>
        </div>
      )}

      {!exempt && !mixedNotice && topSuggestion && !coded && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-3 py-2.5 mb-2">
          <Lightbulb size={15} className="text-[var(--accent)] shrink-0" />
          <p className="text-xs text-[var(--text)] flex-1 min-w-[220px]">
            <span className="font-semibold text-[var(--text-strong)]">
              Suggested: {topSuggestion.code} — {topSuggestion.description}.
            </span>{' '}
            {topSuggestion.reason}.
          </p>
          <Button type="button" size="sm" onClick={() => pick(topSuggestion.code)}>
            Use {topSuggestion.code}
          </Button>
        </div>
      )}

      <GifiCodePicker
        value={value}
        onChange={pick}
        accountType={accountType}
        suggestedCodes={suggestions.map((s) => s.code)}
      />

      {!exempt && !coded && (
        <label className="flex items-start gap-2 mt-2.5 text-sm text-[var(--text-muted)] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={unmappedByChoice}
            onChange={(e) => toggleUnmapped(e.target.checked)}
          />
          <span>
            Leave unmapped — I&apos;ll code it later
            {unmappedByChoice && (
              <span className="block text-xs text-[var(--text-faint)]">
                Recorded as your decision: this account exports unmapped on purpose and
                won&apos;t count as undecided. You can code it any time from the
                Chart of Accounts.
              </span>
            )}
          </span>
        </label>
      )}
    </div>
  );
}
