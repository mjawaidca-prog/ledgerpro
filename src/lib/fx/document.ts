/**
 * FX block resolution for foreign-currency documents (invoices & bills).
 *
 * The rate is resolved for the document date (manual beats feed), the 10%
 * deviation confirm rule is enforced against the same-date feed rate, and
 * the returned block is FROZEN at post time: totalHome is the Σ of per-line
 * rounded conversions so it always equals the journal's AR/AP debit-credit.
 */

import { resolveRate, deviationPct } from './rate';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class FxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxValidationError';
  }
}

export interface FrozenFxBlock {
  fxRate: number;
  fxRateSource: 'feed' | 'manual';
  fxRateDate: Date;
  totalHome: number;
}

export async function resolveDocumentFx(opts: {
  currency: string;
  homeCurrency: string;
  documentDate: string;
  subtotal: number;
  taxAmount: number;
  suppliedRate?: number | null;
  confirmed?: boolean;
}): Promise<FrozenFxBlock | null> {
  if (opts.currency === opts.homeCurrency) return null;

  const resolved = await resolveRate(opts.currency, opts.homeCurrency, opts.documentDate, 'daily');

  let rate = resolved.rate;
  let source: 'feed' | 'manual' = resolved.source === 'feed' ? 'feed' : 'manual';

  if (opts.suppliedRate) {
    rate = opts.suppliedRate;
    source = 'manual';
    // 10% deviation from the same-date feed requires explicit confirmation —
    // catches the classic 13.82-for-1.382 typo.
    if (resolved.feedRate && !opts.confirmed && deviationPct(rate, resolved.feedRate) > 10) {
      throw new FxValidationError(
        `The rate you entered (${rate}) is more than 10% away from the Bank of Canada rate (${resolved.feedRate.toFixed(4)}). Confirm the rate before saving.`
      );
    }
  }

  if (!rate) {
    throw new FxValidationError(
      'Enter a rate to continue. The invoice cannot be sent without one — the home-currency amount would be a guess.'
    );
  }

  const totalHome = round2(
    round2(opts.subtotal * rate) + (opts.taxAmount > 0 ? round2(opts.taxAmount * rate) : 0)
  );

  return { fxRate: rate, fxRateSource: source, fxRateDate: new Date(opts.documentDate), totalHome };
}
