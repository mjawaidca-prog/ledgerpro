export interface LegacyBankTaxInput {
  taxCode?: string | null;
  taxRate?: number | null;
  taxAmount?: number | null;
}

/**
 * P1-D boundary for imported bank rows. Reviewed-tax companies must not send
 * legacy single-rate split data through account 2300 because that loses the
 * component, jurisdiction, recovery, evidence, and reviewer facts required by
 * P1-C. Untaxed rows and every company that has not opted in remain unchanged.
 */
export function assertReviewedBankTaxAdapter(input: {
  reviewedTaxEnabled: boolean;
  row: LegacyBankTaxInput;
  splits?: readonly LegacyBankTaxInput[] | null;
}): void {
  if (!input.reviewedTaxEnabled) return;
  const candidates = [input.row, ...(input.splits ?? [])];
  const hasLegacyTax = candidates.some(item => Boolean(item.taxCode) || Number(item.taxRate ?? 0) !== 0 || Number(item.taxAmount ?? 0) !== 0);
  if (hasLegacyTax) {
    throw new Error(
      'This company uses reviewed Canadian tax. Remove the legacy bank-row tax and create the related bill, expense, or invoice with a reviewed tax code before matching the payment.',
    );
  }
}
