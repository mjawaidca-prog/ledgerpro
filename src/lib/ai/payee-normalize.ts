/**
 * Payee normalization for AI categorization memory matching (Phase 2 item 1).
 *
 * `guessPayee` (banking/payee) produces a *display* payee from a statement
 * description. Memory matching needs something stricter: a stable key where
 * "PETRO-CANADA #4412 CALGARY AB", "Petro Canada 0391" and "SQ *PETRO CANADA"
 * all collapse to the same payee, so a company's own history can be counted
 * per payee. Pure functions, no DB.
 *
 * What gets stripped beyond guessPayee:
 *  - processor prefixes: "SQ *", "TST*", "PAYPAL *", "AMZN MKTP*", "DD *"
 *  - store numbers: "#4412", "STORE 0391", trailing long digit runs
 *  - trailing corporate suffixes (INC / LTD / CORP / LLC / ULC) so
 *    "ACME INC" and "ACME" share one history
 * Keys are UPPERCASE, punctuation collapsed to single spaces.
 */

import { guessPayee, titleCasePayee } from '@/lib/banking/payee';

// Card-processor / aggregator prefixes that precede the real merchant name.
const PROCESSOR_PREFIXES = [
  /^SQ\s*\*\s*/i,
  /^TST\s*\*\s*/i,
  /^PAYPAL\s*\*\s*/i,
  /^PP\s*\*\s*/i,
  /^AMZN\s+MKTP\s*\*\s*/i,
  /^AMZN\s*\*\s*/i,
  /^DD\s*\*\s*/i,
  /^SP\s*\*\s*/i,
  /^CKE\s*\*\s*/i,
];

const CORPORATE_SUFFIXES = new Set(['INC', 'LTD', 'CORP', 'LLC', 'ULC', 'LP', 'CO']);

/**
 * Normalize a display payee (or an already-guessed payee) into a matching
 * key. Returns null when nothing usable remains.
 */
export function normalizePayeeName(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = name.toUpperCase().trim();
  if (!s) return null;

  for (const prefix of PROCESSOR_PREFIXES) {
    s = s.replace(prefix, '');
  }

  s = s
    .replace(/#\d+/g, ' ') // "#4412" card/store refs anywhere
    .replace(/\bSTORE\s*\d+\b/g, ' ') // "STORE 0391"
    .replace(/[^A-Z0-9&']+/g, ' ') // punctuation → single spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Trailing pure-number tokens are store/location ids, not name.
  s = s.replace(/(\s+\d{2,})+$/, '').trim();
  // A bare trailing "STORE" (its number already stripped) is noise too.
  s = s.replace(/\s+STORE$/, '').trim();

  // Trailing corporate suffixes merge variants of the same business.
  const tokens = s.split(' ').filter(Boolean);
  while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  s = tokens.join(' ');

  if (!s || s.length < 2) return null;
  return s;
}

/**
 * The memory key for a statement row: normalize the guessed payee when one
 * exists, otherwise normalize the raw description directly (guessPayee
 * returns null for bank-fee style rows, whose descriptions ARE the payee
 * for history purposes — "MONTHLY PLAN FEE" is a perfectly good key).
 */
export function payeeKeyFor(description: string, payeeGuess?: string | null): string | null {
  const fromGuess = normalizePayeeName(payeeGuess ?? guessPayee(description));
  if (fromGuess) return fromGuess;
  return normalizePayeeName(description);
}

/** Human-readable payee for reason strings ("Petro-Canada", "Shell"). */
export function payeeDisplayName(payeeKey: string, payeeGuess?: string | null): string {
  if (payeeGuess && normalizePayeeName(payeeGuess) === payeeKey) return payeeGuess;
  return titleCasePayee(payeeKey.toLowerCase());
}
