/**
  Currency formatter matching LP.money() from app-core.js.
  Uses en-US for the prototype's dollar formatting.
 */
export function money(n: number, sign = false): string {
  const prefix =
    sign && n > 0 ? '+' :
    sign && n < 0 ? '−' : '';
  return (
    prefix +
    '$' +
    Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Signed currency format. money() intentionally renders absolute values
 * (it matches the legacy LP.money() used for amounts that are unsigned by
 * construction), but financial-statement LINES must carry their sign: a
 * credit-balance asset or a debit-balance liability is a negative amount,
 * and rendering it positive makes the printed lines stop footing to the
 * (signed) totals — Phase 0.1, found live on Muja's balance sheet where
 * Suspense Deposits −$19,932.50 printed as +$19,932.50. Use moneySigned
 * anywhere a value is one term of a signed sum (balance sheet, COA summary).
 */
export function moneySigned(n: number): string {
  return (n < 0 ? '−' : '') + money(n);
}

export function moneyCompact(n: number): string {
  if (Math.abs(n) >= 1e6) {
    return '$' + (n / 1e6).toFixed(1) + 'M';
  }
  if (Math.abs(n) >= 1e3) {
    return '$' + (n / 1e3).toFixed(0) + 'K';
  }
  return money(n);
}
