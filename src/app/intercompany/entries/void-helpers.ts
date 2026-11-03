/**
 * Pure logic behind the Void UI on the inter-company entries page.
 *
 * Kept JSX-free so it is unit-testable in this repo's node-environment jest
 * suite (which has no component/DOM test pattern). VoidInterCompany.tsx is
 * the thin rendering layer over these helpers.
 */

export interface VoidableTransaction {
  id: string;
  reference: string;
  date: string;
  amount: string;
  currency: string;
  status: 'POSTED' | 'VOIDED' | 'UNMATCHED';
  sourceCompanyName: string;
  targetCompanyName: string;
}

/** Only a POSTED pair can be voided; VOIDED/UNMATCHED get no action. */
export function canVoid(status: VoidableTransaction['status']): boolean {
  return status === 'POSTED';
}

export function voidEndpoint(id: string): string {
  return `/api/intercompany/transactions/${id}/void`;
}

function money(n: string): string {
  const v = parseFloat(n);
  if (isNaN(v)) return '0.00';
  return v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatVoidAmount(amount: string, currency: string): string {
  return `${money(amount)} ${currency || 'CAD'}`;
}

/** One-line summary naming everything the confirmation panel must show. */
export function voidConfirmSummary(t: VoidableTransaction): string {
  return `${t.reference} — ${t.sourceCompanyName} → ${t.targetCompanyName}, ${formatVoidAmount(t.amount, t.currency)}, dated ${t.date}. Both companies' entries will be reversed together and the pair marked VOIDED.`;
}

/**
 * POST the void. Throws an Error carrying the server's error message so the
 * caller can show it — never swallowed.
 */
export async function postVoid(id: string): Promise<void> {
  const res = await fetch(voidEndpoint(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let message = 'Failed to void inter-company transaction';
    try {
      const err = await res.json();
      if (err?.error) message = err.error;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
}
