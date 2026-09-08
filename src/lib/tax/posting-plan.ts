import {
  calculateTaxLine,
  CalculatedTaxComponent,
  TaxComponentDecision,
  TaxKind,
  TaxTreatment,
} from '@/lib/tax/engine';

export type PostingDirection = 'sale' | 'purchase';
export type PostingAuthority = 'cra' | 'revenu_quebec' | 'british_columbia' | 'manitoba' | 'saskatchewan';

export interface PostingComponentDecision extends TaxComponentDecision {
  authority: PostingAuthority;
  recoveryReason?: string;
  recoveryEvidence?: Record<string, unknown>;
  recoveryReviewedById?: string;
}

export interface TaxPostingPlanLineInput {
  sourceLineId: string;
  taxCodeVersionId: string;
  categoryAccountCode: string;
  amountMinor: number;
  priceMode: 'exclusive' | 'inclusive';
  components: readonly PostingComponentDecision[];
}

export interface TaxPostingAccountMappings {
  control: string;
  gstHstOutput?: string;
  gstHstRecoverable?: string;
  qstOutput?: string;
  qstRecoverable?: string;
  pstRstPayable?: string;
}

export interface BuildTaxPostingPlanInput {
  direction: PostingDirection;
  documentCurrency: string;
  homeCurrency: string;
  /** Home units per one document-currency unit, represented as a decimal string. */
  fxRate?: string | null;
  mappings: TaxPostingAccountMappings;
  lines: readonly TaxPostingPlanLineInput[];
}

export interface PlannedTaxComponent extends CalculatedTaxComponent {
  authority: PostingAuthority;
  recoveryReason?: string;
  recoveryEvidence?: Record<string, unknown>;
  recoveryReviewedById?: string;
  taxHomeMinor: number;
  outputTaxHomeMinor: number;
  recoverableHomeMinor: number;
  nonRecoverableHomeMinor: number;
}

export interface PlannedTaxSnapshot {
  sourceLineId: string;
  taxCodeVersionId: string;
  categoryAccountCode: string;
  treatment: TaxTreatment;
  priceMode: 'exclusive' | 'inclusive';
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  netHomeMinor: number;
  taxHomeMinor: number;
  grossHomeMinor: number;
  components: PlannedTaxComponent[];
}

export interface PlannedJournalLine {
  glAccountCode: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  currency?: string;
  fxRate?: string;
  debitForeignMinor?: number;
  creditForeignMinor?: number;
}

export interface TaxPostingPlan {
  snapshots: PlannedTaxSnapshot[];
  journalLines: PlannedJournalLine[];
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  netHomeMinor: number;
  taxHomeMinor: number;
  grossHomeMinor: number;
}

const RATE_SCALE = BigInt(100_000_000);

function checkedMinor(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Home-currency amount exceeds the supported range');
  return number;
}

function parseFxRate(rate: string): bigint {
  if (!/^\d+(?:\.\d{1,8})?$/.test(rate)) throw new Error('FX rate must be a positive decimal with at most 8 places');
  const [whole, fraction = ''] = rate.split('.');
  const scaled = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(8, '0'));
  if (scaled <= BigInt(0)) throw new Error('FX rate must be greater than zero');
  return scaled;
}

/** Exact symmetric half-away-from-zero conversion of signed minor units. */
function convertMinor(amountMinor: number, scaledRate: bigint): number {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Document amount must be signed integer minor units');
  const product = BigInt(amountMinor) * scaledRate;
  const absolute = product < BigInt(0) ? -product : product;
  const rounded = (absolute * BigInt(2) + RATE_SCALE) / (RATE_SCALE * BigInt(2));
  return checkedMinor(product < BigInt(0) ? -rounded : rounded);
}

function mappedAccount(kind: TaxKind, purpose: 'output' | 'recoverable', mappings: TaxPostingAccountMappings): string {
  const account = kind === 'GST' || kind === 'HST'
    ? (purpose === 'output' ? mappings.gstHstOutput : mappings.gstHstRecoverable)
    : kind === 'QST'
      ? (purpose === 'output' ? mappings.qstOutput : mappings.qstRecoverable)
      : purpose === 'output'
        ? mappings.pstRstPayable
        : undefined;
  if (!account) throw new Error(`No ${purpose} GL account is mapped for ${kind}`);
  return account;
}

