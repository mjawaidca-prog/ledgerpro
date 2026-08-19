/**
 * FX display formatters — QBO-style dual amounts.
 *
 * Convention: the transaction currency is the primary figure; the home
 * equivalent is muted subtext. Negatives render in parentheses, nil as an
 * em dash, every amount/rate/date in mono tabular-nums.
 */

export function N(
  n: number | null | undefined,
  opts?: { suffix?: string; zeroDecimals?: boolean }
): string {
  if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
  const decimals = opts?.zeroDecimals ? 0 : 2;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = n < 0 ? '-' : '';
  return `${sign}${abs}${opts?.suffix ? ` ${opts.suffix}` : ''}`;
}

/** Signed with U+2212 minus — e.g. +1,738.45 / −130.47. */
export function SIGNED(n: number | null | undefined, opts?: { suffix?: string }): string {
  if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n > 0 ? '+' : '−';
  return `${sign}${abs}${opts?.suffix ? ` ${opts.suffix}` : ''}`;
}

/** Derived-not-yet-posted home equivalent: "≈ 9,438.40 CAD". */
export function approx(n: number | null | undefined, code: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `≈ ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}

export function inverseRate(rate: number | null | undefined): string {
  if (!rate || !Number.isFinite(rate)) return 'awaiting a rate';
  return (1 / rate).toFixed(4);
}

/** "1 USD = 1.3820 CAD" + inverse "1 CAD = 0.7236 USD". */
export function rateChipStrings(rate: number | null, from: string, to: string) {
  const primary = rate && Number.isFinite(rate) ? `1 ${from} = ${rate.toFixed(4)} ${to}` : `1 ${from} = —.———— ${to}`;
  const inverse = rate && Number.isFinite(rate) ? `1 ${to} = ${(1 / rate).toFixed(4)} ${from}` : 'awaiting a rate';
  return { primary, inverse };
}

/** "at 1.3600 on 2026-08-19" — the rate/date provenance subtext. */
export function rateDateNote(rate: number | null, date: string | null): string {
  if (!rate || !date) return 'enter a rate to calculate';
  return `at ${rate.toFixed(4)} on ${date}`;
}

/** True when a currency renders without decimals in its foreign amount (JPY/INR convention). */
export function isZeroDecimal(ccy: string): boolean {
  return ccy === 'JPY' || ccy === 'INR';
}
