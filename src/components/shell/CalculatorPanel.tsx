'use client';

/**
 * In-app calculator panel (improvement plan Phase 1, item 5).
 *
 * A floating desk calculator anchored to the bottom-right of the app
 * shell — no backdrop, so the page underneath stays fully usable while
 * it is open. All arithmetic lives in the pure engine
 * (`src/lib/calculator.ts`); this component is rendering + keyboard +
 * the tax-rate choice.
 *
 * Tax rate source: the app stores no per-company calculator rate — a
 * company stores its `province`, and `@/lib/taxes` (the same table the
 * invoice/expense forms use) maps province → total sales-tax rate. The
 * panel resolves that as its default, lets the user override it with a
 * preset or a custom rate, and remembers an explicit choice in
 * localStorage (`lp-calculator-tax-rate`). A province-derived default is
 * NOT persisted, so switching companies re-derives it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Calculator as CalculatorIcon, Check, Copy, Delete, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  CalculatorEngine,
  formatMicro,
  formatRateMilliPct,
  microToPlainString,
  type CalculatorSnapshot,
  type CalcOperator,
} from '@/lib/calculator';
import { getTaxRate, type Province } from '@/lib/taxes';

const RATE_STORAGE_KEY = 'lp-calculator-tax-rate';

const RATE_PRESETS: { milli: number; label: string }[] = [
  { milli: 5000, label: '5% GST' },
  { milli: 13_000, label: '13% HST' },
  { milli: 15_000, label: '15% HST' },
  { milli: 14_000, label: '14% HST' },
];

/** Percent number → milli-percent, or null when the text is not a usable rate. */
function parseRateText(text: string): number | null {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(text.trim())) return null;
  return Math.round(value * 1000);
}

function milliToRateText(milli: number): string {
  return String(milli / 1000);
}

interface CalculatorPanelProps {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
}

