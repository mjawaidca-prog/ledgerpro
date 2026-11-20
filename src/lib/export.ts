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

const TB_TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

/**
 * Flatten a trial-balance payload into one row list. The reports API
 * returns rows grouped by type under `sections` (with the as-of date at
 * `period.asOf`); the legacy flat `rows`/`asOf` shape is still accepted
 * so older callers keep working.
 */
function flattenTrialBalanceRows(data: any): any[] {
  if (Array.isArray(data?.rows)) return data.rows;
  const sections = data?.sections || {};
  const orderedTypes = [
    ...TB_TYPE_ORDER.filter((t) => sections[t]),
    ...Object.keys(sections).filter((t) => !TB_TYPE_ORDER.includes(t)),
  ];
  const flat: any[] = [];
  for (const type of orderedTypes) {
    for (const r of sections[type]?.rows || []) flat.push(r);
  }
  return flat;
}

function trialBalanceAsOf(data: any): string {
  return data?.period?.asOf ?? data?.asOf ?? '';
}

export function exportTrialBalance(data: any): void {
  const headers = ['Code', 'Account', 'Type', 'Debit', 'Credit'];
  const rows = flattenTrialBalanceRows(data).map((r: any) => [r.code, r.name, r.type, fmt(r.debit), fmt(r.credit)]);
  rows.push(['', 'TOTALS', '', fmt(data.totalDebits), fmt(data.totalCredits)]);
  downloadCSV(`trial-balance-${trialBalanceAsOf(data)}.csv`, headers, rows);
}

/**
 * CaseWare-compatible trial balance export: Account Number, Description, GIFI
 * Code, Type, and current/prior year Debit & Credit columns — the layout
 * CaseWare Working Papers' Trial Balance Import wizard expects. Accounts
 * without a GIFI code export with a blank cell rather than blocking the
 * export, since the accountant may map GIFI codes inside CaseWare itself.
 */
export function exportCaseWareTrialBalance(data: any): void {
  // The reports API folds prior-period figures into each row
  // (priorDebit/priorCredit) whenever a comparison mode is active; the
  // legacy shape carried them in a separate `prior` payload instead.
  const hasPrior = !!data.prior || (!!data.comparisonMode && data.comparisonMode !== 'none');
  const headers = ['Account Number', 'Description', 'GIFI Code', 'Type', 'Debit', 'Credit'];
  if (hasPrior) headers.push('Prior Year Debit', 'Prior Year Credit');

  const priorByCode = new Map((data.prior?.rows || []).map((r: any) => [r.code, r]));

  const rows = flattenTrialBalanceRows(data).map((r: any) => {
    const row = [r.code, r.name, r.gifiCode || '', r.type, fmt(r.debit), fmt(r.credit)];
    if (hasPrior) {
      const p: any = priorByCode.get(r.code);
      row.push(fmt(p?.debit ?? r.priorDebit ?? 0), fmt(p?.credit ?? r.priorCredit ?? 0));
    }
    return row;
  });

  const totalsRow = ['', 'TOTALS', '', '', fmt(data.totalDebits), fmt(data.totalCredits)];
  if (hasPrior) {
    let priorTotalDebits = data.prior?.totalDebits;
    let priorTotalCredits = data.prior?.totalCredits;
    if (priorTotalDebits === undefined || priorTotalCredits === undefined) {
      priorTotalDebits = 0;
      priorTotalCredits = 0;
      for (const section of Object.values<any>(data.sections || {})) {
        priorTotalDebits += Number(section?.priorTotalDebit ?? 0);
        priorTotalCredits += Number(section?.priorTotalCredit ?? 0);
      }
    }
    totalsRow.push(fmt(priorTotalDebits), fmt(priorTotalCredits));
  }
  rows.push(totalsRow);

  downloadCSV(`caseware-trial-balance-${trialBalanceAsOf(data)}.csv`, headers, rows);
}

/**
 * Balance Sheet CSV export: the same sections, subtotals and totals as
 * the on-screen statement (Assets / Liabilities / Equity), one account
 * per row with current and prior-period balances.
 */
export function exportBalanceSheet(data: any): void {
  const headers = ['Section', 'Code', 'Account', 'Balance', 'Prior Balance'];
  const rows: string[][] = [];

  const pushAccounts = (section: string, accounts: any[]) => {
    for (const a of accounts || []) rows.push([section, a.code, a.name, fmt(a.balance), fmt(a.priorBalance ?? 0)]);
  };
  const pushTotal = (label: string, total: any, priorTotal: any) => {
    rows.push([label, '', '', fmt(total), fmt(priorTotal ?? 0)]);
  };

  const s = data.sections || {};
  rows.push(['ASSETS', '', '', '', '']);
  pushAccounts('Current Assets', s.assets?.current?.accounts);
  pushTotal('Total Current Assets', s.assets?.current?.total, s.assets?.current?.priorTotal);
  pushAccounts('Non-Current Assets', s.assets?.nonCurrent?.accounts);
  pushTotal('Total Non-Current Assets', s.assets?.nonCurrent?.total, s.assets?.nonCurrent?.priorTotal);
  pushTotal('Total Assets', s.assets?.total, s.assets?.priorTotal);
  rows.push(['', '', '', '', '']);

  rows.push(['LIABILITIES', '', '', '', '']);
  pushAccounts('Current Liabilities', s.liabilities?.current?.accounts);
  pushTotal('Total Current Liabilities', s.liabilities?.current?.total, s.liabilities?.current?.priorTotal);
  pushAccounts('Non-Current Liabilities', s.liabilities?.nonCurrent?.accounts);
  pushTotal('Total Non-Current Liabilities', s.liabilities?.nonCurrent?.total, s.liabilities?.nonCurrent?.priorTotal);
  pushTotal('Total Liabilities', s.liabilities?.total, s.liabilities?.priorTotal);
  rows.push(['', '', '', '', '']);

  rows.push(['EQUITY', '', '', '', '']);
  for (const [groupKey, group] of Object.entries<any>(s.equity || {})) {
    // Same label the report page renders for each equity bucket key.
    const groupName = groupKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    pushAccounts(groupName, group?.accounts);
    pushTotal(`Total ${groupName}`, group?.total, group?.priorTotal);
  }
  pushTotal('Total Equity', s.totalEquity, s.priorTotalEquity);
  rows.push(['', '', '', '', '']);
  pushTotal('Total Liabilities & Equity', s.totalLiabilitiesAndEquity, s.priorTotalLiabilitiesAndEquity);

  downloadCSV(`balance-sheet-${data.period?.asOf ?? ''}.csv`, headers, rows);
}

