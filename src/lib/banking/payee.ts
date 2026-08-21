/**
 * Payee guessing from raw statement descriptions — pure functions.
 *
 * Strips leading transaction tokens (E-TRANSFER RECEIVED, POS DEBIT, …) and
 * trailing noise (#card numbers, locale fragments like "CALGARY AB"), then
 * title-cases the remainder. Known bank/rule patterns (MONTHLY PLAN FEE,
 * PAYROLL DEPOSIT) return null — those are rule-categorized, not payees.
 */

const LEADING_TOKENS = [
  'E-TRANSFER RECEIVED',
  'E-TRANSFER SENT',
  'E-TRANSFER',
  'POS DEBIT',
  'POS PURCHASE',
  'PREAUTHORIZED DEBIT',
  'PRE-AUTHORIZED DEBIT',
  'BILL PAYMENT',
  'PAYROLL DEPOSIT',
  'WITHDRAWAL',
  'INTERAC PURCHASE',
  'INTERAC E-TRANSFER',
  'DIRECT DEPOSIT',
  'ONLINE TRANSFER',
];

// Descriptions where the payee is "the bank itself" or a clearing account —
// rules handle these, never a contact match.
const NON_PAYEE_PATTERNS = [
  /^MONTHLY PLAN FEE$/i,
  /^PAYROLL DEPOSIT/i,
  /^MONTHLY ACCOUNT FEE$/i,
  /^SERVICE CHARGE$/i,
  /^INTEREST PAYMENT$/i,
  /^NSF CHARGE$/i,
  /^WITHDRAWAL$/i,
  /^DEPOSIT$/i,
];

export function guessPayee(description: string): string | null {
  const raw = description.trim();
  if (!raw) return null;

  for (const pattern of NON_PAYEE_PATTERNS) {
    if (pattern.test(raw)) return null;
  }

  let cleaned = raw.toUpperCase().replace(/\s+/g, ' ').trim();

  // Strip leading tokens repeatedly ("E-TRANSFER RECEIVED BRIGHTLINE STU").
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of LEADING_TOKENS) {
      if (cleaned === token) return null; // nothing left after the token
      if (cleaned.startsWith(token + ' ')) {
        cleaned = cleaned.slice(token.length + 1).trim();
        changed = true;
        break;
      }
    }
  }

  // Strip trailing noise: everything from a card number onward ("#4412
  // CALGARY AB" → keep the name), cheque numbers, province fragments.
  cleaned = cleaned
    .replace(/\s+#\d.*$/, '') // card/ref number and anything after it
    .replace(/\s+\d{4,}$/, '') // trailing long numbers
    .replace(/\s+(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/, '')
    .replace(/\s*-\s*$/, '')
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  return titleCasePayee(cleaned);
}

export function titleCasePayee(s: string): string {
  // Capitalize after word boundaries AND hyphens: "petro-canada" → "Petro-Canada".
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
}

/** Match a guessed payee against known contacts (case-insensitive contains/prefix). */
export function resolveContact(
  payee: string | null,
  contacts: { id: string; name: string; companyName?: string | null }[]
): { id: string; name: string } | null {
  if (!payee) return null;
  const p = payee.toLowerCase();

  for (const c of contacts) {
    const names = [c.name, c.companyName].filter(Boolean) as string[];
    for (const n of names) {
      const nl = n.toLowerCase();
      if (nl.includes(p) || p.includes(nl) || p.startsWith(nl.split(' ')[0])) {
        return { id: c.id, name: c.companyName || c.name };
      }
    }
  }
  return null;
}
