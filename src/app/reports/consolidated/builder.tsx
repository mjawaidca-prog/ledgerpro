'use client';

import { format, endOfMonth, subMonths } from 'date-fns';
import { ChevronDown, RefreshCw, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import EliminationsTable from './eliminations-table';
import {
  fmtNum,
  STATEMENTS,
  useDropdown,
  type CompanyOption,
  type ConsolidatedSetup,
  type EliminationRow,
  type RunStatus,
} from './state';

interface Props {
  setup: ConsolidatedSetup;
  companies: CompanyOption[];
  heldMap: Record<string, string>;
  eliminations: EliminationRow[];
  status: RunStatus;
  hasLinks: boolean;
  onSetup: (next: Partial<ConsolidatedSetup>) => void;
  onToggleElimination: (id: string) => void;
  onAddManual: () => void;
  onGenerate: () => void;
  onSavePackage: () => void;
}

type PresetKey = 'today' | 'last_month_end' | 'q1_end' | 'q2_end' | 'fy_end' | 'custom';

const PRESETS: [PresetKey, string][] = [
  ['today', 'Today'],
  ['last_month_end', 'End of last month'],
  ['q1_end', 'End of Q1'],
  ['q2_end', 'End of Q2'],
  ['fy_end', 'FY (year end)'],
  ['custom', 'Custom…'],
];

const CURRENCY_OPTIONS = ['CAD', 'USD', 'EUR', 'GBP'];

export default function Builder({
  setup,
  companies,
  heldMap,
  eliminations,
  status,
  hasLinks,
  onSetup,
  onToggleElimination,
  onAddManual,
  onGenerate,
  onSavePackage,
}: Props) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Parent = first selected company (falls back to first available).
  const parent = companies.find((c) => c.id === setup.companyIds[0]) ?? companies[0];
  const fyStart = parent?.fiscalYearStart ? new Date(parent.fiscalYearStart) : new Date(now.getFullYear(), 0, 1);
  const fyEnd = parent?.fiscalYearEnd
    ? new Date(parent.fiscalYearEnd)
    : new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), fyStart.getDate() - 1);
  const fyLabel = `FY ${fyEnd.getFullYear()}`;

  const periodDd = useDropdown();
  const compareDd = useDropdown();
  const currencyDd = useDropdown();

  const selectedCount = setup.companyIds.length;
  const breaks = eliminations.filter((e) => e.status === 'break');
  const hasBreak = breaks.length > 0;
  const elimTotal = eliminations.filter((e) => !setup.excludedEliminationIds.includes(e.id)).reduce((s, e) => s + e.amount, 0);
  const running = status === 'loading';
  const tooFew = selectedCount < 2;
  const tooMany = selectedCount > 12;
  const ctaDisabled = running || tooFew || tooMany;

  const statementLabel = STATEMENTS.find((s) => s.key === setup.statement)?.label ?? '';
  const setupSummary = `${statementLabel} · ${selectedCount} entities · ${fyLabel}`;

  const applyPreset = (key: PresetKey) => {
    periodDd.setOpen(false);
    let d: string;
    switch (key) {
      case 'today': d = today; break;
      case 'last_month_end': d = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'); break;
      case 'q1_end': d = format(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 2, 1)), 'yyyy-MM-dd'); break;
      case 'q2_end': d = format(endOfMonth(new Date(fyStart.getFullYear(), fyStart.getMonth() + 5, 1)), 'yyyy-MM-dd'); break;
      case 'fy_end': d = format(fyEnd, 'yyyy-MM-dd'); break;
      default: d = setup.asOf || today;
    }
    onSetup({ asOf: d });
  };

  const toggleCompany = (id: string) => {
    const has = setup.companyIds.includes(id);
    const next = has ? setup.companyIds.filter((c) => c !== id) : [...setup.companyIds, id];
    onSetup({ companyIds: next });
  };

  const selectAll = () => {
    onSetup({ companyIds: companies.map((c) => c.id) });
  };

  // FY-end mismatch note
  const parentEnd = parent?.fiscalYearEnd ? parent.fiscalYearEnd.slice(5) : null;
  const mismatched = companies.find(
    (c) => setup.companyIds.includes(c.id) && c.fiscalYearEnd && parentEnd && c.fiscalYearEnd.slice(5) !== parentEnd
  );
  const fyNote = mismatched
    ? `${mismatched.name} has a ${format(new Date(mismatched.fiscalYearEnd!), 'MMMM d')} year end — its figures will be re-cut to ${parent?.fiscalYearEnd ? format(new Date(parent.fiscalYearEnd), 'MMMM d') : 'December 31'}.`
    : `All selected entities share a ${parent?.fiscalYearEnd ? format(new Date(parent.fiscalYearEnd), 'MMMM d') : 'December 31'} year end.`;

  return (
    <div className="max-w-[1180px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] shadow-[var(--shadow-sm)] overflow-hidden">
      {/* Card header strip */}
      <div className="flex items-center gap-3 px-[22px] py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-[var(--text-muted)]">Report setup</div>
        <div className="flex-1" />
        <div className="font-mono text-[11px] text-[var(--text-faint)]">{setupSummary}</div>
      </div>

      {/* 1 · Statement */}
      <div className="px-[22px] pt-5 pb-1">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2.5">1 · Statement</div>
        <div className="flex flex-wrap gap-[7px]">
          {STATEMENTS.map((s) => {
            const active = setup.statement === s.key;
            return (
              <button
                key={s.key}
                onClick={() => onSetup({ statement: s.key })}
                className={cn(
                  'flex items-center gap-2 px-[13px] py-2 rounded-full text-[13px] border transition-colors',
                  active
                    ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)] text-[var(--primary)] font-semibold'
                    : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]'
                )}
              >
                <span className={cn('w-[6px] h-[6px] rounded-full', active ? 'bg-[var(--primary)]' : 'bg-[var(--text-faint)]')} />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-[1.35fr_1fr] gap-[26px] px-[22px] py-[22px] max-[1200px]:grid-cols-1">
        {/* 2 · Entities */}
        <div>
          <div className="flex items-baseline gap-2.5 mb-2.5">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)]">2 · Entities</div>
            <div className="flex-1" />
            <div className="font-mono text-[11px] text-[var(--text-faint)]">{selectedCount} of {companies.length} selected</div>
            <button onClick={selectAll} className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors">
              Select all
            </button>
          </div>
          <div className="border border-[var(--border)] rounded-[var(--r-lg)] overflow-hidden">
            <div className="flex items-center px-3 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
              <div className="w-[26px] flex-none" />
              <div className="flex-1">Company</div>
              <div className="w-[64px] flex-none text-right">Ccy</div>
              <div className="w-[78px] flex-none text-right">FY end</div>
              <div className="w-[70px] flex-none text-right">Held</div>
            </div>
            {companies.map((c) => {
              const on = setup.companyIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCompany(c.id)}
                  className={cn(
                    'w-full flex items-center px-3 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 text-left transition-colors',
                    on ? 'bg-[var(--surface)] hover:bg-[var(--primary-soft)]' : 'bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  )}
                >
                  <span className="w-[26px] flex-none flex">
                    <span
                      className={cn(
                        'w-4 h-4 rounded-[4px] flex items-center justify-center',
                        on ? 'bg-[var(--primary)]' : 'border border-[var(--border-strong)] bg-[var(--surface)]'
                      )}
                    >
                      {on && <Check size={10} strokeWidth={3.5} className="text-white" />}
                    </span>
                  </span>
                  <span className={cn('flex-1 min-w-0 text-[13px] truncate', on ? 'text-[var(--text-strong)] font-medium' : 'text-[var(--text-faint)]')}>
                    {c.name}
                  </span>
                  <span className={cn('w-[64px] flex-none text-right font-mono text-xs', on ? 'text-[var(--text)]' : 'text-[var(--text-faint)]')}>
                    {c.currency ?? 'CAD'}
                  </span>
                  <span className={cn('w-[78px] flex-none text-right font-mono text-xs', on ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)]')}>
                    {c.fiscalYearEnd ? format(new Date(c.fiscalYearEnd), 'MMM d') : '—'}
                  </span>
                  <span className={cn('w-[70px] flex-none text-right font-mono text-xs', on ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)]')}>
                    {heldMap[c.id] ?? '—'}
                  </span>
                </button>
              );
            })}
            <div className="px-3 py-[9px] bg-[var(--surface-2)] text-xs text-[var(--text-muted)]">{fyNote}</div>
          </div>
        </div>

        {/* 3 · Period + 4 · Treatment */}
        <div className="flex flex-col gap-5">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-2.5">3 · Period</div>
            <div className="flex gap-2 items-center">
              <div className="relative flex-1" ref={periodDd.ref}>
                <button
                  onClick={() => periodDd.setOpen(!periodDd.open)}
                  className="w-full flex items-center justify-between gap-2 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-[9px] hover:border-[var(--border-strong)] transition-colors"
                >
                  <span className="text-[13px] text-[var(--text)]">{setup.asOf === format(fyEnd, 'yyyy-MM-dd') ? fyLabel : setup.asOf}</span>
                  <ChevronDown size={14} className="text-[var(--text-muted)]" />
                </button>
                {periodDd.open && (
                  <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] shadow-[var(--shadow-md)] min-w-[220px] z-20 overflow-hidden">
                    {PRESETS.map(([k, l]) => (
                      <button
                        key={k}
                        onClick={() => applyPreset(k)}
                        className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[var(--surface-3)] text-[var(--text)]"
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                type="date"
                value={setup.asOf || today}
                onChange={(e) => onSetup({ asOf: e.target.value })}
                className="w-[132px] flex-none border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-[9px] font-mono text-[12.5px] text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <div className="relative flex-1" ref={compareDd.ref}>
                <button
                  onClick={() => compareDd.setOpen(!compareDd.open)}
                  className="w-full flex items-center justify-between gap-2 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-[9px] hover:border-[var(--border-strong)] transition-colors"
                >
                  <span className="text-[13px] text-[var(--text)]">
                    {setup.compare === 'none' ? 'No comparison' : setup.compare === 'prior_year' ? 'vs. prior year' : 'vs. prior period'}
                  </span>
                  <ChevronDown size={14} className="text-[var(--text-muted)]" />
                </button>
                {compareDd.open && (
                  <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] shadow-[var(--shadow-md)] min-w-[200px] z-20 overflow-hidden">
                    {([
                      ['none', 'No comparison'],
                      ['prior_year', 'vs. prior year'],
                      ['prior_period', 'vs. prior period'],
                    ] as const).map(([k, l]) => (
                      <button key={k} onClick={() => { onSetup({ compare: k }); compareDd.setOpen(false); }} className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[var(--surface-3)] text-[var(--text)]">
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative flex-1" ref={currencyDd.ref}>
                <button
                  onClick={() => currencyDd.setOpen(!currencyDd.open)}
                  className="w-full flex items-center justify-between gap-2 border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-[9px] hover:border-[var(--border-strong)] transition-colors"
                >
                  <span className="text-[13px] text-[var(--text)]">Present in {setup.presentationCurrency}</span>
                  <ChevronDown size={14} className="text-[var(--text-muted)]" />
                </button>
                {currencyDd.open && (
                  <div className="absolute top-full mt-1 left-0 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-lg)] shadow-[var(--shadow-md)] min-w-[160px] z-20 overflow-hidden">
                    {CURRENCY_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { onSetup({ presentationCurrency: c }); currencyDd.setOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[var(--surface-3)] text-[var(--text)]"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-3">4 · Treatment</div>
            <div className="flex flex-col gap-3">
              <Toggle
                label="Eliminate intercompany balances"
                hint="Nets due-from against due-to and removes investment in subsidiaries."
                on={setup.eliminateIntercompany}
                onChange={(v) => onSetup({ eliminateIntercompany: v })}
              />
              <Toggle
                label="Hide accounts with no balance"
                hint="Accounts that are nil in every entity are dropped from the statement."
                on={setup.hideZeroBalances}
                onChange={(v) => onSetup({ hideZeroBalances: v })}
              />
              <Toggle
                label="Show one column per entity"
                hint="Off gives the group column only — the printable version."
                on={setup.showEntityColumns}
                onChange={(v) => onSetup({ showEntityColumns: v })}
              />
              <Toggle
                label="Attach elimination working paper"
                hint="Appends the elimination schedule and FX rates used."
                on={setup.attachWorkingPaper}
                onChange={(v) => onSetup({ attachWorkingPaper: v })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 5 · Eliminations */}
      <EliminationsTable
        eliminations={eliminations}
        currency={setup.presentationCurrency}
        excludedIds={setup.excludedEliminationIds}
        onToggle={onToggleElimination}
        onAddManual={onAddManual}
      />

      {/* Action bar */}
      <div className="flex items-center gap-4 px-[22px] py-4 border-t border-[var(--border)] bg-[var(--surface-2)]">
        {hasBreak ? (
          <div className="flex items-start gap-3 px-4 py-2.5 rounded-[var(--r-lg)] bg-[var(--danger-soft)] border border-[var(--danger-soft-border)]">
            <AlertTriangle size={16} className="text-[var(--danger)] flex-none mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold text-[var(--danger)]">
                Intercompany break of {fmtNum(breaks.reduce((s, b) => s + b.difference, 0))} {setup.presentationCurrency}
              </div>
              <div className="text-xs text-[var(--danger)]">{breaks[0]?.description} does not net to zero.</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="w-[7px] h-[7px] rounded-full bg-[var(--success)]" />
            {tooFew ? (
              <span className="text-[13px] text-[var(--text-muted)]">Select at least two companies to consolidate.</span>
            ) : tooMany ? (
              <span className="text-[13px] text-[var(--text-muted)]">Consolidate at most 12 companies at a time.</span>
            ) : eliminations.length > 0 ? (
              <span className="text-[13px] text-[var(--text-muted)]">
                Ready — {selectedCount} entities in balance, {fmtNum(elimTotal)} {setup.presentationCurrency} to eliminate.
              </span>
            ) : !hasLinks && setup.eliminateIntercompany ? (
              <span className="text-[13px] text-[var(--text-muted)]">No related-party links set up — consolidation will run with nothing eliminated.</span>
            ) : (
              <span className="text-[13px] text-[var(--text-muted)]">Pick the statement, the entities and the period, then generate.</span>
            )}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={onSavePackage}
          className="text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors"
        >
          Save as package
        </button>
        <button
          onClick={onGenerate}
          disabled={ctaDisabled}
          className={cn(
            'flex items-center gap-2 rounded-full px-5 py-[11px] text-[13.5px] font-semibold text-white transition-all',
            ctaDisabled
              ? 'bg-[var(--text-faint)] cursor-not-allowed'
              : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)] active:translate-y-[1px]'
          )}
        >
          <RefreshCw size={15} className={running ? 'animate-spin' : ''} />
          {hasBreak ? 'Generate anyway' : 'Generate consolidated report'}
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-[11px]">
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn(
          'w-[34px] h-[20px] flex-none rounded-full relative mt-[1px] transition-colors',
          on ? 'bg-[var(--primary)]' : 'bg-[var(--border-strong)] hover:bg-[var(--border)]'
        )}
      >
        <span
          className={cn(
            'absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all',
            on ? 'left-4' : 'left-[2px]'
          )}
        />
      </button>
      <div>
        <div className="text-[13px] font-medium text-[var(--text)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">{hint}</div>
      </div>
    </div>
  );
}
