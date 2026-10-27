/**
 * Nexvar Pay's payroll sync identifies its journal creates with an
 * Idempotency-Key of the form "nexvarpay-payrun-<payRunId>". Journals
 * created under such a key are stamped with the 'payroll' journal source
 * so they read as "Payroll \u2014 Nexvar Pay" in the books instead of
 * anonymous manual entries. Every other API create stays 'manual'.
 */
export function journalSourceForIdempotencyKey(
  key: string | null | undefined
): 'payroll' | 'manual' {
  return key != null && key.startsWith('nexvarpay-') ? 'payroll' : 'manual';
}
