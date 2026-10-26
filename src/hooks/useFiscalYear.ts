'use client';
import { useState, useEffect } from 'react';
import { anchorMonthDay, fiscalYearRangeContaining } from '@/lib/fiscal-year';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface FiscalYearInfo {
  /** Default fiscal year for report pages: the FY with the most recent income/expense activity (Phase 0), else the current FY. */
  fiscalYearStart: string; // e.g. "2025-10-02"
  fiscalYearEnd: string;   // e.g. "2026-10-01"
  defaultYear: string;     // e.g. "2025" (start year of the default FY — the "FY 2025" label)
  loaded: boolean;
}

/**
 * Fiscal-year info for report pages.
 *
 * Phase 0 (P0-5): defaults now come from GET /api/reports/fiscal-defaults,
 * which resolves ONE fiscal-year definition server-side (anchored on the
 * active company's fiscalYearStart month/day) and picks the fiscal year
 * with the latest income/expense activity as the default — so report
 * pages open on the year that has the books in it, not an empty current
 * year, and the "FY <year>" label (the year the FY begins) means the same
 * thing on every report. The /api/companies fallback below preserves the
 * old current-FY behaviour if the endpoint is unavailable.
 */
export function useFiscalYear(): FiscalYearInfo {
  const [info, setInfo] = useState<FiscalYearInfo>({
    fiscalYearStart: '',
    fiscalYearEnd: '',
    defaultYear: String(new Date().getFullYear()),
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadFromDefaults() {
      const res = await fetch('/api/reports/fiscal-defaults');
      if (!res.ok) throw new Error('fiscal-defaults unavailable');
      const json = await res.json();
      const def = json.data?.default;
      if (!def) throw new Error('fiscal-defaults empty');
      if (!cancelled) {
        setInfo({
          fiscalYearStart: def.start,
          fiscalYearEnd: def.end,
          defaultYear: String(def.labelYear),
          loaded: true,
        });
      }
    }

    async function loadFallback() {
      const res = await fetch('/api/companies');
      const json = await res.json();
      const companies = json.data || [];
      const activeId = json.activeCompanyId || getCookie('lp-active-company-id');
      const active = companies.find((c: any) => c.id === activeId) || companies[0];
      if (!cancelled) {
        if (active?.fiscalYearStart) {
          const anchor = anchorMonthDay(String(active.fiscalYearStart));
          const today = new Date().toISOString().slice(0, 10);
          const current = fiscalYearRangeContaining(anchor, today);
          setInfo({
            fiscalYearStart: current.start,
            fiscalYearEnd: current.end,
            defaultYear: String(current.labelYear),
            loaded: true,
          });
        } else {
          setInfo(prev => ({ ...prev, loaded: true }));
        }
      }
    }

    loadFromDefaults().catch(() => loadFallback().catch(() => {
      if (!cancelled) setInfo(prev => ({ ...prev, loaded: true }));
    }));

    return () => { cancelled = true; };
  }, []);

  return info;
}
