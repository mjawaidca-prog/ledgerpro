/**
 * Industry re-detection — suggestion service (Phase 2 item 5).
 *
 * Wraps the pure engine (src/lib/industry-detect.ts) with the company
 * rules:
 *   - no suggestion when the detected industry IS the set industry
 *     (handled by the engine);
 *   - no suggestion when the user already dismissed THIS industry
 *     (Company.industrySuggestionDismissedKey) — a different detected
 *     industry still surfaces, so fixing the books can re-trigger a
 *     better answer without the old one nagging;
 *   - applying is NOT done here: the dashboard card applies through
 *     the existing PUT /api/companies flow, which stores the industry
 *     and layers the pack idempotently (nothing is ever removed).
 *
 * Compute-on-read: getIndustrySuggestion rebuilds the activity profile
 * from live data on every call, so the first dashboard load after a
 * bank import already reflects the new transactions.
 */

import { db } from './db';
import { detectIndustry, type IndustryDetection } from './industry-detect';
import { buildIndustryActivityProfile, type IndustryDetectDataClient } from './industry-detect-data';
import { industryLabel, normalizeIndustry, type IndustryKey } from './industry-coa';

export interface IndustrySuggestion extends IndustryDetection {
  /** The company's currently-set industry (null = none chosen). */
  currentIndustry: IndustryKey | null;
  currentLabel: string | null;
  /** 0..100, for display. */
  confidencePct: number;
}

/** The slice of the Prisma client this service needs (injectable for tests). */
export interface IndustrySuggestionClient extends IndustryDetectDataClient {
  company: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
}

export async function getIndustrySuggestion(
  companyId: string,
  client: IndustrySuggestionClient = db as unknown as IndustrySuggestionClient,
): Promise<IndustrySuggestion | null> {
  const company = await client.company.findUnique({
    where: { id: companyId },
    select: { industry: true, industrySuggestionDismissedKey: true },
  });
  if (!company) return null;

  const profile = await buildIndustryActivityProfile(companyId, client);
  const detection = detectIndustry(profile, company.industry ?? null);
  if (!detection) return null;

  const dismissed = normalizeIndustry(company.industrySuggestionDismissedKey);
  if (dismissed && dismissed === detection.industry) return null;

  const currentIndustry = normalizeIndustry(company.industry);
  return {
    ...detection,
    currentIndustry,
    currentLabel: currentIndustry ? industryLabel(currentIndustry) : null,
    confidencePct: Math.round(detection.score * 100),
  };
}

/** Remember that the user dismissed the suggestion for this industry. */
export async function dismissIndustrySuggestion(
  companyId: string,
  industry: string,
  client: IndustrySuggestionClient = db as unknown as IndustrySuggestionClient,
): Promise<void> {
  const key = normalizeIndustry(industry);
  if (!key) throw new Error('Unknown industry.');
  await client.company.update({
    where: { id: companyId },
    data: { industrySuggestionDismissedKey: key },
  });
}
