/**
 * Phase 1 cleanup — FILED-PERIOD HARD LOCK (simple path).
 *
 * Once a GST/HST period has a TaxReturnWorkpaper in `filed_recorded`
 * status, any posting dated inside that period that would change the
 * filed figures is REJECTED (409, code `filed_period_locked`). There is
 * no override in this bundle.
 *
 * "Would change the filed figures" is deliberately narrow and mechanical:
 *   - a line posts to one of the company's resolved simple-path tax
 *     accounts (GST/HST output, GST/HST recoverable/ITC, PST/RST payable,
 *     QST output, QST recoverable — config mappings win over the default
 *     codes, see simple.ts), OR
 *   - a line carries a simple-path tax split/spec (a manual journal tax
 *     tag, or a bank split with a province / rate tax treatment), because
 *     posting it EXPANDS into lines on those tax accounts.
 * A posting inside a filed period that touches neither is allowed: it
 * cannot move lines 101/103/106/109 of the filed return.
 *
 * Enforcement lives at the shared service layer, not per screen:
 *   - manual journals: POST /api/journal, PUT + DELETE (void) +
 *     bulk DELETE in /api/journal/[id] and /api/journal;
 *   - bank postings: postBankRow in src/lib/banking/posting.ts (covers
 *     the categorize / post / split routes, and categorization-rule
 *     postings — rules only stamp splits on the transaction, the actual
 *     posting still flows through postBankRow) and the legacy batch
 *     post-gl route, which posts category lines directly.
 * Known bypasses (documented, out of scope for this bundle): the
 * reviewed tax engine (posting-service.ts) and the simple invoice/bill
 * document postings in lib/journal.ts (postInvoiceToLedger /
 * postBillToLedger hardcode account 2300) — both can hit tax accounts
 * without passing through the paths above.
 */
import { db } from '@/lib/db';
import { resolveSimpleTaxAccounts, type ResolvedTaxAccounts } from './simple';

export interface FiledGstPeriod {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  filedAt: Date | null;
  filingConfirmation: string | null;
}

export class FiledPeriodLockedError extends Error {
  readonly code = 'filed_period_locked';
  readonly status = 409;
  constructor(public readonly period: FiledGstPeriod) {
    super(
      `Period locked — GST/HST return for ${ymd(period.periodStart)} to ${ymd(period.periodEnd)} was filed on ` +
        `${period.filedAt ? ymd(period.filedAt) : 'an unrecorded date'} (confirmation ${period.filingConfirmation ?? '—'}). ` +
        `Postings that would change the filed figures are blocked.`,
    );
    this.name = 'FiledPeriodLockedError';
  }
}

export function isFiledPeriodLockedError(e: unknown): e is FiledPeriodLockedError {
  return e instanceof FiledPeriodLockedError || (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'filed_period_locked');
}

const ymd = (d: Date | string): string => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** All GST/HST periods recorded as filed for the company (any registration). */
export async function findFiledGstPeriods(companyId: string, client: any = db): Promise<FiledGstPeriod[]> {
  if (typeof client?.taxReturnWorkpaper?.findMany !== 'function') return [];
  const rows = await client.taxReturnWorkpaper.findMany({
    where: { companyId, regime: 'gst_hst', status: 'filed_recorded' },
    select: { id: true, periodStart: true, periodEnd: true, filedAt: true, filingConfirmation: true },
    orderBy: [{ periodStart: 'asc' }, { version: 'desc' }],
  });
  return rows.map((r: any) => ({
    id: r.id,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    filedAt: r.filedAt ?? null,
    filingConfirmation: r.filingConfirmation ?? null,
  }));
}

/** The filed period covering `date` (by calendar day), or null. */
export function filedPeriodCovering(periods: FiledGstPeriod[], date: Date | string): FiledGstPeriod | null {
  const day = ymd(date);
  return periods.find((p) => ymd(p.periodStart) <= day && day <= ymd(p.periodEnd)) ?? null;
}

