/**
 * Block B2 — derive the Payroll page's connection state from LedgerPro's own
 * records (no cross-product reads). Nexvar Pay owns the connection settings;
 * LedgerPro can see the API keys created for it and the payroll journals
 * that have actually posted, which is everything this page needs.
 */
export type PayrollConnectionState =
  | 'connected'
  | 'key_ready'
  | 'not_connected'
  | 'no_api_access';

export interface PayrollStatusFacts {
  /** Company-level API switch (Company.apiAccessEnabled). */
  apiAccessEnabled: boolean;
  /** The active subscription's plan includes API access. */
  planApiAccess: boolean;
  /** Non-revoked API keys holding the write_posting scope. */
  activeWriteKeyCount: number;
  /** Original (non-reversal) journals stamped with the payroll source. */
  payrollRunCount: number;
}

export function payrollConnectionState(f: PayrollStatusFacts): PayrollConnectionState {
  // History wins: if runs have posted, the connection demonstrably worked —
  // show that even if API access has since lapsed (the page warns separately).
  if (f.payrollRunCount > 0) return 'connected';
  if (!f.apiAccessEnabled || !f.planApiAccess) return 'no_api_access';
  if (f.activeWriteKeyCount > 0) return 'key_ready';
  return 'not_connected';
}
