/**
 * CSV export utility — generates and downloads CSV files from any data array.
 * All money values are wrapped in Number() to handle Prisma Decimal objects.
 */

function fmt(val: any): string {
  if (val === null || val === undefined) return '';
  return Number(val).toFixed(2);
}

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
  const rows = data.rows.map((r: any) => [r.code, r.name, r.type, fmt(r.debit), fmt(r.credit)]);
  rows.push(['', 'TOTALS', '', fmt(data.totalDebits), fmt(data.totalCredits)]);
  downloadCSV(`trial-balance-${data.asOf}.csv`, headers, rows);
}

export function exportGL(data: any): void {
  const headers = ['Date', 'Description', 'Source', 'Debit', 'Credit', 'Balance'];
  const rows = data.rows.map((r: any) => [
    new Date(r.date).toLocaleDateString(),
    r.description,
    r.sourceType + (r.sourceId ? ' ' + r.sourceId : ''),
    r.debit > 0 ? fmt(r.debit) : '',
    r.credit > 0 ? fmt(r.credit) : '',
    fmt(r.balance),
  ]);
  downloadCSV(`general-ledger-${data.account?.code || 'all'}.csv`, headers, rows);
}

export function exportReport(data: any[], filename: string, headers: string[], mapFn: (row: any) => string[]): void {
  const rows = data.map(mapFn);
  downloadCSV(filename, headers, rows);
}

// ─── Entity-specific export functions ───

export function exportInvoices(invoices: any[]): void {
  const headers = ['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Status', 'Subtotal', 'Tax', 'Total', 'Paid'];
  const rows = invoices.map((i: any) => [
    i.id, i.customer?.name || i.customer?.companyName || '',
    new Date(i.issueDate).toLocaleDateString(),
    new Date(i.dueDate).toLocaleDateString(),
    i.status, fmt(i.subtotal), fmt(i.taxAmount), fmt(i.total), fmt(i.paidAmount),
  ]);
  downloadCSV(`invoices-export.csv`, headers, rows);
}

export function exportBills(bills: any[]): void {
  const headers = ['Bill #', 'Vendor', 'Date', 'Due Date', 'Status', 'Total', 'Paid'];
  const rows = bills.map((b: any) => [
    b.id, b.vendor?.name || '', new Date(b.billDate).toLocaleDateString(),
    b.dueDate ? new Date(b.dueDate).toLocaleDateString() : '', b.status, fmt(b.total), fmt(b.paidAmount),
  ]);
  downloadCSV(`bills-export.csv`, headers, rows);
}

export function exportContacts(contacts: any[]): void {
  const headers = ['Name', 'Company', 'Type', 'Email', 'Phone', 'Status', 'Outstanding'];
  const rows = contacts.map((c: any) => [
    c.name, c.companyName || '', c.type, c.email || '', c.phone || '', c.status, fmt(c.outstandingBalance),
  ]);
  downloadCSV(`contacts-export.csv`, headers, rows);
}

export function exportTransactions(transactions: any[]): void {
  const headers = ['Date', 'Description', 'Merchant', 'Amount', 'Category', 'Status', 'Account'];
  const rows = transactions.map((t: any) => [
    new Date(t.date).toLocaleDateString(), t.description, t.merchant || '',
    fmt(t.amount), t.category?.name || '', t.status, t.account?.name || '',
  ]);
  downloadCSV(`transactions-export.csv`, headers, rows);
}

export function exportChartOfAccounts(accounts: any[]): void {
  const headers = ['Code', 'Name', 'Type', 'Detail Type', 'Balance', 'Active'];
  const rows = accounts.map((a: any) => [
    a.code, a.name, a.type, a.detailType || '', fmt(a.balance), a.active ? 'Yes' : 'No',
  ]);
  downloadCSV(`chart-of-accounts.csv`, headers, rows);
}
