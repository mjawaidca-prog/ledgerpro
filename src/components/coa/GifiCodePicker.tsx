'use client';

/**
 * GIFI code picker for the chart-of-accounts forms.
 *
 * Replaces the old free-text "GIFI Code" box (any string was stored;
 * a typo silently exported as unmapped). The picker only offers
 * assignable codes from the CRA catalogue (src/lib/gifi-catalogue.ts):
 * detail/generic codes, never total/header lines and never the
 * retained-earnings continuity codes the tax software computes.
 *
 * Behaviour (per the GIFI plan, §4.1):
 *  - searchable by code ("8710") or by words in the CRA description
 *    ("bank charges"); every option shows code + official description;
 *  - grouped by T2 statement/section;
 *  - filtered to the account type's own sections by default, with a
 *    "show all codes" escape hatch (contra/clearing accounts are
 *    legitimate exceptions);
 *  - a stored legacy value that is not a valid assignable code is
 *    shown as-is with a warning, and can be replaced or cleared here.
 */

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  PICKABLE_GIFI_CODES,
  getGifiEntry,
  gifiLabel,
  gifiOptionsForAccountType,
  hasValidGifiCode,
} from '@/lib/gifi';
import type { GifiCatalogueEntry } from '@/lib/gifi-catalogue';

interface GifiCodePickerProps {
  /** Current code ('' = none). May hold a legacy invalid value in Edit. */
  value: string;
  onChange: (code: string) => void;
  /** LedgerPro account type — drives the default section filter. */
  accountType: string;
  /**
   * Slice 3: codes suggested for this account (template twin / keyword
   * rules, src/lib/gifi-suggestions.ts). Pinned at the top of the list
   * under "Suggested — tap to use". A suggestion is only ever applied
   * by the user tapping it here — never pre-selected or auto-saved.
   */
  suggestedCodes?: string[];
}

const MAX_RENDERED = 250;

function groupLabel(entry: GifiCatalogueEntry): string {
  return `${entry.statement} — ${entry.section}`;
}

export function GifiCodePicker({ value, onChange, accountType, suggestedCodes }: GifiCodePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const entry = trimmed ? getGifiEntry(trimmed) : undefined;
  const valid = hasValidGifiCode(trimmed);

  const options = useMemo(() => {
    const scoped = showAll ? PICKABLE_GIFI_CODES : gifiOptionsForAccountType(accountType);
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (e) => e.code.includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [showAll, accountType, query]);

  const groups = useMemo(() => {
    const out: { label: string; entries: GifiCatalogueEntry[] }[] = [];
    for (const e of options.slice(0, MAX_RENDERED)) {
      const label = groupLabel(e);
      const last = out[out.length - 1];
      if (last && last.label === label) last.entries.push(e);
      else out.push({ label, entries: [e] });
    }
    return out;
  }, [options]);

  // Suggested codes pinned above the catalogue list — shown only with
  // an empty search (once the user types, they are driving). The
  // currently selected code is not re-suggested.
  const pinnedSuggestions = useMemo(() => {
    if (query.trim() !== '' || !suggestedCodes) return [];
    const seen = new Set<string>();
    const out: GifiCatalogueEntry[] = [];
    for (const code of suggestedCodes) {
      if (code === trimmed || seen.has(code)) continue;
      const e = getGifiEntry(code);
      if (e && hasValidGifiCode(code)) {
        seen.add(code);
        out.push(e);
      }
    }
    return out;
  }, [suggestedCodes, query, trimmed]);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className={cn(
          'input w-full flex items-center gap-2 text-left',
          !trimmed && 'text-[var(--text-faint)]',
        )}
      >
        <span className="flex-1 truncate">
          {trimmed ? (entry ? gifiLabel(trimmed) : trimmed) : 'No GIFI code — select (optional)'}
        </span>
        {trimmed && (
          <span
            role="button"
            aria-label="Clear GIFI code"
            onClick={(e) => { e.stopPropagation(); pick(''); }}
            className="text-[var(--text-faint)] hover:text-[var(--text-strong)]"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={14} className="text-[var(--text-faint)] shrink-0" />
      </button>

      {trimmed && !valid && (
        <p className="text-xs text-[var(--warning)] mt-1">
          “{trimmed}” is not an assignable CRA catalogue code — it exports as unmapped. Pick a valid code or clear it.
        </p>
      )}
      {trimmed && valid && entry && (
        <p className="text-xs text-[var(--text-muted)] mt-1">
          {entry.statement} · {entry.section} — several accounts can share one GIFI code.
        </p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl shadow-[var(--shadow-lg)] overflow-hidden">
          <div className="p-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                ref={searchRef}
                className="input w-full pl-8"
                placeholder="Search code or description…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 mt-2 px-1 text-xs text-[var(--text-muted)]">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all codes (default: this account type’s sections only)
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onClick={() => pick('')}
              className="w-full text-left px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--primary-soft)]"
            >
              — No GIFI code —
            </button>
            {pinnedSuggestions.length > 0 && (
              <div>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)] bg-[var(--primary-soft)]">
                  Suggested — tap to use
                </div>
                {pinnedSuggestions.map((e) => (
                  <button
                    key={`suggested-${e.code}`}
                    type="button"
                    onClick={() => pick(e.code)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--primary-soft)] flex gap-2 items-baseline"
                  >
                    <span className="font-mono text-[var(--text-muted)] w-[44px] shrink-0">{e.code}</span>
                    <span className="text-[var(--text)]">{e.description}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)] shrink-0">Suggested</span>
                  </button>
                ))}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] bg-[var(--surface-2)]">
                  {g.label}
                </div>
                {g.entries.map((e) => (
                  <button
                    key={e.code}
                    type="button"
                    onClick={() => pick(e.code)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--primary-soft)] flex gap-2',
                      e.code === trimmed && 'bg-[var(--primary-soft)] font-medium',
                    )}
                  >
                    <span className="font-mono text-[var(--text-muted)] w-[44px] shrink-0">{e.code}</span>
                    <span className="text-[var(--text)]">{e.description}</span>
                  </button>
                ))}
              </div>
            ))}
            {options.length === 0 && (
              <p className="px-3 py-3 text-sm text-[var(--text-muted)]">
                No codes match. {showAll ? 'Try different words.' : 'Try “show all codes”.'}
              </p>
            )}
            {options.length > MAX_RENDERED && (
              <p className="px-3 py-2 text-xs text-[var(--text-faint)]">
                Showing the first {MAX_RENDERED} of {options.length} — keep typing to narrow down.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