function signedLine(
  account: string,
  description: string,
  normalSide: 'debit' | 'credit',
  homeMinor: number,
  foreignMinor: number,
  currency: string,
  fxRate: string | undefined,
): PlannedJournalLine | null {
  if (homeMinor === 0 && foreignMinor === 0) return null;
  const positive = homeMinor >= 0;
  const side = positive ? normalSide : normalSide === 'debit' ? 'credit' : 'debit';
  const home = Math.abs(homeMinor);
  const foreign = Math.abs(foreignMinor);
  return {
    glAccountCode: account,
    description,
    debitMinor: side === 'debit' ? home : 0,
    creditMinor: side === 'credit' ? home : 0,
    ...(fxRate ? {
      currency,
      fxRate,
      debitForeignMinor: side === 'debit' ? foreign : 0,
      creditForeignMinor: side === 'credit' ? foreign : 0,
    } : {}),
  };
}

function sum(values: readonly number[]): number {
  return checkedMinor(values.reduce((total, value) => total + BigInt(value), BigInt(0)));
}

export function buildTaxPostingPlan(input: BuildTaxPostingPlanInput): TaxPostingPlan {
  if (input.lines.length === 0) throw new Error('At least one document line is required');
  if (!/^[A-Z]{3}$/.test(input.documentCurrency) || !/^[A-Z]{3}$/.test(input.homeCurrency)) {
    throw new Error('Currencies must be three-letter uppercase codes');
  }
  const isFx = input.documentCurrency !== input.homeCurrency;
  if (isFx !== Boolean(input.fxRate)) throw new Error(isFx ? 'Foreign documents require a frozen FX rate' : 'Home-currency documents must not carry an FX rate');
  const scaledRate = isFx ? parseFxRate(input.fxRate!) : RATE_SCALE;

  const snapshots: PlannedTaxSnapshot[] = input.lines.map(line => {
    const calculated = calculateTaxLine({
      amountMinor: line.amountMinor,
      priceMode: line.priceMode,
      direction: input.direction,
      components: line.components,
    });
    const components: PlannedTaxComponent[] = calculated.components.map(component => {
      const source = line.components.find(candidate => candidate.kind === component.kind)!;
      const taxHomeMinor = convertMinor(component.taxMinor, scaledRate);
      const outputTaxHomeMinor = input.direction === 'sale' ? taxHomeMinor : 0;
      const recoverableHomeMinor = input.direction === 'purchase'
        ? convertMinor(component.recoverableMinor, scaledRate)
        : 0;
      return {
        ...component,
        authority: source.authority,
        recoveryReason: source.recoveryReason,
        recoveryEvidence: source.recoveryEvidence,
        recoveryReviewedById: source.recoveryReviewedById,
        taxHomeMinor,
        outputTaxHomeMinor,
        recoverableHomeMinor,
        nonRecoverableHomeMinor: input.direction === 'purchase' ? taxHomeMinor - recoverableHomeMinor : 0,
      };
    });
    const netHomeMinor = convertMinor(calculated.netMinor, scaledRate);
    const taxHomeMinor = sum(components.map(component => component.taxHomeMinor));
    const treatments = new Set(components.map(component => component.treatment));
    return {
      sourceLineId: line.sourceLineId,
      taxCodeVersionId: line.taxCodeVersionId,
      categoryAccountCode: line.categoryAccountCode,
      treatment: treatments.size === 1 ? components[0].treatment : 'taxable',
      priceMode: line.priceMode,
      netMinor: calculated.netMinor,
      taxMinor: calculated.taxMinor,
      grossMinor: calculated.grossMinor,
      netHomeMinor,
      taxHomeMinor,
      grossHomeMinor: netHomeMinor + taxHomeMinor,
      components,
    };
  });

  const journalLines: PlannedJournalLine[] = [];
  const add = (line: PlannedJournalLine | null) => { if (line) journalLines.push(line); };
  for (const snapshot of snapshots) {
    const nonrecoverableForeign = sum(snapshot.components.map(component => component.nonRecoverableMinor));
    const nonrecoverableHome = sum(snapshot.components.map(component => component.nonRecoverableHomeMinor));
    add(signedLine(
      snapshot.categoryAccountCode,
      input.direction === 'sale' ? 'Taxable revenue' : 'Expense or asset cost',
      input.direction === 'sale' ? 'credit' : 'debit',
      snapshot.netHomeMinor + nonrecoverableHome,
      snapshot.netMinor + nonrecoverableForeign,
      input.documentCurrency,
      isFx ? input.fxRate! : undefined,
    ));
    for (const component of snapshot.components) {
      if (input.direction === 'sale') {
        add(signedLine(
          mappedAccount(component.kind, 'output', input.mappings),
          `${component.kind} output tax`,
          'credit',
          component.outputTaxHomeMinor,
          component.outputTaxMinor,
          input.documentCurrency,
          isFx ? input.fxRate! : undefined,
        ));
      } else if (component.recoverableMinor !== 0) {
        add(signedLine(
          mappedAccount(component.kind, 'recoverable', input.mappings),
          `${component.kind} recoverable tax`,
          'debit',
          component.recoverableHomeMinor,
          component.recoverableMinor,
          input.documentCurrency,
          isFx ? input.fxRate! : undefined,
        ));
      }
    }
  }

  const grossMinor = sum(snapshots.map(snapshot => snapshot.grossMinor));
  const grossHomeMinor = sum(snapshots.map(snapshot => snapshot.grossHomeMinor));
  add(signedLine(
    input.mappings.control,
    input.direction === 'sale' ? 'Accounts receivable' : 'Accounts payable',
    input.direction === 'sale' ? 'debit' : 'credit',
    grossHomeMinor,
    grossMinor,
    input.documentCurrency,
    isFx ? input.fxRate! : undefined,
  ));

  const debits = sum(journalLines.map(line => line.debitMinor));
  const credits = sum(journalLines.map(line => line.creditMinor));
  if (debits !== credits) throw new Error(`Tax posting plan is not balanced (${debits} debit minor units versus ${credits} credit minor units)`);

  return {
    snapshots,
    journalLines,
    netMinor: sum(snapshots.map(snapshot => snapshot.netMinor)),
    taxMinor: sum(snapshots.map(snapshot => snapshot.taxMinor)),
    grossMinor,
    netHomeMinor: sum(snapshots.map(snapshot => snapshot.netHomeMinor)),
    taxHomeMinor: sum(snapshots.map(snapshot => snapshot.taxHomeMinor)),
    grossHomeMinor,
  };
}