export function CalculatorPanel({ open, onClose, companyId }: CalculatorPanelProps) {
  const [engine] = useState(() => new CalculatorEngine());
  const [snapshot, setSnapshot] = useState<CalculatorSnapshot>(() => engine.getState());
  const [copied, setCopied] = useState(false);

  const [rateMilliPct, setRateMilliPct] = useState(5000);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('5');
  const [rateSourceText, setRateSourceText] = useState('Default rate');
  const userChoseRate = useRef(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const tapeRef = useRef<HTMLDivElement>(null);

  const act = useCallback(
    (fn: (calc: CalculatorEngine) => void) => {
      fn(engine);
      setSnapshot(engine.getState());
    },
    [engine],
  );

  // ── Tax rate: saved choice first, else the company province default ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RATE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { milli?: unknown };
        if (typeof parsed.milli === 'number' && parsed.milli >= 0 && parsed.milli <= 100_000) {
          userChoseRate.current = true;
          setRateMilliPct(parsed.milli);
          setRateSourceText('Your saved rate');
          if (!RATE_PRESETS.some((p) => p.milli === parsed.milli)) {
            setCustomMode(true);
            setCustomText(milliToRateText(parsed.milli));
          }
          return;
        }
      }
    } catch {
      // Unreadable storage — fall through to the province default.
    }
    if (!companyId) return;
    let cancelled = false;
    fetch('/api/companies')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || userChoseRate.current) return;
        const list: any[] = Array.isArray(json.data) ? json.data : [];
        const company = list.find((c) => c.id === companyId) || list[0];
        if (!company?.province) return;
        const info = getTaxRate(company.province as Province);
        const milli = Math.round(info.totalRate * 1000);
        setRateMilliPct(milli);
        setRateSourceText(`Company province: ${info.label} · ${info.provinceName}`);
        if (!RATE_PRESETS.some((p) => p.milli === milli)) {
          setCustomMode(true);
          setCustomText(milliToRateText(milli));
        } else {
          setCustomMode(false);
        }
      })
      .catch(() => {
        // Keep the 5% GST default if the company can't be read.
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const persistRate = useCallback((milli: number) => {
    userChoseRate.current = true;
    setRateSourceText('Your saved rate');
    try {
      localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify({ milli }));
    } catch {
      // Persistence is a nicety; the panel still works without it.
    }
  }, []);

  const handlePresetChange = useCallback(
    (value: string) => {
      if (value === 'custom') {
        setCustomMode(true);
        setCustomText(milliToRateText(rateMilliPct));
        return;
      }
      const milli = Number(value);
      setCustomMode(false);
      setRateMilliPct(milli);
      persistRate(milli);
    },
    [persistRate, rateMilliPct],
  );

  const handleCustomChange = useCallback(
    (text: string) => {
      setCustomText(text);
      const milli = parseRateText(text);
      if (milli !== null) {
        setRateMilliPct(milli);
        persistRate(milli);
      }
    },
    [persistRate],
  );

  const customValid = !customMode || parseRateText(customText) !== null;

  // ── Focus the panel on open; keep the tape scrolled to the newest entry ──
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open ]);

  useEffect(() => {
    const el = tapeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot.tape.length, open]);

  // ── Keyboard: full calculator input while the panel is open ──
  // Keys are ignored when the event target is a form field (page fields
  // keep their input; the panel's own rate select/input keep theirs),
  // and when a modifier is held, so browser/app shortcuts still work.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inPanel = !!target && !!panelRef.current?.contains(target);
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (e.key === 'Escape') {
        if (inPanel || !inField) {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        act((c) => c.inputDigit(e.key));
      } else if (e.key === '.' || e.key === ',') {
        act((c) => c.inputDecimalPoint());
      } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        const op: CalcOperator =
          e.key === '+' ? 'add' : e.key === '-' ? 'subtract' : e.key === '*' ? 'multiply' : 'divide';
        act((c) => c.setOperator(op));
      } else if (e.key === 'Enter' || e.key === '=') {
        act((c) => c.equals());
      } else if (e.key === 'Backspace') {
        act((c) => c.backspace());
      } else if (e.key === 'Delete') {
        act((c) => c.clearEntry());
      } else if (e.key === '%') {
        act((c) => c.percent());
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, act]);

  const copyResult = useCallback(async () => {
    const text = microToPlainString(snapshot.displayMicro);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // Clipboard unavailable — the value is still on the display.
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [snapshot.displayMicro]);

  if (!open) return null;

  const keyBtn =
    'h-11 rounded-lg bg-[var(--surface-2)] text-[15px] font-medium text-[var(--text)] hover:bg-[var(--surface-3)] active:brightness-95 transition-colors grid place-items-center';
  const opBtn =
    'h-11 rounded-lg bg-[var(--surface-3)] text-[16px] font-semibold text-[var(--text-strong)] hover:brightness-95 active:brightness-90 transition grid place-items-center';

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Calculator"
      className="print:hidden fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] flex flex-col outline-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <CalculatorIcon size={16} className="text-[var(--text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Calculator</h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Close calculator"
          className="w-[28px] h-[28px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Tape */}
      <div className="mx-3 mt-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
        <div ref={tapeRef} className="h-[92px] overflow-y-auto px-3 py-2">
          {snapshot.tape.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)] text-right pt-1">
              Results appear here — click one to reuse it.
            </p>
          ) : (
            snapshot.tape.map((entry) => (
              <div key={entry.id} className="flex items-baseline justify-end gap-2 py-0.5">
                <span className="text-xs text-[var(--text-faint)] truncate">{entry.expression}</span>
                <button
                  onClick={() => act((c) => c.recall(entry.resultMicro))}
                  title="Use this result"
                  className="text-sm font-medium tabular-nums text-[var(--text)] hover:text-[var(--primary)] hover:underline flex-none"
                >
                  {formatMicro(entry.resultMicro)}
                </button>
              </div>
            ))
          )}
        </div>
        {snapshot.tape.length > 0 && (
          <div className="flex justify-end px-2 pb-1">
            <button
              onClick={() => act((c) => c.clearTape())}
              className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] px-1"
            >
              Clear tape
            </button>
          </div>
        )}
      </div>

      {/* Display */}
      <div className="px-4 pt-2">
        <div className="h-5 text-xs text-right text-[var(--text-faint)] tabular-nums truncate">
          {snapshot.expression}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={copyResult}
            disabled={snapshot.error}
            title="Copy result"
            aria-label="Copy result"
            className="w-[30px] h-[30px] grid place-items-center rounded-md text-[var(--text-faint)] hover:text-[var(--text-strong)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-40 flex-none"
          >
            {copied ? <Check size={15} className="text-[var(--success)]" /> : <Copy size={15} />}
          </button>
          <div
            className={cn(
              'flex-1 text-right text-[32px] leading-tight font-semibold tabular-nums truncate',
              snapshot.error ? 'text-[var(--danger)]' : 'text-[var(--text-strong)]',
            )}
          >
            {snapshot.display}
          </div>
        </div>
      </div>

      {/* Tax rate + tax keys */}
      <div className="px-3 pt-1">
        <div className="flex items-center gap-2">
          <label htmlFor="calc-tax-rate" className="text-xs text-[var(--text-muted)] flex-none">
            Tax
          </label>
          <select
            id="calc-tax-rate"
            value={customMode ? 'custom' : String(rateMilliPct)}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
          >
            {RATE_PRESETS.map((p) => (
              <option key={p.milli} value={String(p.milli)}>
                {p.label}
              </option>
            ))}
            {!customMode && !RATE_PRESETS.some((p) => p.milli === rateMilliPct) && (
              <option value={String(rateMilliPct)}>{formatRateMilliPct(rateMilliPct)}</option>
            )}
            <option value="custom">Custom rate…</option>
          </select>
          {customMode && (
            <span className="flex items-center gap-1 flex-none">
              <input
                value={customText}
                onChange={(e) => handleCustomChange(e.target.value)}
                inputMode="decimal"
                aria-label="Custom tax rate percent"
                className={cn(
                  'w-[70px] rounded-md border bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]',
                  customValid ? 'border-[var(--border)]' : 'border-[var(--danger)]',
                )}
              />
              <span className="text-sm text-[var(--text-muted)]">%</span>
            </span>
          )}
        </div>
        <div className="text-[11px] text-[var(--text-faint)] pt-1 truncate">{rateSourceText}</div>
        <div className="flex gap-2 pt-1.5">
          <button
            onClick={() => act((c) => c.addTax(rateMilliPct))}
            disabled={!customValid || snapshot.error}
            className="flex-1 h-9 rounded-lg bg-[var(--surface-3)] text-sm font-semibold text-[var(--text-strong)] hover:brightness-95 active:brightness-90 transition disabled:opacity-40"
          >
            +Tax {formatRateMilliPct(rateMilliPct)}
          </button>
          <button
            onClick={() => act((c) => c.removeTax(rateMilliPct))}
            disabled={!customValid || snapshot.error}
            className="flex-1 h-9 rounded-lg bg-[var(--surface-3)] text-sm font-semibold text-[var(--text-strong)] hover:brightness-95 active:brightness-90 transition disabled:opacity-40"
          >
            −Tax {formatRateMilliPct(rateMilliPct)}
          </button>
        </div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1.5 p-3">
        <button onClick={() => act((c) => c.clearAll())} className={cn(keyBtn, 'text-[var(--danger)] font-semibold')}>
          AC
        </button>
        <button onClick={() => act((c) => c.clearEntry())} className={keyBtn}>
          CE
        </button>
        <button onClick={() => act((c) => c.backspace())} className={keyBtn} aria-label="Backspace">
          <Delete size={17} />
        </button>
        <button onClick={() => act((c) => c.setOperator('divide'))} className={opBtn}>
          ÷
        </button>

        <button onClick={() => act((c) => c.inputDigit('7'))} className={keyBtn}>7</button>
        <button onClick={() => act((c) => c.inputDigit('8'))} className={keyBtn}>8</button>
        <button onClick={() => act((c) => c.inputDigit('9'))} className={keyBtn}>9</button>
        <button onClick={() => act((c) => c.setOperator('multiply'))} className={opBtn}>×</button>

        <button onClick={() => act((c) => c.inputDigit('4'))} className={keyBtn}>4</button>
        <button onClick={() => act((c) => c.inputDigit('5'))} className={keyBtn}>5</button>
        <button onClick={() => act((c) => c.inputDigit('6'))} className={keyBtn}>6</button>
        <button onClick={() => act((c) => c.setOperator('subtract'))} className={opBtn}>−</button>

        <button onClick={() => act((c) => c.inputDigit('1'))} className={keyBtn}>1</button>
        <button onClick={() => act((c) => c.inputDigit('2'))} className={keyBtn}>2</button>
        <button onClick={() => act((c) => c.inputDigit('3'))} className={keyBtn}>3</button>
        <button onClick={() => act((c) => c.setOperator('add'))} className={opBtn}>+</button>

        <button onClick={() => act((c) => c.toggleSign())} className={keyBtn}>±</button>
        <button onClick={() => act((c) => c.inputDigit('0'))} className={keyBtn}>0</button>
        <button onClick={() => act((c) => c.inputDecimalPoint())} className={keyBtn}>.</button>
        <button onClick={() => act((c) => c.percent())} className={keyBtn}>%</button>

        <button
          onClick={() => act((c) => c.equals())}
          className="col-span-4 h-11 rounded-lg bg-[var(--primary)] text-white text-[17px] font-semibold hover:brightness-[0.95] active:brightness-90 transition"
        >
          =
        </button>
      </div>
    </div>
  );
}