/**
 * Resolve the company's simple-path tax account codes through an
 * injectable client (defaults to the app db). Config mappings win;
 * when the client cannot answer (unit-test stubs), the pure defaults
 * from resolveSimpleTaxAccounts apply.
 */
export async function loadResolvedTaxCodes(companyId: string, client: any = db): Promise<Set<string>> {
  let configuration: unknown = null;
  if (typeof client?.companyTaxConfiguration?.findUnique === 'function') {
    configuration = await client.companyTaxConfiguration.findUnique({
      where: { companyId },
      include: {
        gstHstOutputAccount: { select: { code: true } },
        gstHstRecoverableAccount: { select: { code: true } },
        pstRstPayableAccount: { select: { code: true } },
        qstOutputAccount: { select: { code: true } },
        qstRecoverableAccount: { select: { code: true } },
      },
    }).catch(() => null);
  }
  const resolved: ResolvedTaxAccounts = resolveSimpleTaxAccounts({ configuration: configuration as never });
  return new Set([resolved.output, resolved.recoverable, resolved.pstPayable, resolved.qstOutput, resolved.qstRecoverable].filter(Boolean));
}

export interface FiledLockLine {
  accountCode?: string | null;
  glAccountCode?: string | null;
  /** True when the line carries a simple-path tax split/spec that posting would expand onto a tax account. */
  hasTaxSpec?: boolean;
  tax?: unknown;
  taxProvince?: string | null;
  taxRate?: number | null;
}

export function lineAffectsTax(line: FiledLockLine, resolvedTaxCodes: ReadonlySet<string>): boolean {
  const code = line.accountCode ?? line.glAccountCode ?? null;
  if (code && resolvedTaxCodes.has(code)) return true;
  if (line.hasTaxSpec) return true;
  if (line.tax != null) return true;
  if (line.taxProvince) return true;
  if (line.taxRate != null && Number(line.taxRate) !== 0) return true;
  return false;
}

export function linesAffectTax(lines: FiledLockLine[], resolvedTaxCodes: ReadonlySet<string>): boolean {
  return lines.some((l) => lineAffectsTax(l, resolvedTaxCodes));
}

/**
 * Throw FiledPeriodLockedError (409) when `date` falls inside a filed
 * GST/HST period AND any of `lines` would change the filed figures.
 * Returns the covering filed period when the date is inside one but the
 * lines are tax-neutral (posting allowed), otherwise null.
 *
 * For EDITS, callers must invoke this for BOTH the stored entry (its
 * date + stored lines, which already include any tax-expansion lines)
 * and the replacement (new date + new lines incl. tax specs).
 */
export async function assertNoFiledLock(
  input: {
    companyId: string;
    date: Date | string;
    lines: FiledLockLine[];
    resolvedTaxCodes?: ReadonlySet<string> | Iterable<string>;
  },
  client: any = db,
): Promise<FiledGstPeriod | null> {
  const resolved = input.resolvedTaxCodes ? new Set(input.resolvedTaxCodes) : await loadResolvedTaxCodes(input.companyId, client);
  if (!linesAffectTax(input.lines, resolved)) return null;
  const periods = await findFiledGstPeriods(input.companyId, client);
  const hit = filedPeriodCovering(periods, input.date);
  if (hit) throw new FiledPeriodLockedError(hit);
  return null;
}

/** Non-throwing probe for read/report paths (e.g. the GST/HST return). */
export async function findFiledLockForDate(
  input: { companyId: string; date: Date | string; lines: FiledLockLine[]; resolvedTaxCodes?: ReadonlySet<string> | Iterable<string> },
  client: any = db,
): Promise<FiledGstPeriod | null> {
  const resolved = input.resolvedTaxCodes ? new Set(input.resolvedTaxCodes) : await loadResolvedTaxCodes(input.companyId, client);
  if (!linesAffectTax(input.lines, resolved)) return null;
  const periods = await findFiledGstPeriods(input.companyId, client);
  return filedPeriodCovering(periods, input.date);
}
