'use client';

/**
 * Industry re-detection card (Phase 2 item 5).
 *
 * Renders nothing unless GET /api/companies/industry-suggestion
 * returns a suggestion — the engine only speaks up when the company's
 * real activity fits a different industry pack clearly better than
 * the one on file. [Add the pack] applies through the EXISTING
 * PUT /api/companies flow (stores the industry, layers the pack
 * idempotently, removes nothing); [Dismiss] is remembered per company
 * so the same suggestion never nags twice. Never auto-applies.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sparkles, X } from 'lucide-react';

interface Suggestion {
  industry: string;
  label: string;
  currentIndustry: string | null;
  currentLabel: string | null;
  confidencePct: number;
  evidence: string[];
}

export function IndustrySuggestionCard() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/companies/industry-suggestion');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.data) setSuggestion(json.data);
      } catch {
        // A suggestion is a nice-to-have — never break the dashboard.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!suggestion) return null;

  if (applied) {
    return (
      <div className="mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)] flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#16a063]/10 grid place-items-center flex-none">
          <Sparkles size={20} className="text-[#16a063]" />
        </div>
        <p className="text-sm text-[var(--text)]">
          <span className="font-semibold text-[var(--text-strong)]">{suggestion.label} pack added.</span>{' '}
          The new accounts are on your chart of accounts — nothing was removed.
        </p>
      </div>
    );
  }

  async function apply() {
    if (!suggestion || busy) return;
    setBusy('apply');
    setError(null);
    try {
      const res = await fetch('/api/companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: suggestion!.industry }),
      });
      if (!res.ok) throw new Error('apply failed');
      setApplied(true);
    } catch {
      setError('Could not add the pack just now — please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    if (!suggestion || busy) return;
    setBusy('dismiss');
    try {
      await fetch('/api/companies/industry-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: suggestion.industry }),
      });
    } catch {
      // Even if the dismissal fails to save, hide the card for now.
    } finally {
      setBusy(null);
      setSuggestion(null);
    }
  }

  return (
    <div className="mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#7c3aed]/10 grid place-items-center flex-none">
          <Sparkles size={20} className="text-[#7c3aed]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-strong)]">
            Your books look like a {suggestion.label} business.
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {suggestion.currentLabel
              ? <>This company is set to <span className="font-medium">{suggestion.currentLabel}</span>, but its activity fits {suggestion.label} better. </>
              : <>No industry is set for this company yet. </>}
            Add the {suggestion.label} account pack? Your existing accounts stay exactly as they are.
          </p>
          {suggestion.evidence.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {suggestion.evidence.map((item) => (
                <li key={item} className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-[#7c3aed] flex-none" />
                  {item}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-xs text-[var(--danger)] mt-2">{error}</p>}
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" onClick={apply} disabled={busy !== null}>
              {busy === 'apply' ? 'Adding…' : `Add the ${suggestion.label} pack`}
            </Button>
            <Button variant="secondary" size="sm" onClick={dismiss} disabled={busy !== null}>
              <X size={14} /> Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
