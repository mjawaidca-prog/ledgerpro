'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/shell/AppShell';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/lib/cn';
import { ArrowLeft, Loader2, Check, Upload, ArrowRight } from 'lucide-react';
import { N, SIGNED } from '@/lib/fx-format';
import { fetchWithTenantHeaders, resolveTenantHeaders } from '@/lib/tenant-client';

type Step = 1 | 2 | 3;

interface Preset {
  id: string;
  institution: string;
  label: string;
  fileTypes: string[];
  dateFormat: string;
  amountMode: 'signed' | 'debit_credit';
  isSystem: boolean;
}

interface Column {
  name: string;
  sampleValues: string[];
}

interface ParseData {
  fileName: string;
  fileSize: number;
  fileType: string;
  columns: Column[];
  suggestedMap: Record<string, string>;
  detectedDateFormat: string | null;
  amountMode: 'signed' | 'debit_credit' | null;
  isDateAmbiguous: boolean;
  rangeStart: string | null;
  rangeEnd: string | null;
  rowsTotal: number;
  rows: { raw: Record<string, string> }[];
  lastImportAt: string | null;
  overlapNote: string;
}

interface DryRunData {
  preview: { date: string; description: string; payeeGuess: string | null; amount: number; statementBalance: number | null }[];
  duplicates: { rowIndex: number; reason: string; skip: boolean; existing?: { date: string; description: string; amount: number } }[];
  lockedRows: number[];
  ruleHits: { categorized: number; activeRuleCount: number; ruleNames: string[] };
  newRows: number;
  totals: { rowsInFile: number; skippedDuplicate: number; skippedLocked: number; newTransactions: number };
}

const FIELDS: { value: string; label: string }[] = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'memo', label: 'Memo' },
  { value: 'reference', label: 'Reference' },
  { value: 'amount_signed', label: 'Amount (signed)' },
  { value: 'amount_debit', label: 'Money out' },
  { value: 'amount_credit', label: 'Money in' },
  { value: 'statement_balance', label: 'Statement balance' },
];

