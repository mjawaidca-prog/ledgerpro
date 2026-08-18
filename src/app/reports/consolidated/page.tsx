'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ArrowLeft, Loader2, AlertCircle, Link2, Save } from 'lucide-react';
import Builder from './builder';
import ReportDocument from './report-document';
import DrillDownModal from './drill-down-modal';
import ManualEliminationModal from './manual-elimination-modal';
import SavedPackagesPanel from './saved-packages-panel';
import {
  loadStoredSetup,
  persistSetup,
  setupSignature,
  type CompanyOption,
  type ConsolidatedReportData,
  type ConsolidatedSetup,
  type ReportLine,
  type RunStatus,
} from './state';

function getCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

export default function ConsolidatedReportsPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<ConsolidatedSetup>(() => loadStoredSetup());
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [heldMap, setHeldMap] = useState<Record<string, string>>({});
  const [hasLinks, setHasLinks] = useState(true);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [data, setData] = useState<ConsolidatedReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runSignature, setRunSignature] = useState<string | null>(null);
  const [drillLine, setDrillLine] = useState<ReportLine | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);

  // ── Bootstrap: companies + related-party links ──
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [companiesRes, linksRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/related-parties'),
        ]);
        const companiesJson = await companiesRes.json();
        const list: CompanyOption[] = companiesJson.data ?? [];
        if (!active) return;

        const links = (await linksRes.json()).data ?? [];
        const activeId = getCookie('lp-active-company-id');

        // Parent (active company) first, then the rest.
        const ordered = [
          ...list.filter((c) => c.id === activeId),
          ...list.filter((c) => c.id !== activeId),
        ];
        setCompanies(ordered);
        setHasLinks(links.length > 0);

        // Held % map vs the parent.
        const map: Record<string, string> = {};
        for (const c of list) {
          if (c.id === (activeId ?? list[0]?.id)) {
            map[c.id] = 'Parent';
            continue;
          }
          const link = links.find(
            (l: any) =>
              (l.companyAId === (activeId ?? list[0]?.id) && l.companyBId === c.id) ||
              (l.companyBId === (activeId ?? list[0]?.id) && l.companyAId === c.id)
          );
          if (link) {
            const pct =
              link.companyAId === (activeId ?? list[0]?.id)
                ? Number(link.aOwnershipOfB ?? 100)
                : Number(link.bOwnershipOfA ?? 100);
            map[c.id] = `${pct}%`;
          } else {
            map[c.id] = '—';
          }
        }
        setHeldMap(map);

        // Default entity selection: all companies, parent first.
        setSetup((prev) => {
          if (prev.companyIds.length) return prev;
          const ids = ordered.map((c) => c.id);
          const next = {
            ...prev,
            companyIds: ids,
            asOf: prev.asOf || ordered[0]?.fiscalYearEnd || new Date().toISOString().slice(0, 10),
            presentationCurrency: prev.presentationCurrency || ordered[0]?.currency || 'CAD',
          };
          persistSetup(next);
          return next;
        });
      } catch {
        if (active) setError('Could not load companies. Please try again.');
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    persistSetup(setup);
  }, [setup]);

  const updateSetup = useCallback((next: Partial<ConsolidatedSetup>) => {
    setSetup((prev) => ({ ...prev, ...next }));
  }, []);

  const toggleElimination = useCallback((id: string) => {
    setSetup((prev) => {
      const has = prev.excludedEliminationIds.includes(id);
      return {
        ...prev,
        excludedEliminationIds: has
          ? prev.excludedEliminationIds.filter((x) => x !== id)
          : [...prev.excludedEliminationIds, id],
      };
    });
  }, []);

  // ── Generate ──
  const generate = useCallback(async () => {
    if (setup.companyIds.length < 2 || setup.companyIds.length > 12) return;
    setStatus('loading');
    setError(null);
    try {
      const params = new URLSearchParams({
        statement: setup.statement,
        companyIds: setup.companyIds.join(','),
        asOf: setup.asOf,
        currency: setup.presentationCurrency,
        eliminate: setup.eliminateIntercompany ? '1' : '0',
        hideZero: setup.hideZeroBalances ? '1' : '0',
      });
      if (setup.from) params.set('from', setup.from);
      if (setup.compare !== 'none') params.set('compare', setup.compare);
      if (setup.excludedEliminationIds.length) params.set('excludeElim', setup.excludedEliminationIds.join(','));
      if (setup.manualEliminations.length) params.set('manualElims', JSON.stringify(setup.manualEliminations));

      const res = await fetch(`/api/reports/consolidated?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setError(json.error || 'Failed to generate the consolidated report.');
        return;
      }
      setData(json.data);
      setRunSignature(setupSignature(setup));
      setStatus('ready');
    } catch (err: any) {
      setStatus('error');
      setError(err.message || 'Failed to generate the consolidated report.');
    }
  }, [setup]);

  const stale = data !== null && status !== 'loading' && runSignature !== null && setupSignature(setup) !== runSignature;

  return (
    <AppShell>
      <style>{`@media print { @page { size: A4 landscape; } }`}</style>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-[18px] print:hidden">
        <button
          onClick={() => router.push('/reports')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back to reports"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Reports <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Consolidated Reports</strong>
        </span>
      </div>

      {/* Page head */}
      <div className="flex items-end justify-between gap-5 mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Consolidated Reports</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px]">
            Combine the books of several companies into one statement. Intercompany balances are eliminated before the group figures are struck.
          </p>
        </div>
        <button
          onClick={() => setPackagesOpen(true)}
          className="flex items-center gap-[7px] border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)] transition-colors"
        >
          <Save size={14} />
          Saved packages
        </button>
      </div>

      {/* Builder */}
      <div className="print:hidden">
        <Builder
          setup={setup}
          companies={companies}
          heldMap={heldMap}
          eliminations={data?.eliminations ?? []}
          status={status}
          hasLinks={hasLinks}
          onSetup={updateSetup}
          onToggleElimination={toggleElimination}
          onAddManual={() => setManualOpen(true)}
          onGenerate={generate}
          onSavePackage={() => setPackagesOpen(true)}
        />
      </div>

      {/* Output region */}
      <div className="mt-5">
        {status === 'loading' ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-10">
            <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin text-[var(--primary)]" />
              Reading {setup.companyIds.length} ledgers, translating balances, applying eliminations…
            </div>
            <div className="border-t border-[var(--border)] mt-5 pt-5 space-y-3" aria-hidden>
              {[46, 38, 52, 31, 44, 36, 49, 33, 41].map((w, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-[11px] rounded bg-[var(--surface-3)]" style={{ width: `${w}%` }} />
                  <div className="h-[11px] w-[96px] rounded bg-[var(--surface-3)]" />
                  <div className="h-[11px] w-[96px] rounded bg-[var(--surface-3)]" />
                  <div className="h-[11px] w-[96px] rounded bg-[var(--border)]" />
                </div>
              ))}
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="border border-red-200 rounded-[var(--r-xl)] p-10 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--danger-soft)] flex items-center justify-center mb-3">
              <AlertCircle size={20} className="text-[var(--danger)]" />
            </div>
            <div className="text-base font-semibold text-[var(--text-strong)]">Consolidation could not be completed</div>
            <div className="text-sm text-[var(--text-muted)] mt-1.5 max-w-[520px] mx-auto">{error}</div>
            <button
              onClick={generate}
              className="mt-4 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]"
            >
              Try again
            </button>
          </div>
        ) : data ? (
          <ReportDocument
            data={data}
            showEntityColumns={setup.showEntityColumns}
            attachWorkingPaper={setup.attachWorkingPaper}
            stale={stale}
            onDrillDown={setDrillLine}
          />
        ) : !hasLinks && setup.eliminateIntercompany && setup.companyIds.length >= 2 ? (
          <div className="bg-[var(--warning-soft)] border border-[var(--warning-soft-border)] rounded-[var(--r-xl)] p-10 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-white flex items-center justify-center mb-3 border border-[var(--border)]">
              <Link2 size={20} className="text-[var(--warning)]" />
            </div>
            <div className="text-base font-semibold text-[var(--text-strong)]">No related-party links set up</div>
            <div className="text-sm text-[var(--text-muted)] mt-1.5 max-w-[520px] mx-auto">
              Consolidation can still run, but nothing will be eliminated. Link the companies that trade with each other so due-from and due-to balances cancel.
            </div>
            <button
              onClick={() => router.push('/intercompany/relationships')}
              className="mt-4 rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] text-[13px] font-medium px-4 py-2 hover:border-[var(--border-focus)] transition-colors"
            >
              Set up relationships
            </button>
          </div>
        ) : (
          <div className="border border-dashed border-[var(--border-strong)] rounded-[var(--r-xl)] py-14 px-[22px] text-center">
            <div className="text-base font-semibold text-[var(--text-strong)]">No report generated yet</div>
            <div className="text-sm text-[var(--text-muted)] mt-1.5">
              Pick the statement, the entities and the period, then generate. The group figures appear here.
            </div>
          </div>
        )}
      </div>

      <DrillDownModal
        line={drillLine}
        companyIds={setup.companyIds}
        asOf={setup.asOf}
        currency={setup.presentationCurrency}
        onClose={() => setDrillLine(null)}
      />

      <ManualEliminationModal
        open={manualOpen}
        companies={companies}
        onClose={() => setManualOpen(false)}
        onSave={(elim) => updateSetup({ manualEliminations: [...setup.manualEliminations, elim] })}
      />

      <SavedPackagesPanel
        open={packagesOpen}
        setup={setup}
        onClose={() => setPackagesOpen(false)}
        onLoad={(loaded) => {
          setSetup(loaded);
          setData(null);
          setRunSignature(null);
          setStatus('idle');
        }}
      />
    </AppShell>
  );
}
