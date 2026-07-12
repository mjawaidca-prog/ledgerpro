'use client';
import { useState, useEffect } from 'react';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface FiscalYearInfo {
  fiscalYearStart: string; // e.g. "2025-12-01" (current FY start)
  fiscalYearEnd: string;   // e.g. "2026-11-30" (current FY end)
  defaultYear: string;     // e.g. "2025" (start year of current FY)
  loaded: boolean;
}

/** Given a fiscal year start date string, compute the current fiscal year period.
 *  Parses the date string by splitting on '-' to avoid timezone shift —
 *  new Date('2024-12-01') parses as UTC midnight which becomes Nov 30 in
 *  North American timezones. */
function computeCurrentFY(storedStart: string): { start: string; end: string; defaultYear: string } {
  // Safe parse: extract Y/M/D directly from the ISO prefix to avoid UTC→local shift
  const parts = storedStart.slice(0, 10).split('-').map(Number);
  const startMonth = parts[1] - 1; // 0-indexed (January = 0)
  const startDay = parts[2];

  const today = new Date();
  const thisYear = today.getFullYear();

  // This year's fiscal start
  const thisFYStart = new Date(thisYear, startMonth, startDay);

  // If today is before this year's FY start, current FY started last year
  const fyStartYear = today < thisFYStart ? thisYear - 1 : thisYear;

  const fyStart = new Date(fyStartYear, startMonth, startDay);
  // FY end = FY start + 1 year - 1 day
  const fyEnd = new Date(fyStartYear + 1, startMonth, startDay);
  fyEnd.setDate(fyEnd.getDate() - 1);

  return {
    start: fyStart.toISOString().slice(0, 10),
    end: fyEnd.toISOString().slice(0, 10),
    defaultYear: String(fyStartYear),
  };
}

export function useFiscalYear(): FiscalYearInfo {
  const [info, setInfo] = useState<FiscalYearInfo>({
    fiscalYearStart: '',
    fiscalYearEnd: '',
    defaultYear: String(new Date().getFullYear()),
    loaded: false,
  });

  useEffect(() => {
    fetch('/api/companies')
      .then(res => res.json())
      .then(json => {
        const companies = json.data || [];
        // /api/companies lists every company this user belongs to — with
        // multi-company support, companies[0] is whichever was created
        // first, not necessarily the one currently active. Match against
        // the active-company cookie (same one AppShell resolves against)
        // so the fiscal year shown here always matches the company on screen.
        const activeId = getCookie('lp-active-company-id');
        const active = companies.find((c: any) => c.id === activeId) || companies[0];
        if (active?.fiscalYearStart) {
          const fy = computeCurrentFY(active.fiscalYearStart);
          setInfo({ fiscalYearStart: fy.start, fiscalYearEnd: fy.end, defaultYear: fy.defaultYear, loaded: true });
        } else {
          setInfo(prev => ({ ...prev, loaded: true }));
        }
      })
      .catch(() => setInfo(prev => ({ ...prev, loaded: true })));
  }, []);

  return info;
}
