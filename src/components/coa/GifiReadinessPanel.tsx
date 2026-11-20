'use client';

/**
 * GIFI readiness panel (Slice 3 of the chart-of-accounts GIFI plan).
 *
 * QuickBooks Online's "NOT MAPPED" worklist, moved into the books:
 * a counter ("47 of 49 accounts coded") plus every countable account
 * that still needs a code, each with the same GifiCodePicker inline —
 * one pick + Save per account, without leaving the page. Saving goes
 * through PUT /api/coa/[id], the same validated API the Edit form
 * uses, so a code saved here is validated exactly like one saved
 * there.
 *
 * Counting rule (src/lib/gifi-readiness.ts, shared with the Tax Setup
 * card and the pre-export checklist): active accounts only, excluding
 * the accounts that stay uncoded by design (Retained Earnings,
 * Opening Balance Equity, owner's capital/draw). A stored value that
 * is not an assignable catalogue code (a legacy free-text typo) lists
 * as "invalid" — the export treats it as unmapped.
 *
 * Sole proprietors (quiet flow, plan D5) never see this panel: they
 * file a T2125, not GIFI statements. The picker stays available in
 * their account forms.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { GifiCodePicker } from '@/components/coa/GifiCodePicker';
import {
  computeGifiReadiness,
  gifiFlowMode,
  type GifiReadinessAccountInput,
} from '@/lib/gifi-readiness';
import { suggestGifiCodes } from '@/lib/gifi-suggestions';
import { hasValidGifiCode } from '@/lib/gifi';

interface GifiReadinessPanelProps {
  /** The company's ACTIVE accounts (the export's population). */
  accounts: readonly GifiReadinessAccountInput[];
  businessType: string | null | undefined;
  /** Called after a successful save so the parent can refetch. */
  onSaved?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
};

export function GifiReadinessPanel({ accounts, businessType, onSaved }: GifiReadinessPanelProps) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowWarning, setRowWarning] = useState<Record<string, string>>({});

  const readiness = useMemo(() => computeGifiReadiness(accounts), [accounts]);

  if (gifiFlowMode(businessType) === 'quiet') return null;
  if (readiness.total === 0 && readiness.decidedUnmapped.length === 0) return null;

  const { total, coded, needsCode, decidedUnmapped } = readiness;

  async function saveRow(accountId: string) {
    const value = (picks[accountId] ?? '').trim();
    setSavingId(accountId);
    setRowError((prev) => ({ ...prev, [accountId]: '' }));
    try {
      const res = await fetch(`/api/coa/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gifiCode: value || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      if (Array.isArray(json.warnings) && json.warnings.length > 0) {
        setRowWarning((prev) => ({ ...prev, [accountId]: json.warnings.join(' ') }));
      }
      setPicks((prev) => {
        const next = { ...prev };
        delete next[accountId];
        return next;
      });
      onSaved?.();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [accountId]: e instanceof Error ? e.message : 'Failed to save' }));
    } finally {
      setSavingId(null);
    }
  }

  // GIFI-at-creation (Phase 1): the other decision. Recording "leave
  // unmapped" through the same PUT the Edit form uses — the API stores
  // it as gifiUnmappedByChoice and the row leaves the worklist, because
  // the account is decided, not forgotten. It still exports unmapped.
  async function markUnmapped(accountId: string) {
    setSavingId(accountId);
    setRowError((prev) => ({ ...prev, [accountId]: '' }));
    try {
      const res = await fetch(`/api/coa/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gifiCode: null, gifiUnmappedByChoice: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      onSaved?.();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [accountId]: e instanceof Error ? e.message : 'Failed to save' }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--shadow-sm)] p-5 mb-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-[var(--text-strong)]">GIFI readiness</h2>
        <span className="font-mono tabular-nums text-sm font-bold text-[var(--text-strong)]">
          {coded} of {total} accounts coded
        </span>
        {needsCode.length > 0 ? (
          <Badge variant="pending" dot={false}>{needsCode.length} need{needsCode.length === 1 ? 's' : ''} a GIFI decision</Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-[var(--success)]">
            <CheckCircle2 size={14} /> Every countable account has a GIFI decision
          </span>
        )}
        {decidedUnmapped.length > 0 && (
          <span className="text-xs text-[var(--text-faint)]">
            {decidedUnmapped.length} account{decidedUnmapped.length === 1 ? '' : 's'} left unmapped by choice
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-1.5 max-w-[860px]">
        Counts active accounts that need a GIFI code for the Nexvar Tax (tb-gifi/1) export. Retained Earnings,
        Opening Balance Equity, and owner&apos;s capital/draw accounts are excluded — they stay uncoded by design,
        because the tax software calculates retained earnings itself. An account can also be left unmapped
        on purpose (“Leave unmapped” below): that decision is recorded, the account leaves this list, and it
        still exports unmapped. A code lives on the account, so changing one re-codes future exports,
        including a re-export of an earlier year.
      </p>

      {needsCode.length > 0 && (
        <div className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {needsCode.map((account) => {
            const accountId = account.id ?? account.code;
            const pick = picks[accountId] ?? '';
            const suggestions = suggestGifiCodes(account);
            const dirty = pick !== '' && pick !== (account.storedGifiCode ?? '');
            return (
              <div key={accountId} className="py-3">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-[var(--text-muted)]">{account.code}</span>
                      <span className="text-sm font-medium text-[var(--text-strong)]">{account.name}</span>
                      <span className="text-xs text-[var(--text-faint)]">{TYPE_LABELS[account.type] ?? account.type}</span>
                    </div>
                    {account.status === 'invalid' ? (
                      <p className="text-xs text-[var(--warning)] mt-0.5">
                        Stored code “{account.storedGifiCode}” is not an assignable CRA code — it exports as unmapped. Pick a valid code.
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">No GIFI code — this account exports unmapped.</p>
                    )}
                    {suggestions.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Suggested:</span>
                        {suggestions.map((s) => (
                          <button
                            key={s.code}
                            type="button"
                            title={`${s.reason} — tap to use, then Save`}
                            onClick={() => setPicks((prev) => ({ ...prev, [accountId]: s.code }))}
                            className="text-xs font-mono px-2 py-0.5 rounded-full border border-[var(--border-strong)] hover:bg-[var(--primary-soft)] text-[var(--text)]"
                          >
                            {s.code} — {s.description}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-[320px] max-w-full">
                    <GifiCodePicker
                      value={pick}
                      onChange={(code) => setPicks((prev) => ({ ...prev, [accountId]: code }))}
                      accountType={account.type}
                      suggestedCodes={suggestions.map((s) => s.code)}
                    />
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Button
                      variant="secondary"
                      onClick={() => saveRow(accountId)}
                      disabled={savingId === accountId || !dirty || !hasValidGifiCode(pick)}
                    >
                      {savingId === accountId ? <Loader2 size={14} className="animate-spin" /> : null}
                      Save
                    </Button>
                    <button
                      type="button"
                      onClick={() => markUnmapped(accountId)}
                      disabled={savingId === accountId}
                      className="text-xs text-[var(--text-faint)] hover:text-[var(--text-strong)] disabled:opacity-45"
                      title="Record the decision to leave this account unmapped — it exports unmapped on purpose and leaves this list"
                    >
                      Leave unmapped
                    </button>
                  </div>
                </div>
                {rowError[accountId] && <p className="text-xs text-[var(--danger)] mt-1.5">{rowError[accountId]}</p>}
                {rowWarning[accountId] && <p className="text-xs text-[var(--warning)] mt-1.5">{rowWarning[accountId]}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