const DATE_FORMATS = [
  { value: 'MDY', label: 'M/D/YYYY' },
  { value: 'MM_DD_YYYY', label: 'MM/DD/YYYY' },
  { value: 'DD_MM_YYYY', label: 'DD/MM/YYYY' },
  { value: 'YYYY_MM_DD', label: 'YYYY-MM-DD' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD' },
];

export default function ImportStatementPage({ params }: { params: { accountId: string } }) {
  const router = useRouter();
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [parseData, setParseData] = useState<ParseData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [map, setMap] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState<string>('');
  const [amountMode, setAmountMode] = useState<'signed' | 'debit_credit'>('signed');
  const [dryRun, setDryRun] = useState<DryRunData | null>(null);

  // Step 3 state
  const [skipRows, setSkipRows] = useState<Set<number>>(new Set());
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [applyRules, setApplyRules] = useState(true);
  const [autoPostExact, setAutoPostExact] = useState(false);
  const [savePreset, setSavePreset] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    fetchWithTenantHeaders('/api/import-presets')
      .then((r) => r.json())
      .then((json) => setPresets(json.data ?? []))
      .catch(() => {});
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setParseData(null);
      setDryRun(null);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('accountId', params.accountId);
        if (selectedPresetId) form.append('presetId', selectedPresetId);

        const res = await fetchWithTenantHeaders('/api/imports/parse', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to read the file');

        const data: ParseData = json.data;
        setParseData(data);

        // Seed the mapping from the preset's suggested map.
        const initialMap: Record<string, string> = { ...data.suggestedMap };
        for (const col of data.columns) {
          if (initialMap[col.name] === undefined) initialMap[col.name] = 'ignore';
        }
        setMap(initialMap);
        setDateFormat(data.detectedDateFormat ?? '');
        setAmountMode(data.amountMode ?? 'signed');

        if (data.detectedDateFormat) {
          // Preset knows the format — skip straight to mapping (step 2).
          setStep(2);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [params.accountId, selectedPresetId]
  );

  const checkDuplicates = async () => {
    if (!parseData) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        accountId: params.accountId,
        map,
        dateFormat,
        amountMode,
        isDateAmbiguous: parseData.isDateAmbiguous,
        skipDuplicates,
        applyRules,
        rows: parseData.rows,
      };
      const res = await fetchWithTenantHeaders('/api/imports/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to check duplicates');

      const data: DryRunData = json.data;
      setDryRun(data);
      // Default skips: exact duplicates + locked rows.
      const defaults = new Set<number>();
      for (const d of data.duplicates) if (d.skip) defaults.add(d.rowIndex);
      for (const r of data.lockedRows) defaults.add(r);
      setSkipRows(defaults);
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!parseData || !dryRun) return;
    setCommitting(true);
    setError(null);
    try {
      const body = {
        accountId: params.accountId,
        fileName: parseData.fileName,
        fileSize: parseData.fileSize,
        fileType: parseData.fileType,
        presetId: selectedPresetId,
        map,
        dateFormat,
        amountMode,
        isDateAmbiguous: parseData.isDateAmbiguous,
        skipDuplicates,
        applyRules,
        autoPostExactMatches: autoPostExact,
        skipRowIndexes: [...skipRows],
        savePreset,
        rows: parseData.rows,
      };
      const res = await fetchWithTenantHeaders('/api/imports/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to import');
      router.push(`/banking/${params.accountId}/review`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCommitting(false);
    }
  };

  const stepper = (
    <div className="flex items-center gap-2 mb-6">
      {(['File & preset', 'Map columns', 'Duplicates'] as const).map((label, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        const current = step === n;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                'w-[26px] h-[26px] rounded-full grid place-items-center text-xs font-semibold border',
                current ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : done ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)] text-[var(--primary)]' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-faint)]'
              )}
            >
              {done ? '✓' : n}
            </div>
            <span className={cn('text-[13px]', current ? 'text-[var(--text-strong)] font-semibold' : 'text-[var(--text-muted)]')}>{label}</span>
            {i < 2 && <span className="text-[var(--text-faint)]">→</span>}
          </div>
        );
      })}
      <div className="flex-1" />
      <div className="font-mono text-[11px] text-[var(--text-faint)]">
        {parseData ? `${parseData.fileName} · ${parseData.rowsTotal} rows · ${(parseData.fileSize / 1024).toFixed(1)} KB` : 'no file chosen yet'}
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-[18px]">
        <button
          onClick={() => router.push('/banking')}
          className="w-[38px] h-[38px] grid place-items-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-[13px] text-[var(--text-muted)]">
          Banking <span className="text-[var(--text-faint)]">›</span> <strong className="text-[var(--text-strong)] font-semibold">Import a statement</strong>
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-[var(--tracking-tighter)] text-[var(--text-strong)]">Import a statement</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1 max-w-[640px] mb-6">
        Three steps: read the file, confirm the columns, deal with anything that looks like a duplicate. A saved preset skips the middle step next time.
      </p>

      {stepper}
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {/* ── Step 1: File & preset ── */}
      {step === 1 && (
        <div className="grid grid-cols-[1fr_350px] gap-6 max-[1100px]:grid-cols-1">
          <div className="space-y-5">
            <div>
              <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-2">Statement file</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[var(--border-strong)] rounded-[var(--r-xl)] p-10 text-center cursor-pointer hover:border-[var(--border-focus)] transition-colors"
              >
                <Upload size={22} className="mx-auto text-[var(--text-muted)]" />
                <div className="text-sm font-semibold text-[var(--text-strong)] mt-2">Drop your statement here</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">or choose a file from your computer</div>
                <div className="flex items-center justify-center gap-2 mt-3">
                  {['.csv', '.ofx', '.qfx'].map((ext) => (
                    <span key={ext} className="px-2 py-0.5 rounded-full bg-[var(--success-soft)] border border-[var(--success-soft-border)] font-mono text-[10.5px] text-[var(--success)]">{ext}</span>
                  ))}
                  <span className="px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] font-mono text-[10.5px] text-[var(--text-faint)]">.pdf</span>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx,.qfx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <div className="text-xs text-[var(--text-muted)] mt-2">
                PDF statements cannot be read. Every bank below offers a CSV or OFX download in online banking, usually under &ldquo;Download transactions&rdquo;.
              </div>
              {busy && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mt-3">
                  <Loader2 size={15} className="animate-spin text-[var(--primary)]" /> Reading the file…
                </div>
              )}
            </div>

            <div>
              <label className="font-mono text-micro uppercase tracking-[0.08em] text-[var(--text-muted)] block mb-1">Bank preset</label>
              <div className="text-xs text-[var(--text-muted)] mb-3">
                A preset knows the column order, the date format and how the bank signs debits, so mapping is skipped entirely.
              </div>
              <div className="grid grid-cols-2 gap-3">
                {presets.filter((p) => p.isSystem).map((p) => {
                  const active = selectedPresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPresetId(active ? null : p.id)}
                      className={cn(
                        'text-left rounded-[var(--r-lg)] border p-3.5 transition-colors',
                        active ? 'bg-[var(--primary-soft)] border-[var(--primary-soft-border)]' : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn('font-mono text-[13px] font-semibold', active ? 'text-[var(--primary)]' : 'text-[var(--text-strong)]')}>{p.institution}</span>
                        <span className="text-[13px] text-[var(--text-muted)]">{p.label}</span>
                        {active && <Check size={14} className="text-[var(--primary)] ml-auto" />}
                      </div>
                      <div className="font-mono text-[10.5px] text-[var(--text-faint)] mt-1">
                        {p.fileTypes.join('/').toUpperCase()} · {p.dateFormat} · {p.amountMode === 'signed' ? 'signed' : 'debit/credit'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5 space-y-3">
              <div className="text-[13px] text-[var(--text-muted)]">Into which account</div>
              <div className="text-sm font-medium text-[var(--text-strong)]">This account</div>
              <div className="font-mono text-[11px] text-[var(--text-faint)]">
                {parseData?.rangeStart && parseData?.rangeEnd ? `${parseData.rangeStart} to ${parseData.rangeEnd}` : 'Date range appears after the file is read'}
              </div>
              {parseData?.overlapNote && <div className="text-xs text-[var(--text-muted)]">{parseData.overlapNote}</div>}
              <div className="space-y-3 pt-2">
                <Toggle label="Skip rows that already exist" hint="Compared on date, amount and description within a 3-day window." on={skipDuplicates} onChange={setSkipDuplicates} />
                <Toggle label="Apply rules on the way in" hint="Categorized rows still wait for confirmation." on={applyRules} onChange={setApplyRules} />
                <Toggle label="Auto-post exact invoice matches" hint="Off by default — a match on amount alone is not proof of payment." on={autoPostExact} onChange={setAutoPostExact} />
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="w-full rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px]"
              >
                Read the file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Map columns ── */}
      {step === 2 && parseData && (
        <div className="space-y-5">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)]">
              <div className="text-sm font-semibold text-[var(--text-strong)]">Map the columns</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                {Object.values(map).filter((v) => v !== 'ignore').length} of {parseData.columns.length} columns recognised from the file header.
              </div>
            </div>
            <div className="grid grid-cols-[170px_200px_40px_200px_1fr] px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
              <div>Column in file</div><div>Sample value</div><div /><div>LedgerPro field</div><div>Note</div>
            </div>
            {parseData.columns.map((col) => {
              const field = map[col.name] ?? 'ignore';
              const needsConfirm = !parseData.suggestedMap[col.name] && field === 'ignore' && col.sampleValues.length > 0;
              return (
                <div key={col.name} className={cn('grid grid-cols-[170px_200px_40px_200px_1fr] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 items-center', needsConfirm && 'bg-[var(--warning-soft)]')}>
                  <div className="text-[13px] text-[var(--text-strong)]">{col.name}</div>
                  <div className="font-mono text-[11.5px] text-[var(--text-muted)] truncate">{col.sampleValues[0] ?? '(empty)'}</div>
                  <ArrowRight size={13} className="text-[var(--text-faint)]" />
                  <div>
                    <select
                      value={field}
                      onChange={(e) => setMap((prev) => ({ ...prev, [col.name]: e.target.value }))}
                      className="border border-[var(--border)] rounded-[var(--r-md)] bg-[var(--surface)] px-2 py-1.5 text-[12.5px] text-[var(--text)] outline-none"
                    >
                      {FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="font-mono text-[10.5px] text-[var(--text-faint)]">
                    {field === 'description' ? 'Rules match against this.' : field === 'amount_signed' ? 'Negative means money out.' : field === 'statement_balance' ? 'Used to catch a missed row.' : field === 'ignore' ? 'Same on every row.' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Date format</label>
              <select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                className="border border-[var(--border)] rounded-[var(--r-lg)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            {parseData.isDateAmbiguous && (
              <div className="text-xs text-[var(--warning)]">8/14/2026 reads as August 14, not February 8.</div>
            )}
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
              <input type="checkbox" checked={savePreset} onChange={(e) => setSavePreset(e.target.checked)} className="accent-[var(--primary)]" />
              Save as preset
            </label>
            <button
              onClick={checkDuplicates}
              disabled={busy}
              className="rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px] flex items-center gap-2"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Check for duplicates
            </button>
          </div>

          {dryRun && dryRun.preview.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] overflow-hidden">
              <div className="px-4 py-3 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center justify-between">
                <div className="text-sm font-semibold text-[var(--text-strong)]">Preview — first four rows as they will post</div>
                <span className="font-mono text-[11px] text-[var(--text-faint)]">{parseData.rowsTotal} rows total</span>
              </div>
              <div className="grid grid-cols-[110px_1fr_160px_110px_110px] px-4 py-2 border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                <div>Date</div><div>Description</div><div>Payee read</div><div className="text-right">Amount</div><div className="text-right">Balance</div>
              </div>
              {dryRun.preview.map((row, i) => (
                <div key={i} className="grid grid-cols-[110px_1fr_160px_110px_110px] px-4 py-2.5 border-b border-[var(--surface-3)] last:border-b-0 text-[12.5px] items-center">
                  <div className="font-mono text-[var(--text-muted)]">{row.date}</div>
                  <div className="text-[var(--text)] truncate">{row.description}</div>
                  <div className="text-[var(--text-muted)] truncate">{row.payeeGuess ?? '—'}</div>
                  <div className={cn('text-right font-mono tabular-nums', row.amount >= 0 ? 'text-[var(--success)]' : 'text-[var(--text-strong)]')}>{SIGNED(row.amount)}</div>
                  <div className="text-right font-mono tabular-nums text-[var(--text-muted)]">{row.statementBalance !== null ? N(row.statementBalance) : '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Duplicates ── */}
      {step === 3 && dryRun && (
        <div className="grid grid-cols-[1fr_350px] gap-6 max-[1100px]:grid-cols-1">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-[var(--text-strong)]">
              {dryRun.duplicates.length + dryRun.lockedRows.length} rows look like transactions you already have
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Matched on date, amount and description against what is already in this account. Skipped rows are recorded in the import log, so nothing disappears silently.
            </div>

            {dryRun.duplicates.map((d) => {
              const row = parseData!.rows[d.rowIndex]?.raw ?? {};
              const desc = Object.values(row).find((v) => v && typeof v === 'string') ?? `Row ${d.rowIndex + 1}`;
              const locked = false;
              const isChecked = skipRows.has(d.rowIndex);
              const isLocked = d.reason === 'locked_period';
              void locked;
              return (
                <div key={d.rowIndex} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isLocked || isChecked}
                      disabled={isLocked}
                      onChange={(e) => {
                        setSkipRows((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(d.rowIndex);
                          else next.delete(d.rowIndex);
                          return next;
                        });
                      }}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                    <span className="flex-1 text-[13.5px] font-medium text-[var(--text-strong)] truncate">{String(desc)}</span>
                    <span className="font-mono text-[11px] text-[var(--text-faint)]">row {d.rowIndex + 1} of the file</span>
                    <span className={cn('font-mono tabular-nums text-[13px]', d.existing ? 'text-[var(--text)]' : 'text-[var(--text)]')}>
                      {d.existing ? SIGNED(d.existing.amount) : ''}
                    </span>
                    <ReasonPill reason={d.reason} />
                  </div>
                  {d.existing && (
                    <div className="mt-2 pl-7 text-xs text-[var(--text-muted)] flex items-center gap-2">
                      <ArrowRight size={11} className="text-[var(--text-faint)]" />
                      {d.reason === 'exact'
                        ? `Already in the ledger — ${d.existing.description} on ${d.existing.date.slice(0, 10)}`
                        : d.reason === 'same_amount'
                          ? `A ${Math.abs(d.existing.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${d.existing.amount > 0 ? 'deposit' : 'charge'} exists on ${d.existing.date.slice(0, 10)} — so it may be a second one`
                          : ''}
                      <button className="text-[var(--primary)] font-medium">Keep both</button>
                    </div>
                  )}
                </div>
              );
            })}

            {dryRun.lockedRows.map((rowIndex) => (
              <div key={`locked-${rowIndex}`} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-4">
                <div className="flex items-center gap-3 opacity-70">
                  <input type="checkbox" checked disabled className="w-4 h-4 accent-[var(--primary)]" />
                  <span className="flex-1 text-[13.5px] font-medium text-[var(--text-muted)] truncate">Row {rowIndex + 1} of the file</span>
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">row {rowIndex + 1}</span>
                  <ReasonPill reason="locked_period" />
                </div>
                <div className="mt-2 pl-7 text-xs text-[var(--text-muted)] flex items-center gap-2">
                  <ArrowRight size={11} className="text-[var(--text-faint)]" />
                  Falls inside a locked reconciliation and cannot be imported
                  <button className="text-[var(--primary)] font-medium">Why locked</button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--r-xl)] p-5">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--text-muted)] mb-3">What will happen</div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">Rows in the file</span><span className="font-mono tabular-nums text-[var(--text)]">{dryRun.totals.rowsInFile}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">Skipped as duplicates</span><span className="font-mono tabular-nums text-[var(--warning)]">{skipRows.size - dryRun.lockedRows.length > 0 ? skipRows.size - dryRun.lockedRows.length : dryRun.totals.skippedDuplicate}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">Skipped — locked period</span><span className="font-mono tabular-nums text-[var(--text)]">{dryRun.totals.skippedLocked}</span></div>
                <div className="flex justify-between pt-2 border-t border-[var(--border)]"><span className="text-[var(--text-strong)] font-semibold">New transactions</span><span className="font-mono tabular-nums font-bold text-[var(--text-strong)]">{dryRun.totals.newTransactions}</span></div>
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-3">
                Rules will categorize {dryRun.ruleHits.categorized} of the new rows on the way in. The rest land in the review queue.
              </div>
              <button
                onClick={commit}
                disabled={committing}
                className="w-full mt-4 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--text-faint)] text-white text-[13.5px] font-semibold px-5 py-2.5 transition-all active:translate-y-[1px] flex items-center justify-center gap-2"
              >
                {committing && <Loader2 size={15} className="animate-spin" />}
                Import {dryRun.totals.newTransactions} transactions
              </button>
              <div className="text-xs text-[var(--text-faint)] mt-3 text-center">Reversible for 24 hours from the import log.</div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ReasonPill({ reason }: { reason: string }) {
  if (reason === 'exact') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--danger-soft)] border border-[var(--danger-soft-border)]">
        <span className="w-[5px] h-[5px] rounded-full bg-[var(--danger)]" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--danger)]">Exact match</span>
      </span>
    );
  }
  if (reason === 'same_amount') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--warning-soft)] border border-[var(--warning-soft-border)]">
        <span className="w-[5px] h-[5px] rounded-full bg-[var(--warning)]" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--warning)]">Same amount</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--neutral-soft)] border border-[var(--neutral-soft-border)]">
      <span className="w-[5px] h-[5px] rounded-full bg-[var(--text-faint)]" />
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Locked period</span>
    </span>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-2.5">
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={cn('w-[34px] h-[20px] flex-none rounded-full relative transition-colors', on ? 'bg-[var(--primary)]' : 'bg-[var(--border-strong)]')}
      >
        <span className={cn('absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all', on ? 'left-4' : 'left-[2px]')} />
      </button>
      <div>
        <div className="text-[12.5px] font-medium text-[var(--text)]">{label}</div>
        <div className="text-[11px] text-[var(--text-muted)]">{hint}</div>
      </div>
    </div>
  );
}