/** Credits and voids use the original frozen decisions; no current rate lookup occurs. */
export function reverseTaxPostingPlan(original: TaxPostingPlan): TaxPostingPlan {
  const negateComponent = (component: PlannedTaxComponent): PlannedTaxComponent => ({
    ...component,
    taxMinor: -component.taxMinor,
    recoverableMinor: -component.recoverableMinor,
    nonRecoverableMinor: -component.nonRecoverableMinor,
    outputTaxMinor: -component.outputTaxMinor,
    taxHomeMinor: -component.taxHomeMinor,
    outputTaxHomeMinor: -component.outputTaxHomeMinor,
    recoverableHomeMinor: -component.recoverableHomeMinor,
    nonRecoverableHomeMinor: -component.nonRecoverableHomeMinor,
  });
  return {
    snapshots: original.snapshots.map(snapshot => ({
      ...snapshot,
      netMinor: -snapshot.netMinor,
      taxMinor: -snapshot.taxMinor,
      grossMinor: -snapshot.grossMinor,
      netHomeMinor: -snapshot.netHomeMinor,
      taxHomeMinor: -snapshot.taxHomeMinor,
      grossHomeMinor: -snapshot.grossHomeMinor,
      components: snapshot.components.map(negateComponent),
    })),
    journalLines: original.journalLines.map(line => ({
      ...line,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      debitForeignMinor: line.creditForeignMinor,
      creditForeignMinor: line.debitForeignMinor,
    })),
    netMinor: -original.netMinor,
    taxMinor: -original.taxMinor,
    grossMinor: -original.grossMinor,
    netHomeMinor: -original.netHomeMinor,
    taxHomeMinor: -original.taxHomeMinor,
    grossHomeMinor: -original.grossHomeMinor,
  };
}
