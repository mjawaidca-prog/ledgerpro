import { z } from 'zod';

export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** Phase 1 tax fields shared by the categorization-rule create/patch schemas. */
export const taxFieldsSchema = z.object({
  taxEnabled: z.boolean().default(false),
  taxProvince: z.enum(PROVINCES).nullable().optional(),
  taxInclusive: z.boolean().default(true),
  taxRecoverable: z.boolean().default(true),
  /**
   * Phase 1 cleanup (partial recovery): fractional recovery 0–100.
   * Nullable — null/absent keeps the boolean `taxRecoverable` semantics;
   * when set it wins over the boolean when the rule's split is posted.
   * Persisted as Decimal(5,2); the API speaks plain numbers.
   */
  taxRecoveryPercent: z.number().min(0).max(100).nullable().optional(),
});
