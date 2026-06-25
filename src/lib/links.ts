/**
 * Drill-down link resolver — every number in LedgerPro is clickable.
 * Generates URLs to source documents, filtered views, and detail pages.
 */

export function glLink(accountCode: string, accountName?: string): string {
  const params = new URLSearchParams({ code: accountCode });
  if (accountName) params.set('name', accountName);
  return `/reports/general-ledger?${params.toString()}`;
}

export function invoiceLink(id: string): string {
  return `/invoices/${id}`;
}

export function billLink(id: string): string {
  return `/expenses/${id}`;
}

export function transactionLink(id: string): string {
  return `/banking/transactions/${id}`;
}

export function contactLink(id: string): string {
  return `/contacts?id=${id}`;
}

export function bankTransactionsLink(accountId: string, accountName?: string): string {
  const params = new URLSearchParams({ account: accountId });
  if (accountName) params.set('name', accountName);
  return `/banking?${params.toString()}`;
}

export function filteredInvoicesLink(status?: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  return `/invoices${params.toString() ? `?${params.toString()}` : ''}`;
}

export function filteredExpensesLink(status?: string): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  return `/expenses${params.toString() ? `?${params.toString()}` : ''}`;
}
