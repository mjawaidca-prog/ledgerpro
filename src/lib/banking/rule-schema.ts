import { z } from 'zod';

export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** Phase 1 tax fields shared by the categorization-rule create/patch schemas. */
export const taxFieldsSchema = z.object({
  taxEnabled: z.boolean().default(false),
  taxProvince: z.enum(PROVINCES).nullable().optional(),
  taxInclusive: z.boolean().default(true),
  taxRecoverable: z.boolean().default(true),
});
