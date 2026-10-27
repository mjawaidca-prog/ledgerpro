/**
 * Phase 1: tax expansion for MANUAL journal lines.
 *
 * A manual journal line may carry a tax spec ({ province, recoverable? }).
 * Journal amounts are stated GROSS, so expansion is inclusive-only: the
 * line's total never changes, which keeps the entry balanced by
 * construction — a debit expense of $112 in BC becomes Dr expense $107
 * (net + non-recoverable PST) + Dr GST/HST recoverable $5; a credit revenue
 * of $105 in AB becomes Cr revenue $100 + Cr GST/HST payable $5.
 * Exclusive specs are rejected loudly rather than silently unbalancing
 * the entry. All math delegates to the engine via simple.ts.
 */
import { computeSimpleLineTax, type ResolvedTaxAccounts } from './simple';
import { round2 } from '@/lib/banking/splits';
import type { Province } from '@/lib/taxes';

export interface JournalTaxSpec {
  province: Province;
  priceMode?: 'inclusive' | 'exclusive';
  recoverable?: boolean;
  /**
   * Fractional recovery 0–100 for purchase (debit) lines. When present it
   * wins over `recoverable` (see SimpleTaxSpec.recoveryPercent); validated
   * 0–100 by computeSimpleLineTax, whose error the journal API returns as
   * a 400.
   */
  recoveryPercent?: number | null;
}

export interface JournalLineWithTax {
  glAccountCode: string;
  description?: string;
  debit: number;
  credit: number;
  tax?: JournalTaxSpec | null;
}

export function expandJournalTaxLines(
  lines: JournalLineWithTax[],
  taxAccounts: ResolvedTaxAccounts,
  date?: Date | string,
): { glAccountCode: string; description?: string; debit: number; credit: number }[] {
  const out: { glAccountCode: string; description?: string; debit: number; credit: number }[] = [];
  for (const line of lines) {
    if (!line.tax) {
      out.push({ glAccountCode: line.glAccountCode, description: line.description, debit: line.debit || 0, credit: line.credit || 0 });
      continue;
    }
    if (line.tax.priceMode && line.tax.priceMode !== 'inclusive') {
      throw new Error('Manual journal tax is inclusive-only: enter the gross (tax-included) amount on the line.');
    }
    const debit = line.debit || 0;
    const credit = line.credit || 0;
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error('A tax-tagged journal line must have exactly one of debit or credit.');
    }
    const isDebit = debit > 0;
    const amount = isDebit ? debit : credit;
    const r = computeSimpleLineTax(amount, {
      province: line.tax.province,
      priceMode: 'inclusive',
      direction: isDebit ? 'purchase' : 'sale',
      recoverable: line.tax.recoverable ?? true,
      recoveryPercent: line.tax.recoveryPercent ?? undefined,
      date,
    });
    const desc = line.description;
    if (isDebit) {
      const own = round2(r.net + r.nonrecoverableTax);
      if (own > 0) out.push({ glAccountCode: line.glAccountCode, description: desc, debit: own, credit: 0 });
      if (r.recoverableTax > 0) {
        // Split recoverable by component kind so QST ITRs land in the QST account.
        for (const comp of r.components) {
          if (comp.recoverable <= 0) continue;
          const acct = comp.kind === 'QST' ? taxAccounts.qstRecoverable : taxAccounts.recoverable;
          out.push({ glAccountCode: acct, description: `${comp.kind} recoverable on ${desc ?? line.glAccountCode}`, debit: comp.recoverable, credit: 0 });
        }
      }
    } else {
      if (r.net > 0) out.push({ glAccountCode: line.glAccountCode, description: desc, debit: 0, credit: r.net });
      if (r.outputGstHst > 0) out.push({ glAccountCode: taxAccounts.output, description: `GST/HST on ${desc ?? line.glAccountCode}`, debit: 0, credit: r.outputGstHst });
      if (r.outputPstRst > 0) out.push({ glAccountCode: taxAccounts.pstPayable, description: `PST/RST on ${desc ?? line.glAccountCode}`, debit: 0, credit: r.outputPstRst });
      if (r.outputQst > 0) out.push({ glAccountCode: taxAccounts.qstOutput, description: `QST on ${desc ?? line.glAccountCode}`, debit: 0, credit: r.outputQst });
    }
  }
  return out;
}
