// Pure metadata sanitizer for PlatformAuditEvent (CC-1): drops keys that look
// like secrets/payloads/financial data and truncates long strings.
const SENSITIVE_KEY = /secret|token|password|hash|payload|balance|accountnumber|card/i;
export function sanitizeAuditMetadata(input?: Record<string, unknown> | null): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (SENSITIVE_KEY.test(k)) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return clean;
}
