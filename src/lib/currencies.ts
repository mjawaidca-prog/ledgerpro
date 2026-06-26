/**
 * Multi-currency support with exchange rates.
 * Base currency is CAD (Canadian Dollar).
 * Exchange rates are indicative — update periodically for accuracy.
 */

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  rateToCAD: number; // 1 unit of this currency = X CAD
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: '$', rateToCAD: 1.0 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', rateToCAD: 1.36 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', rateToCAD: 1.47 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', rateToCAD: 1.72 },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', rateToCAD: 0.90 },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rateToCAD: 0.0091 },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', rateToCAD: 0.19 },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', rateToCAD: 0.016 },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', rateToCAD: 0.078 },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', rateToCAD: 1.52 },
};

export function getCurrency(code: string): CurrencyInfo {
  return CURRENCIES[code] || CURRENCIES['CAD'];
}

export function convertCurrency(amount: number, from: string, to: string): number {
  const fromCur = getCurrency(from);
  const toCur = getCurrency(to);
  const cadAmount = amount * fromCur.rateToCAD;
  return Math.round((cadAmount / toCur.rateToCAD) * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  const cur = getCurrency(currency);
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  let formatted: string;
  if (currency === 'JPY' || currency === 'INR') {
    formatted = `${cur.symbol}${absAmount.toLocaleString('en-US')}`;
  } else if (currency === 'EUR') {
    formatted = `${cur.symbol}${absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else {
    formatted = `${cur.symbol}${absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return isNegative ? `-${formatted}` : formatted;
}
