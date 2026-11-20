/**
 * CCA register — request validation for the fixed-asset routes.
 * Kept out of the route files: Next.js route modules may only
 * export route handlers and route config, so the schemas the POST
 * (create) and PATCH (partial update) routes share live here.
 *
 * Cross-field rules (create): AFU cannot precede acquisition; the
 * would-be-Class-53 flag is Class 43 only; the book policy must
 * carry the inputs it needs; and the cost facts must net to a
 * non-negative capital cost. The PATCH route re-checks the merged
 * record itself for the rules that span old and new values.
 */

import { z } from 'zod';
import { toCents } from '@/lib/loans/engine';
import { CCA_CLASS_CODES, ccaClassInfo } from './classes';
import { capitalCostCents } from './engine';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const assetFieldsSchema = z
  .object({
    description: z.string().min(1).max(200),
    serialNumber: z.string().max(120).optional().nullable(),
    vendor: z.string().max(200).optional().nullable(),
    invoiceRef: z.string().max(120).optional().nullable(),
    location: z.string().max(200).optional().nullable(),
    ccaClass: z.enum(CCA_CLASS_CODES as [string, ...string[]]),
    // Cost facts: grossCost is the full invoice cost; capitalCost is
    // derived net of ITCs and assistance — never entered directly.
    grossCost: z.number().min(0),
    itcClaimed: z.number().min(0).default(0),
    governmentAssistance: z.number().min(0).default(0),
    acquisitionDate: ymd,
    availableForUseDate: ymd,
    // AIIP defaults by the acquisition-date rule when omitted.
    aiip: z.boolean().optional(),
    wouldBeClass53: z.boolean().default(false),
    luxuryVehicle: z.boolean().default(false),
    assetAccountCode: z.string().max(20).optional().nullable(),
    accumDepAccountCode: z.string().max(20).optional().nullable(),
    depExpenseAccountCode: z.string().max(20).optional().nullable(),
    bookMethod: z.enum(['mirror_tax', 'straight_line', 'declining_balance', 'none']).default('mirror_tax'),
    bookRatePct: z.number().min(0).max(100).optional().nullable(),
    bookLifeYears: z.number().int().min(1).max(100).optional().nullable(),
    openingAccumDep: z.number().min(0).default(0),
    openingAccumThrough: ymd.optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  });

export const assetCreateSchema = assetFieldsSchema.superRefine((v, ctx) => {
    if (v.availableForUseDate < v.acquisitionDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availableForUseDate'],
        message: 'The available-for-use date cannot be before the acquisition date.',
      });
    }
    if (v.wouldBeClass53 && v.ccaClass !== '43') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['wouldBeClass53'],
        message: 'The would-be-Class-53 flag applies only to Class 43 property.',
      });
    }
    if (v.bookMethod === 'straight_line' && !v.bookLifeYears) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bookLifeYears'],
        message: 'Straight-line book depreciation needs a life in years.',
      });
    }
    if (v.bookMethod === 'declining_balance' && v.bookRatePct == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bookRatePct'],
        message: 'Declining-balance book depreciation needs a rate.',
      });
    }
    const info = ccaClassInfo(v.ccaClass);
    if (v.bookMethod === 'mirror_tax' && info?.method === 'SL' && info.ratePct == null && !v.bookLifeYears) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bookLifeYears'],
        message: `${info.label} depreciates over its life — give the lease/life term in years so the mirror can compute.`,
      });
    }
    try {
      capitalCostCents(toCents(v.grossCost), toCents(v.itcClaimed), toCents(v.governmentAssistance));
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itcClaimed'],
        message: e instanceof Error ? e.message : 'Invalid cost facts',
      });
    }
  });

