'use client';

import { format } from 'date-fns';
import { Printer, Download, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { exportConsolidatedReport } from '@/lib/export';
import { useDropdown } from './state';
import { fmtNum, STATEMENTS, type ConsolidatedReportData, type ReportLine } from './state';

interface Props {
  data: ConsolidatedReportData;
  showEntityColumns: boolean;
  attachWorkingPaper: boolean;
  stale: boolean;
  onDrillDown: (line: ReportLine) => void;
}

function statementTitle(statement: string): string {
  const found = STATEMENTS.find((s) => s.key === statement);
  return `Consolidated ${found?.label ?? 'Statement'}`;
}

export default function ReportDocument({ data, showEntityColumns, attachWorkingPaper, stale, onDrillDown }: Props) {
  const exportDd = useDropdown();
  const genAt = data.generatedAt ? format(new Date(data.generatedAt), 'MMM d, yyyy') : '';
  const entities = data.entities;
  const elimTotal = data.eliminations.filter((e) => e.status !== 'excluded').reduce((s, e) => s + e.amount, 0);
  const isBs = data.statement === 'balance-sheet';
  const isTb = data.statement === 'trial-balance';

  const badge = isBs
    ? data.isBalanced
      ? 'ASSETS = LIABILITIES + EQUITY'
      : `OUT OF BALANCE BY ${fmtNum(Math.abs(data.outOfBalanceBy))}`
    : isTb
      ? data.isBalanced
        ? 'DEBITS = CREDITS'
        : `OUT OF BALANCE BY ${fmtNum(Math.abs(data.outOfBalanceBy))}`
      : null;

  return (
    <div className={cn('transition-opacity', stale && 'opacity-55')}>
      {stale && (
        <div className="mb-3 px-4 py-2.5 rounded-[var(--r-lg)] bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] text-xs text-[var(--text)]">
          Inputs changed — regenerate to refresh the report.
        </div>
      )}

      {/* Status row */}
      <div className="flex items-center gap-3 mb-3 flex-wrap print:hidden">
        {entities.length > 6 && showEntityColumns && (
          <span className="text-xs text-[var(--text-muted)]">
            More than 6 entity columns — turn off &ldquo;Show one column per entity&rdquo; for a clean print.
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 mb-3 flex-wrap print:hidden">
        {badge && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.08em] border',
              data.isBalanced
                ? 'bg-[var(--success-soft)] border-[var(--success-soft-border)] text-[var(--success)]'
                : 'bg-[var(--danger-soft)] border-[var(--danger-soft-border)] text-[var(--danger)]'
            )}
          >
            <span className={cn('w-[6px] h-[6px] rounded-full', data.isBalanced ? 'bg-[var(--success)]' : 'bg-[var(--danger)]')} />
            {badge}
          </span>
        )}
        <span className="font-mono text-[11.5px] text-[var(--text-faint)]">
          {fmtNum(elimTotal)} {data.presentationCurrency} eliminated across {data.eliminations.length} entries
        </span>
        <div className="flex-1" />
        {/* Export */}
        <div className="relative" ref={exportDd.ref}>
          <button
            onClick={() => exportDd.setOpen(!exportDd.open)}
            className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"
          >
            <Download size={14} className="text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">Export</span>
            <ChevronDown size={14} className="text-[var(--text-muted)]" />
          </button>
          {exportDd.open && (
            <div className="absolute top-full mt-1 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-[var(--shadow-md)] min-w-[180px] z-20 overflow-hidden">
              {([
                ['pdf', 'Export as PDF'],
                ['excel', 'Export as Excel'],
                ['csv', 'Export as CSV'],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => {
                    exportDd.setOpen(false);
                    if (k === 'pdf') window.print();
                    else exportConsolidatedReport(data, k === 'excel' ? 'xls' : 'csv');
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-3)] text-[var(--text)]"
                >
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] hover:border-[var(--border-strong)]"
        >
          <Printer size={14} className="text-[var(--text-muted)]" /> Print
        </button>
      </div>

      {/* Document */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] px-[30px] pt-[34px] pb-[26px] shadow-[var(--shadow-sm)] print:shadow-none print:border-none print:px-0 print:py-0">
        {/* Five-line heading */}
        <div className="text-center pb-4 border-b-2 border-[var(--text-strong)] print:border-gray-800">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">LedgerPro</div>
          <div className="text-[22px] font-bold text-[var(--text-strong)] tracking-[var(--tracking-tighter)]">{data.groupName}</div>
          <div className="text-base font-semibold text-[var(--text)] mt-1">{statementTitle(data.statement)}</div>
          <div className="font-mono text-[13px] text-[var(--text-muted)] mt-2.5">{data.period.label}</div>
          <div className="font-mono text-xs text-[var(--text-faint)] mt-0.5">
            Accrual basis · {data.presentationCurrency} · {entities.length} entities · Generated {genAt}
          </div>
        </div>

        {/* Statement table */}
        <div className="overflow-x-auto">
          <table className="w-full mt-4" style={{ minWidth: 1040 }}>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 w-[64px]">Code</th>
                <th className="text-left font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] pb-2 min-w-[200px]">Account</th>
                {showEntityColumns &&
                  entities.map((e) => (
                    <th key={e.companyId} className="text-right font-mono text-[11px] font-semibold text-[var(--text)] pb-2 w-[120px]">
                      {e.code}
                      <div className="font-normal text-[10.5px] text-[var(--text-faint)]">{e.currency}</div>
                    </th>
                  ))}
                <th className="text-right font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--primary)] pb-2 w-[132px]">
                  Elim.
                  <div className="font-normal text-[10.5px] text-[var(--text-faint)]">Group</div>
                </th>
                <th className="text-right font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--text-strong)] pb-2 w-[150px] border-l border-[var(--border)]">
                  Consolidated
                  <div className="font-normal text-[10.5px] text-[var(--text-faint)]">{data.presentationCurrency}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.sections.map((section) => (
                <SectionBlock
                  key={section.key}
                  label={section.label}
                  lines={section.lines}
                  totals={section.totals}
                  entities={entities}
                  showEntityColumns={showEntityColumns}
                  onDrillDown={onDrillDown}
                />
              ))}
              {/* Grand total */}
              <tr className="border-t-2 border-b-2 border-[var(--text-strong)] bg-[var(--surface-2)] print:bg-gray-50">
                <td className="py-[13px]" />
                <td className="py-[13px] text-right text-[15px] font-bold text-[var(--text-strong)] pr-2">
                  {isBs ? 'Total liabilities and equity' : 'Totals'}
                </td>
                {showEntityColumns &&
                  entities.map((e) => (
                    <td key={e.companyId} className="py-[13px] text-right font-mono text-[13.5px] font-bold tabular-nums text-[var(--text-strong)]">
                      {fmtNum(data.grandTotal.byEntity[e.companyId] ?? 0)}
                    </td>
                  ))}
                <td className="py-[13px] text-right font-mono text-[13.5px] font-bold tabular-nums text-[var(--text-strong)]">
                  {fmtNum(data.grandTotal.elimination)}
                </td>
                <td
                  className={cn(
                    'py-[13px] text-right font-mono text-base font-bold tabular-nums border-l border-[var(--border)]',
                    data.isBalanced ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                  )}
                >
                  {fmtNum(data.grandTotal.consolidated)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Notes */}
        {data.notes.length > 0 && (
          <div className="mt-8">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">Notes</div>
            <ol className="list-decimal pl-5 space-y-1">
              {data.notes.map((n, i) => (
                <li key={i} className="text-[12.5px] text-[var(--text-muted)]">{n}</li>
              ))}
            </ol>
          </div>
        )}

        {/* Working paper — elimination schedule + FX rates */}
        {attachWorkingPaper && (data.eliminations.length > 0 || data.entities.some((e) => e.fxRate !== null)) && (
          <div className="mt-8">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2">
              Working paper — elimination schedule
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] pb-2 w-[70px]">Ref</th>
                  <th className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] pb-2">Description</th>
                  <th className="text-left font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] pb-2 w-[80px]">Source</th>
                  <th className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] pb-2 w-[110px]">Amount</th>
                  <th className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)] pb-2 w-[110px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.eliminations.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--surface-3)]">
                    <td className="py-1.5 font-mono text-xs text-[var(--text)]">{e.ref}</td>
                    <td className="py-1.5 text-xs text-[var(--text-muted)]">{e.description}</td>
                    <td className="py-1.5 font-mono text-[10px] uppercase text-[var(--text-faint)]">{e.source}</td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums text-[var(--text)]">{fmtNum(e.amount)}</td>
                    <td className="py-1.5 text-right font-mono text-[10px] uppercase text-[var(--text-faint)]">
                      {e.status === 'break' ? `break ${fmtNum(e.difference)}` : e.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mt-5 mb-2">
              FX rates used
            </div>
            <div className="space-y-0.5">
              {data.entities
                .filter((e) => e.fxRate !== null)
                .map((e) => (
                  <div key={e.companyId} className="text-xs text-[var(--text-muted)] font-mono">
                    {e.currency} → {data.presentationCurrency} · closing {Number(e.fxRate).toFixed(4)} · {e.fxSource === 'fallback' ? 'indicative (no dated rate)' : 'dated'}
                  </div>
                ))}
              {data.entities.every((e) => e.fxRate === null) && (
                <div className="text-xs text-[var(--text-faint)] font-mono">No translation required — all entities present in {data.presentationCurrency}.</div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between font-mono text-[11px] text-[var(--text-faint)] mt-6 pt-3 border-t border-[var(--border)] print:block">
          <span>
            {data.groupName} · {statementTitle(data.statement)} · As at {data.period.asOf}
          </span>
          <span>Page 1 of 1 · Confidential</span>
        </div>
      </div>
    </div>
  );
}

interface SectionBlockProps {
  label: string;
  lines: ReportLine[];
  totals: { byEntity: Record<string, number>; elimination: number; consolidated: number };
  entities: ConsolidatedReportData['entities'];
  showEntityColumns: boolean;
  onDrillDown: (line: ReportLine) => void;
}

function SectionBlock({ label, lines, totals, entities, showEntityColumns, onDrillDown }: SectionBlockProps) {
  return (
    <>
      <tr>
        <td colSpan={showEntityColumns ? entities.length + 4 : 3} className="pt-5 pb-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {label}
        </td>
      </tr>
      {lines.map((line) => (
        <tr
          key={line.code}
          className="cursor-pointer hover:bg-[var(--primary-soft)] transition-colors"
          onClick={() => onDrillDown(line)}
        >
          <td className="py-[5px] font-mono text-xs text-[var(--text-muted)]">{line.code}</td>
          <td className="py-[5px] text-[13.5px] text-[var(--text)] pl-2">{line.name}</td>
          {showEntityColumns &&
            entities.map((e) => (
              <td key={e.companyId} className="py-[5px] text-right font-mono text-[13px] tabular-nums text-[var(--text)]">
                {fmtNum(line.byEntity[e.companyId] ?? 0)}
              </td>
            ))}
          <td className="py-[5px] text-right font-mono text-[13px] tabular-nums text-[var(--primary)]">
            {fmtNum(line.elimination)}
          </td>
          <td className="py-[5px] text-right font-mono text-[13px] font-medium tabular-nums text-[var(--text-strong)] border-l border-[var(--border)]">
            {fmtNum(line.consolidated)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-[var(--border)]">
        <td className="py-[9px]" />
        <td className="py-[9px] text-right text-[13.5px] font-bold text-[var(--text-strong)] pr-2">Total {label.toLowerCase()}</td>
        {showEntityColumns &&
          entities.map((e) => (
            <td key={e.companyId} className="py-[9px] text-right font-mono text-[13.5px] font-bold tabular-nums text-[var(--text-strong)]">
              {fmtNum(totals.byEntity[e.companyId] ?? 0)}
            </td>
          ))}
        <td className="py-[9px] text-right font-mono text-[13.5px] font-bold tabular-nums text-[var(--text-strong)]">
          {fmtNum(totals.elimination)}
        </td>
        <td className="py-[9px] text-right font-mono text-[13.5px] font-bold tabular-nums text-[var(--text-strong)] border-l border-[var(--border)]">
          {fmtNum(totals.consolidated)}
        </td>
      </tr>
    </>
  );
}
