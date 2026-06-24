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

export function moneyCompact(n: number): string {
  if (Math.abs(n) >= 1e6) {
    return '$' + (n / 1e6).toFixed(1) + 'M';
  }
  if (Math.abs(n) >= 1e3) {
    return '$' + (n / 1e3).toFixed(0) + 'K';
  }
  return money(n);
}
