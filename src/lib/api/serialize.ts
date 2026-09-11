// Public API (v1) serialization rules. Financial values are decimal STRINGS
// with explicit currency so JSON consumers never lose precision to floats —
// a JSON number like 0.1+0.2 is exactly the failure mode this avoids.

/** Prisma Decimal | number | string | null → "1234.56" (never an exponent, never NaN). */
export function moneyString(value: unknown, dp = 2): string {
  if (value === null || value === undefined) return (0).toFixed(dp);
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(dp);
  return n.toFixed(dp);
}

/** Decimal → plain number, rounded to cents, for report math. */
export function moneyNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** ISO-8601 date/time string, or null for empty values. */
export function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

/**
 * The report metadata envelope required on every /api/v1 report response:
 * reporting period, accounting basis and generation time travel with the
 * numbers so a consumer can never mislabel them.
 */
export function reportMeta(opts: {
  periodLabel: string;
  from?: Date;
  to: Date;
  currency: string;
}): {
  reportingPeriod: string;
  periodStart: string | null;
  periodEnd: string;
  accountingBasis: 'accrual';
  generatedAt: string;
  currency: string;
} {
  return {
    reportingPeriod: opts.periodLabel,
    periodStart: opts.from ? opts.from.toISOString() : null,
    periodEnd: opts.to.toISOString(),
    accountingBasis: 'accrual',
    generatedAt: new Date().toISOString(),
    currency: opts.currency,
  };
}
