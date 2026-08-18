/**
 * Presentation rounding for consolidated statements.
 *
 * Every cell is rounded to 2 dp (same Math.round(x*100)/100 convention as the
 * single-company report routes), then totals are the sum of the *displayed*
 * parts — so columns visibly add up to the cent. When a server-injected line
 * (e.g. the FX translation reserve) makes a displayed total differ from the
 * sum of its displayed parts, the largest line is adjusted by the residual
 * and a note emitted.
 */

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export interface AdjustmentNote {
  lineName: string;
  residual: number;
}

/**
 * Force a list of (rounded) part values to sum exactly to `target`
 * (already rounded). Adjusts the largest-|value| line deterministically
 * (first max by |value|, then by array order). Returns the parts and a note
 * when an adjustment was made.
 */
export function reconcileRoundedParts(parts: number[], target: number): { parts: number[]; note: AdjustmentNote | null } {
  const sum = round2(parts.reduce((s, p) => s + p, 0));
  const residual = round2(target - sum);
  if (Math.abs(residual) < 0.005) return { parts, note: null };

  // Adjust the largest line so the column ties.
  let idx = 0;
  for (let i = 1; i < parts.length; i++) {
    if (Math.abs(parts[i]) > Math.abs(parts[idx])) idx = i;
  }
  const adjusted = [...parts];
  adjusted[idx] = round2(adjusted[idx] + residual);

  return { parts: adjusted, note: { lineName: '', residual } };
}
