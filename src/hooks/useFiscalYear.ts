'use client';
import { useState, useEffect } from 'react';

interface FiscalYearInfo {
  fiscalYearStart: string; // e.g. "2025-12-01" (current FY start)
  fiscalYearEnd: string;   // e.g. "2026-11-30" (current FY end)
  defaultYear: string;     // e.g. "2025" (start year of current FY)
  loaded: boolean;
}

/** Given a fiscal year start date, compute the current fiscal year period */
function computeCurrentFY(storedStart: string): { start: string; end: string; defaultYear: string } {
  const startDate = new Date(storedStart);
  const startMonth = startDate.getMonth(); // 0-indexed (11 = December)
  const startDay = startDate.getDate();

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
        if (companies.length > 0 && companies[0].fiscalYearStart) {
          const fy = computeCurrentFY(companies[0].fiscalYearStart);
          setInfo({ fiscalYearStart: fy.start, fiscalYearEnd: fy.end, defaultYear: fy.defaultYear, loaded: true });
        } else {
          setInfo(prev => ({ ...prev, loaded: true }));
        }
      })
      .catch(() => setInfo(prev => ({ ...prev, loaded: true })));
  }, []);

  return info;
}