/**
 * tb-gifi/1 JSON trial balance for Nexvar Tax. The payload is built
 * server-side (GET /api/reports/trial-balance/tb-gifi) because it needs
 * the company BN, fiscal-year start, period-lock state and the
 * canonical payload hash; this helper fetches it, saves it as the
 * import file, and reports how many accounts went out unmapped
 * (gifiCode: null — they are mapped during import in Nexvar Tax, not
 * dropped). Throws with the server's message when the export cannot
 * be built (e.g. no business number on file).
 */
export async function exportTbGifiTrialBalance(asOf: string): Promise<{ unmappedCount: number; accountCount: number }> {
  const res = await fetch(`/api/reports/trial-balance/tb-gifi?asOf=${asOf}`);
  if (!res.ok) {
    let message = 'Failed to generate the tb-gifi/1 export.';
    try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* keep default */ }
    throw new Error(message);
  }
  const payload = await res.json();

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trial-balance-tb-gifi-${asOf}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  const accounts: any[] = Array.isArray(payload?.accounts) ? payload.accounts : [];
  return {
    unmappedCount: accounts.filter((a) => a.gifiCode === null).length,
    accountCount: accounts.length,
  };
}

export function exportGL(data: any): void {  const headers = ['Date', 'Description', 'Source', 'Debit', 'Credit', 'Balance'];
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

export function exportPandL(data: any, ext: 'csv' | 'xls' = 'csv'): void {
  const sections = data.sections;
  const headers = ['Account', 'Amount', 'Prior Amount', '% Change'];
  const rows: string[][] = [];

  const push = (label: string, amount: number, prior: number, pct: number) => {
    rows.push([label, fmt(amount), prior ? fmt(prior) : '', pct ? `${pct.toFixed(1)}%` : '']);
  };

  // Income
  rows.push(['INCOME', '', '', '']);
  for (const r of sections.income.rows) push(r.name, r.amount, r.priorAmount, r.changePct);
  push('Total Income', sections.income.total, sections.income.priorTotal, sections.income.changePct);
  rows.push(['', '', '', '']);

  // COGS
  if (sections.cogs.rows.length > 0) {
    rows.push(['COST OF GOODS SOLD', '', '', '']);
    for (const r of sections.cogs.rows) push(r.name, r.amount, r.priorAmount, r.changePct);
    push('Total COGS', sections.cogs.total, sections.cogs.priorTotal, sections.cogs.changePct);
    rows.push(['', '', '', '']);
  }

  // Gross profit
  push('GROSS PROFIT', sections.grossProfit.amount, sections.grossProfit.priorAmount, sections.grossProfit.changePct);
  rows.push(['', '', '', '']);

  // Operating expenses
  rows.push(['OPERATING EXPENSES', '', '', '']);
  for (const r of sections.operatingExpenses.rows) push(r.name, r.amount, r.priorAmount, r.changePct);
  push('Total Operating Expenses', sections.operatingExpenses.total, sections.operatingExpenses.priorTotal, sections.operatingExpenses.changePct);
  rows.push(['', '', '', '']);

  // Net income
  push('NET INCOME', sections.netIncome.amount, sections.netIncome.priorAmount, sections.netIncome.changePct);

  const filename = `profit-loss-${data.period?.startDate || 'report'}.${ext}`;
  downloadCSV(filename, headers, rows);
}

/**
 * Export a consolidated (multi-company) report — one column per entity,
 * plus Eliminations and Consolidated. Same figures as the screen.
 */
export function exportConsolidatedReport(data: any, ext: 'csv' | 'xls' = 'csv'): void {
  const entities = data.entities || [];
  const headers = ['Code', 'Account', ...entities.map((e: any) => e.code), 'Eliminations', 'Consolidated'];

  const rows: string[][] = [];

  for (const section of data.sections || []) {
    rows.push([section.label, '', ...entities.map(() => ''), '', '']);
    for (const line of section.lines) {
      rows.push([
        line.code,
        line.name,
        ...entities.map((e: any) => fmt(line.byEntity?.[e.companyId] ?? 0)),
        fmt(line.elimination),
        fmt(line.consolidated),
      ]);
    }
    rows.push([
      `Total ${section.label}`,
      '',
      ...entities.map((e: any) => fmt(section.totals?.byEntity?.[e.companyId] ?? 0)),
      fmt(section.totals?.elimination ?? 0),
      fmt(section.totals?.consolidated ?? 0),
    ]);
    rows.push([]);
  }

  rows.push([
    'Totals',
    '',
    ...entities.map((e: any) => fmt(data.grandTotal?.byEntity?.[e.companyId] ?? 0)),
    fmt(data.grandTotal?.elimination ?? 0),
    fmt(data.grandTotal?.consolidated ?? 0),
  ]);

  const filename = `consolidated-${data.statement || 'report'}-${data.period?.asOf || ''}.${ext}`;
  downloadCSV(filename, headers, rows);
}
