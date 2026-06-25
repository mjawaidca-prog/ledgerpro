/**
 * CSV export utility — generates and downloads CSV files from any data array.
 */

export function downloadCSV(filename: string, headers: string[], rows: string[][]): void {
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTrialBalance(data: any): void {
  const headers = ['Code', 'Account', 'Type', 'Debit', 'Credit'];
  const rows = data.rows.map((r: any) => [r.code, r.name, r.type, r.debit.toFixed(2), r.credit.toFixed(2)]);
  rows.push(['', 'TOTALS', '', data.totalDebits.toFixed(2), data.totalCredits.toFixed(2)]);
  downloadCSV(`trial-balance-${data.asOf}.csv`, headers, rows);
}

export function exportGL(data: any): void {
  const headers = ['Date', 'Description', 'Source', 'Debit', 'Credit', 'Balance'];
  const rows = data.rows.map((r: any) => [
    new Date(r.date).toLocaleDateString(),
    r.description,
    r.sourceType + (r.sourceId ? ' ' + r.sourceId : ''),
    r.debit > 0 ? r.debit.toFixed(2) : '',
    r.credit > 0 ? r.credit.toFixed(2) : '',
    r.balance.toFixed(2),
  ]);
  downloadCSV(`general-ledger-${data.account?.code || 'all'}.csv`, headers, rows);
}

export function exportReport(data: any[], filename: string, headers: string[], mapFn: (row: any) => string[]): void {
  const rows = data.map(mapFn);
  downloadCSV(filename, headers, rows);
}
