'use client';

/**
 * Standard three-line accounting report heading.
 *
 * Line 1 — Company Name (bold, largest)
 * Line 2 — Statement Name (e.g. "Balance Sheet", "Trial Balance")
 * Line 3 — Period / Date (e.g. "As at November 30, 2025" or
 *          "For the period ended November 30, 2025")
 *
 * On-screen these appear as a compact heading block. When printed
 * (@media print) they render as a proper centered three-line
 * heading at the top of the page.
 */

interface ReportHeaderProps {
  companyName: string;
  statementName: string;
  periodLabel: string;
  /** Optional extra subtitle shown below the three-line heading (e.g. account count, balance status). Only visible on screen, hidden in print. */
  subtitle?: string;
}

export function ReportHeader({ companyName, statementName, periodLabel, subtitle }: ReportHeaderProps) {
  return (
    <>
      {/* Screen layout — compact left-aligned heading */}
      <div className="report-header print:hidden">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-strong)]">
          {statementName}
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">
          <span className="font-medium text-[var(--text)]">{companyName}</span>
          <span className="text-[var(--text-faint)]"> · </span>
          <span>{periodLabel}</span>
          {subtitle && (
            <>
              <span className="text-[var(--text-faint)]"> · </span>
              <span>{subtitle}</span>
            </>
          )}
        </p>
      </div>

      {/* Print layout — centered three-line block */}
      <div className="hidden print:block print:mb-8 print:text-center">
        <h1 className="text-xl font-bold mb-1">{companyName}</h1>
        <h2 className="text-lg font-semibold mb-1">{statementName}</h2>
        <p className="text-sm">{periodLabel}</p>
      </div>
    </>
  );
}
