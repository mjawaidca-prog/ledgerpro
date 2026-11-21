/**
 * Books health — anomaly & duplicate radar (improvement plan Phase 2,
 * item 4). A PURE computation core: plain facts in, flags out. No DB,
 * no I/O, no LLM — every rule is deterministic and every flag names
 * its evidence (amounts, dates, accounts), because this is a trust
 * feature for accountants: a flag that cannot show its working does
 * not ship.
 *
 * The server layer (src/lib/health/server.ts) assembles the facts
 * from the modules that already own each figure — GIFI readiness for
 * coding state, the loan engine/shareholder modules for proofs and
 * s.15(2) deadlines, the GST return service for filed state, the
 * year-end package's suspense rule — and this engine only judges.
 *
 * Flags are grouped into checks. A check with no flags reports a
 * "healthy" line instead of staying silent, so the checklist reads as
 * a checklist: Needs attention / Worth a look / Healthy.
 *
 * Dismissals (persisted by the server layer) key on a flag's
 * fingerprint: `<ruleId>:<fnv1a of a stable item key>`. The key is
 * built from the underlying items (transaction ids, account code,
 * loan id + figures, GST period), so a dismissal silences exactly the
 * flagged item — when the item changes, the fingerprint changes and
 * the flag returns for a fresh look.
 */

// ─── Thresholds ─────────────────────────────────────────────────────

/** Two payments to the same payee for the same amount this close
 *  together are worth a second look. Five days (not seven) keeps a
 *  regular weekly payment of a fixed amount from flagging itself. */
export const DUPLICATE_WINDOW_DAYS = 5;
/** A payment at least this many times the payee's median payment… */
export const OUTLIER_MULTIPLE = 3;
/** …and at least this large, is an outlier. */
export const OUTLIER_MIN_CENTS = 50_000; // $500
/** A payee needs at least this many payments before a median means anything. */
export const OUTLIER_MIN_PAYMENTS = 5;
/** Round-amount cluster: payments of at least this much… */
export const ROUND_MIN_CENTS = 50_000; // $500
/** …that are exact multiples of $100, at least this many to one payee. */
export const ROUND_CLUSTER_MIN = 3;
/** An uncoded account at or above this 12-month volume needs attention now. */
export const UNCODED_ATTENTION_CENTS = 1_000_000; // $10,000
/** Cap on per-account uncoded flags (ranked by dollar volume). */
export const UNCODED_MAX_FLAGS = 10;
/** Uncategorized bank transactions older than this are "stale". */
export const UNCATEGORIZED_STALE_DAYS = 14;
export const UNCATEGORIZED_ATTENTION_COUNT = 10;
export const UNCATEGORIZED_ATTENTION_CENTS = 500_000; // $5,000
/** Bank account not reconciled within this many days: worth a look… */
export const RECONCILE_STALE_DAYS = 45;
/** …and past this many days: needs attention. */
export const RECONCILE_ATTENTION_DAYS = 90;
/** s.15(2) deadline inside this many days: worth a look… */
export const LOAN_DEADLINE_LOOK_DAYS = 90;
/** …inside this many days (or past it): needs attention. */
export const LOAN_DEADLINE_ATTENTION_DAYS = 30;
/** A GST period that ended more than this many days ago, unfiled. */
export const GST_ATTENTION_DAYS = 30;
/** Cap on flags from any single detector, so one bad import cannot flood the page. */
export const MAX_FLAGS_PER_DETECTOR = 10;

// ─── Facts (plain data in) ──────────────────────────────────────────

export interface HealthPaymentFact {
  id: string;
  date: string; // YYYY-MM-DD
  payee: string; // display payee (merchant / payee guess / description)
  description: string;
  amountCents: number; // positive = money out of the bank
  accountName: string; // financial account the money left
}

export interface HealthJournalLineFact {
  id: string;
  entryId: string;
  entryDate: string; // YYYY-MM-DD
  entryDescription: string;
  glAccountCode: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
}

export interface HealthAccountFact {
  code: string;
  name: string;
  /** Signed balance (debits − credits) through the as-of date. */
  balanceCents: number;
  /** |debits| + |credits| inside the lookback window — the dollar volume. */
  activityCents: number;
  /** From GIFI readiness: 'invalid' means a code is present but not a real CRA code. */
  gifiStatus: 'coded' | 'undecided' | 'invalid' | 'decided_unmapped';
}

export interface HealthUncategorizedFact {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // signed, as it hit the bank
}

export interface HealthBankAccountFact {
  id: string;
  name: string;
  /** Last date through which a reconciliation is locked/closed; null = never. */
  reconciledThrough: string | null;
  hasTransactions: boolean;
}

export interface HealthLoanFact {
  id: string;
  lenderName: string;
  kind: string;
  /** Non-zero proof legs only (server computes them via the loan modules). */
  proofDifferences: {
    leg: 'schedule_vs_gl' | 'schedule_vs_statement';
    scheduleCents: number;
    otherCents: number;
    differenceCents: number;
  }[];
  /** Outstanding s.15(2) advances (server computes via advanceDeadlines). */
  deadlines: {
    advanceDate: string;
    deadline: string;
    daysRemaining: number;
    outstandingCents: number;
  }[];
}

export interface HealthFacts {
  asOf: string; // YYYY-MM-DD
  payments: HealthPaymentFact[];
  journalLines: HealthJournalLineFact[];
  accounts: HealthAccountFact[];
  /** Suspense/clearing accounts with a NON-ZERO balance (year-end rule). */
  suspense: { code: string; name: string; balanceCents: number }[];
  uncategorized: HealthUncategorizedFact[];
  bankAccounts: HealthBankAccountFact[];
  loans: HealthLoanFact[];
  gst: {
    registrationPresent: boolean;
    unfiledPeriods: { start: string; end: string }[];
  };
}

// ─── Flags (judgements out) ─────────────────────────────────────────

export type HealthSeverity = 'attention' | 'look';

export type HealthRuleId =
  | 'duplicate_payment'
  | 'duplicate_journal_line'
  | 'amount_outlier'
  | 'round_number_cluster'
  | 'uncoded_account'
  | 'uncategorized_transactions'
  | 'suspense_balance'
  | 'bank_reconciliation_stale'
  | 'loan_proof_difference'
  | 'shareholder_deadline'
  | 'gst_period_unfiled';

export interface HealthFlag {
  fingerprint: string;
  ruleId: HealthRuleId;
  checkId: string;
  severity: HealthSeverity;
  title: string;
  /** Plain-language reason, with the figures that prove it. */
  detail: string;
  figures: { label: string; value: string }[];
  /** Drill-down lines naming the underlying items. */
  items: string[];
  href: string | null;
}

export interface HealthCheck {
  id: string;
  label: string;
  status: 'healthy' | HealthSeverity;
  /** Shown when the check has no active flags. */
  healthyDetail: string;
  flags: HealthFlag[];
}

export interface HealthSummary {
  attention: number;
  look: number;
  healthyChecks: number;
  totalChecks: number;
  overall: 'healthy' | HealthSeverity;
}

export interface HealthReport {
  asOf: string;
  checks: HealthCheck[];
  summary: HealthSummary;
}

// ─── Small pure helpers ─────────────────────────────────────────────

export function moneyCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole days from `a` to `b` (b − a) on YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Grouping key for payees and descriptions: case/punctuation blind. */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit — small, stable across runs and platforms. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fingerprint(ruleId: HealthRuleId, stableKey: string): string {
  return `${ruleId}:${fnv1a(stableKey)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Split a date-sorted list into clusters where neighbours are ≤ windowDays apart. */
function clustersWithin<T extends { date: string }>(sorted: T[], windowDays: number): T[][] {
  const clusters: T[][] = [];
  let current: T[] = [];
  for (const item of sorted) {
    if (current.length > 0 && daysBetween(current[current.length - 1].date, item.date) > windowDays) {
      if (current.length >= 2) clusters.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length >= 2) clusters.push(current);
  return clusters;
}

// ─── Detectors ──────────────────────────────────────────────────────

function duplicatePaymentFlags(f: HealthFacts): HealthFlag[] {
  const groups = new Map<string, HealthPaymentFact[]>();
  for (const p of f.payments) {
    if (p.amountCents <= 0) continue;
    const key = `${normalizeKey(p.payee)}|${p.amountCents}`;
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const flags: HealthFlag[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const cluster of clustersWithin(sorted, DUPLICATE_WINDOW_DAYS)) {
      const first = cluster[0];
      const last = cluster[cluster.length - 1];
      flags.push({
        fingerprint: fingerprint(
          'duplicate_payment',
          cluster.map((p) => p.id).sort().join(',')
        ),
        ruleId: 'duplicate_payment',
        checkId: 'duplicate_payments',
        severity: 'attention',
        title: `Possible duplicate payment — ${first.payee}`,
        detail:
          `${cluster.length} payments of ${moneyCents(first.amountCents)} to ${first.payee} ` +
          `between ${first.date} and ${last.date}. If one was paid or entered twice, void the copy; ` +
          `if every payment is real, dismiss this flag and it will not come back for these payments.`,
        figures: [
          { label: 'Amount', value: moneyCents(first.amountCents) },
          { label: 'Payments', value: String(cluster.length) },
          { label: 'Window', value: `${first.date} – ${last.date}` },
        ],
        items: cluster.map(
          (p) => `${p.date} — ${moneyCents(p.amountCents)} from ${p.accountName} — ${p.description}`
        ),
        href: '/banking',
      });
    }
  }
  return flags
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    .slice(0, MAX_FLAGS_PER_DETECTOR);
}

function duplicateJournalLineFlags(f: HealthFacts): HealthFlag[] {
  const groups = new Map<string, HealthJournalLineFact[]>();
  for (const line of f.journalLines) {
    if (line.debitCents === 0 && line.creditCents === 0) continue;
    const key = [
      line.glAccountCode,
      line.debitCents,
      line.creditCents,
      normalizeKey(line.description ?? ''),
    ].join('|');
    const g = groups.get(key) ?? [];
    g.push(line);
    groups.set(key, g);
  }
  const flags: HealthFlag[] = [];
  for (const group of groups.values()) {
    // Identical lines inside ONE entry are normal (split postings);
    // the same line in DIFFERENT entries, close together, is the smell.
    if (new Set(group.map((l) => l.entryId)).size < 2) continue;
    const sorted = [...group]
      .map((l) => ({ ...l, date: l.entryDate }))
      .sort((a, b) => (a.entryDate < b.entryDate ? -1 : 1));
    for (const cluster of clustersWithin(sorted, DUPLICATE_WINDOW_DAYS)) {
      if (new Set(cluster.map((l) => l.entryId)).size < 2) continue;
      const first = cluster[0];
      const amount = first.debitCents > 0 ? first.debitCents : first.creditCents;
      const side = first.debitCents > 0 ? 'debit' : 'credit';
      flags.push({
        fingerprint: fingerprint(
          'duplicate_journal_line',
          cluster.map((l) => l.id).sort().join(',')
        ),
        ruleId: 'duplicate_journal_line',
        checkId: 'duplicate_payments',
        severity: 'attention',
        title: `Possible duplicate journal line — account ${first.glAccountCode}`,
        detail:
          `The same ${side} of ${moneyCents(amount)} to account ${first.glAccountCode} ` +
          `appears in ${new Set(cluster.map((l) => l.entryId)).size} different journal entries ` +
          `between ${first.entryDate} and ${cluster[cluster.length - 1].entryDate}. ` +
          `A journal posted twice double-counts the amount.`,
        figures: [
          { label: 'Account', value: first.glAccountCode },
          { label: 'Amount', value: moneyCents(amount) },
          { label: 'Entries', value: String(new Set(cluster.map((l) => l.entryId)).size) },
        ],
        items: cluster.map(
          (l) =>
            `${l.entryDate} — "${l.entryDescription}" — ${side} ${moneyCents(amount)}` +
            (l.description ? ` — ${l.description}` : '')
        ),
        href: '/journal',
      });
    }
  }
  return flags.slice(0, MAX_FLAGS_PER_DETECTOR);
}

function outlierFlags(f: HealthFacts): HealthFlag[] {
  const byPayee = new Map<string, HealthPaymentFact[]>();
  for (const p of f.payments) {
    if (p.amountCents <= 0) continue;
    const key = normalizeKey(p.payee);
    const g = byPayee.get(key) ?? [];
    g.push(p);
    byPayee.set(key, g);
  }
  const found: { flag: HealthFlag; amountCents: number }[] = [];
  for (const group of byPayee.values()) {
    if (group.length < OUTLIER_MIN_PAYMENTS) continue;
    const med = median(group.map((p) => p.amountCents));
    if (med <= 0) continue;
    for (const p of group) {
      if (p.amountCents >= OUTLIER_MULTIPLE * med && p.amountCents >= OUTLIER_MIN_CENTS) {
        found.push({
          amountCents: p.amountCents,
          flag: {
          fingerprint: fingerprint('amount_outlier', p.id),
          ruleId: 'amount_outlier',
          checkId: 'amount_outliers',
          severity: 'look',
          title: `Unusually large payment — ${p.payee}`,
          detail:
            `${p.payee} usually receives about ${moneyCents(med)} (the median of ${group.length} payments). ` +
            `The payment of ${moneyCents(p.amountCents)} on ${p.date} is ${(p.amountCents / med).toFixed(1)}× that — ` +
            `worth confirming it is the right amount to the right payee.`,
          figures: [
            { label: 'Payment', value: moneyCents(p.amountCents) },
            { label: 'Usual (median)', value: moneyCents(med) },
            { label: 'Date', value: p.date },
          ],
          items: [`${p.date} — ${moneyCents(p.amountCents)} from ${p.accountName} — ${p.description}`],
          href: '/banking',
          },
        });
      }
    }
  }
  return found
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, MAX_FLAGS_PER_DETECTOR)
    .map((x) => x.flag);
}

function roundClusterFlags(f: HealthFacts): HealthFlag[] {
  const byPayee = new Map<string, HealthPaymentFact[]>();
  for (const p of f.payments) {
    if (p.amountCents < ROUND_MIN_CENTS || p.amountCents % 10_000 !== 0) continue;
    const key = normalizeKey(p.payee);
    const g = byPayee.get(key) ?? [];
    g.push(p);
    byPayee.set(key, g);
  }
  const flags: HealthFlag[] = [];
  for (const group of byPayee.values()) {
    if (group.length < ROUND_CLUSTER_MIN) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    const total = group.reduce((s, p) => s + p.amountCents, 0);
    flags.push({
      fingerprint: fingerprint(
        'round_number_cluster',
        sorted.map((p) => p.id).sort().join(',')
      ),
      ruleId: 'round_number_cluster',
      checkId: 'round_numbers',
      severity: 'look',
      title: `Round-number payments — ${sorted[0].payee}`,
      detail:
        `${group.length} payments to ${sorted[0].payee} are exact round amounts totalling ${moneyCents(total)}. ` +
        `Real invoices rarely land on the exact hundred this often — worth a glance in case estimates were posted instead of actuals.`,
      figures: [
        { label: 'Payments', value: String(group.length) },
        { label: 'Total', value: moneyCents(total) },
      ],
      items: sorted
        .slice(0, 6)
        .map((p) => `${p.date} — ${moneyCents(p.amountCents)} — ${p.description}`),
      href: '/banking',
    });
  }
  return flags.slice(0, MAX_FLAGS_PER_DETECTOR);
}

function uncodedFlags(f: HealthFacts): HealthFlag[] {
  const volume = (a: HealthAccountFact) => Math.max(Math.abs(a.balanceCents), a.activityCents);
  return f.accounts
    .filter((a) => a.gifiStatus === 'undecided' || a.gifiStatus === 'invalid')
    .sort((a, b) => volume(b) - volume(a))
    .slice(0, UNCODED_MAX_FLAGS)
    .map((a) => {
      const invalid = a.gifiStatus === 'invalid';
      return {
        fingerprint: fingerprint('uncoded_account', `${a.code}|${a.gifiStatus}`),
        ruleId: 'uncoded_account' as const,
        checkId: 'gifi_coding',
        severity: (volume(a) >= UNCODED_ATTENTION_CENTS ? 'attention' : 'look') as HealthSeverity,
        title: invalid
          ? `Account ${a.code} ${a.name} carries an invalid GIFI code`
          : `Account ${a.code} ${a.name} has no GIFI decision`,
        detail: invalid
          ? `The GIFI code on this account is not a real CRA code, so it exports to Nexvar Tax as unmapped. ` +
            `It moved ${moneyCents(a.activityCents)} in the last 12 months and carries a balance of ${moneyCents(a.balanceCents)}.`
          : `No GIFI code has been assigned and no deliberate "leave unmapped" decision is recorded, so this account ` +
            `exports to Nexvar Tax as unmapped. It moved ${moneyCents(a.activityCents)} in the last 12 months ` +
            `and carries a balance of ${moneyCents(a.balanceCents)} — coding it here is cheaper than fixing it at tax time.`,
        figures: [
          { label: '12-month activity', value: moneyCents(a.activityCents) },
          { label: 'Balance', value: moneyCents(a.balanceCents) },
        ],
        items: [],
        href: '/chart-of-accounts',
      };
    });
}

function uncategorizedFlag(f: HealthFacts): HealthFlag[] {
  const stale = f.uncategorized.filter(
    (t) => daysBetween(t.date, f.asOf) >= UNCATEGORIZED_STALE_DAYS
  );
  if (stale.length === 0) return [];
  const total = stale.reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const oldest = stale.reduce((min, t) => (t.date < min ? t.date : min), stale[0].date);
  const top = [...stale].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)).slice(0, 5);
  return [
    {
      fingerprint: fingerprint(
        'uncategorized_transactions',
        stale.map((t) => t.id).sort().join(',')
      ),
      ruleId: 'uncategorized_transactions',
      checkId: 'uncategorized',
      severity:
        stale.length >= UNCATEGORIZED_ATTENTION_COUNT || total >= UNCATEGORIZED_ATTENTION_CENTS
          ? 'attention'
          : 'look',
      title: `${stale.length} bank transactions are waiting for a category`,
      detail:
        `These transactions total ${moneyCents(total)} and have sat uncategorized for more than ` +
        `${UNCATEGORIZED_STALE_DAYS} days — the oldest is from ${oldest}. Uncategorized rows are ` +
        `invisible to reports and to the GIFI export until they are coded.`,
      figures: [
        { label: 'Transactions', value: String(stale.length) },
        { label: 'Total', value: moneyCents(total) },
        { label: 'Oldest', value: oldest },
      ],
      items: top.map((t) => `${t.date} — ${t.description} — ${moneyCents(t.amountCents)}`),
      href: '/banking',
    },
  ];
}

function suspenseFlags(f: HealthFacts): HealthFlag[] {
  return f.suspense
    .filter((a) => a.balanceCents !== 0)
    .map((a) => ({
      fingerprint: fingerprint('suspense_balance', `${a.code}|${a.balanceCents}`),
      ruleId: 'suspense_balance' as const,
      checkId: 'suspense',
      severity: 'attention' as const,
      title: `Suspense account ${a.code} ${a.name} is not at zero`,
      detail:
        `This account carries a balance of ${moneyCents(a.balanceCents)}. A non-zero suspense or clearing ` +
        `balance means deposits or payments are still unidentified — they belong in a real account before the books can support a filing.`,
      figures: [{ label: 'Balance', value: moneyCents(a.balanceCents) }],
      items: [],
      href: '/reports/general-ledger',
    }));
}

function bankReconciliationFlags(f: HealthFacts): HealthFlag[] {
  const flags: HealthFlag[] = [];
  for (const acct of f.bankAccounts) {
    if (!acct.hasTransactions) continue;
    if (acct.reconciledThrough === null) {
      flags.push({
        fingerprint: fingerprint('bank_reconciliation_stale', `${acct.id}|never`),
        ruleId: 'bank_reconciliation_stale',
        checkId: 'bank_reconciliation',
        severity: 'attention',
        title: `${acct.name} has never been reconciled`,
        detail:
          `Transactions exist for ${acct.name} but no reconciliation has been locked or closed in LedgerPro, ` +
          `so the ledger balance has never been proven against a statement.`,
        figures: [{ label: 'Reconciled through', value: 'Never' }],
        items: [],
        href: '/banking',
      });
      continue;
    }
    const days = daysBetween(acct.reconciledThrough, f.asOf);
    if (days > RECONCILE_STALE_DAYS) {
      flags.push({
        fingerprint: fingerprint(
          'bank_reconciliation_stale',
          `${acct.id}|${acct.reconciledThrough}`
        ),
        ruleId: 'bank_reconciliation_stale',
        checkId: 'bank_reconciliation',
        severity: days > RECONCILE_ATTENTION_DAYS ? 'attention' : 'look',
        title: `${acct.name} was last reconciled ${days} days ago`,
        detail:
          `${acct.name} is reconciled through ${acct.reconciledThrough} — ${days} days before ${f.asOf}. ` +
          `Balances after that date are not yet proven against a statement.`,
        figures: [
          { label: 'Reconciled through', value: acct.reconciledThrough },
          { label: 'Days stale', value: String(days) },
        ],
        items: [],
        href: '/banking',
      });
    }
  }
  return flags;
}

function loanProofFlags(f: HealthFacts): HealthFlag[] {
  const flags: HealthFlag[] = [];
  for (const loan of f.loans) {
    for (const diff of loan.proofDifferences) {
      const otherLabel =
        diff.leg === 'schedule_vs_gl' ? 'general ledger' : 'lender statement';
      flags.push({
        fingerprint: fingerprint(
          'loan_proof_difference',
          `${loan.id}|${diff.leg}|${diff.differenceCents}`
        ),
        ruleId: 'loan_proof_difference',
        checkId: 'loan_proofs',
        severity: 'attention',
        title: `Loan balance does not tie — ${loan.lenderName}`,
        detail:
          `The amortization schedule shows ${moneyCents(diff.scheduleCents)} owing, but the ${otherLabel} ` +
          `shows ${moneyCents(diff.otherCents)} — a difference of ${moneyCents(diff.differenceCents)}. ` +
          `One of the three records is wrong; the loan page shows the full three-way proof.`,
        figures: [
          { label: 'Schedule', value: moneyCents(diff.scheduleCents) },
          { label: otherLabel === 'general ledger' ? 'Ledger' : 'Statement', value: moneyCents(diff.otherCents) },
          { label: 'Difference', value: moneyCents(diff.differenceCents) },
        ],
        items: [],
        href: '/loans',
      });
    }
  }
  return flags;
}

function shareholderDeadlineFlags(f: HealthFacts): HealthFlag[] {
  const flags: HealthFlag[] = [];
  for (const loan of f.loans) {
    for (const d of loan.deadlines) {
      if (d.daysRemaining > LOAN_DEADLINE_LOOK_DAYS) continue;
      const overdue = d.daysRemaining < 0;
      flags.push({
        fingerprint: fingerprint(
          'shareholder_deadline',
          `${loan.id}|${d.advanceDate}|${d.deadline}`
        ),
        ruleId: 'shareholder_deadline',
        checkId: 'shareholder_deadlines',
        severity:
          overdue || d.daysRemaining <= LOAN_DEADLINE_ATTENTION_DAYS ? 'attention' : 'look',
        title: overdue
          ? `Shareholder advance past its s.15(2) deadline — ${loan.lenderName}`
          : `Shareholder advance deadline in ${d.daysRemaining} days — ${loan.lenderName}`,
        detail: overdue
          ? `The advance of ${moneyCents(d.outstandingCents)} made on ${d.advanceDate} was not repaid by ` +
            `${d.deadline}. Under s.15(2) the outstanding amount is included in the shareholder's personal income.`
          : `The advance of ${moneyCents(d.outstandingCents)} made on ${d.advanceDate} must be repaid by ` +
            `${d.deadline} — ${d.daysRemaining} days from ${f.asOf} — or the outstanding amount becomes ` +
            `personal income to the shareholder under s.15(2).`,
        figures: [
          { label: 'Outstanding', value: moneyCents(d.outstandingCents) },
          { label: 'Advance date', value: d.advanceDate },
          { label: 'Deadline', value: d.deadline },
        ],
        items: [],
        href: '/loans',
      });
    }
  }
  return flags;
}

function gstFlags(f: HealthFacts): HealthFlag[] {
  return f.gst.unfiledPeriods.map((p) => {
    const days = daysBetween(p.end, f.asOf);
    return {
      fingerprint: fingerprint('gst_period_unfiled', `${p.start}|${p.end}`),
      ruleId: 'gst_period_unfiled' as const,
      checkId: 'gst_filings',
      severity: (days > GST_ATTENTION_DAYS ? 'attention' : 'look') as HealthSeverity,
      title: `GST/HST period ended ${p.end} has no filing recorded`,
      detail:
        `The period ${p.start} to ${p.end} has ended and LedgerPro has no filing recorded for it. ` +
        `If it was filed outside LedgerPro, record the filing (with the CRA confirmation number) on the ` +
        `GST/HST Return page so the period locks and this check passes.`,
      figures: [
        { label: 'Period', value: `${p.start} – ${p.end}` },
        { label: 'Ended', value: `${days} days ago` },
      ],
      items: [],
      href: '/reports/gst-hst-return',
    };
  });
}

// ─── Assembly ───────────────────────────────────────────────────────

function summarize(checks: HealthCheck[]): HealthSummary {
  let attention = 0;
  let look = 0;
  let healthyChecks = 0;
  for (const c of checks) {
    if (c.flags.length === 0) healthyChecks += 1;
    for (const fl of c.flags) {
      if (fl.severity === 'attention') attention += 1;
      else look += 1;
    }
  }
  return {
    attention,
    look,
    healthyChecks,
    totalChecks: checks.length,
    overall: attention > 0 ? 'attention' : look > 0 ? 'look' : 'healthy',
  };
}

function makeCheck(
  id: string,
  label: string,
  healthyDetail: string,
  flags: HealthFlag[]
): HealthCheck {
  const status: HealthCheck['status'] =
    flags.length === 0
      ? 'healthy'
      : flags.some((fl) => fl.severity === 'attention')
        ? 'attention'
        : 'look';
  return { id, label, status, healthyDetail, flags };
}

export function evaluateHealth(facts: HealthFacts): HealthReport {
  const checks: HealthCheck[] = [
    makeCheck(
      'duplicate_payments',
      'No duplicate payments',
      'No two payments to the same payee for the same amount landed within five days of each other, and no journal line repeats across entries.',
      [...duplicatePaymentFlags(facts), ...duplicateJournalLineFlags(facts)]
    ),
    makeCheck(
      'amount_outliers',
      'Payments in their usual range',
      'No payment is three or more times what its payee usually receives.',
      outlierFlags(facts)
    ),
    makeCheck(
      'round_numbers',
      'No round-number clusters',
      'No payee received three or more exact round-amount payments.',
      roundClusterFlags(facts)
    ),
    makeCheck(
      'suspense',
      'Suspense and clearing accounts at zero',
      'No suspense or clearing account carries a balance.',
      suspenseFlags(facts)
    ),
    makeCheck(
      'uncategorized',
      'Bank transactions categorized',
      `No bank transaction has waited more than ${UNCATEGORIZED_STALE_DAYS} days for a category.`,
      uncategorizedFlag(facts)
    ),
    makeCheck(
      'gifi_coding',
      'Every account carries a GIFI decision',
      'Every active account is coded, or deliberately left unmapped with the decision recorded.',
      uncodedFlags(facts)
    ),
    makeCheck(
      'bank_reconciliation',
      'Bank accounts reconciled',
      `Every bank account with transactions is reconciled within the last ${RECONCILE_STALE_DAYS} days.`,
      bankReconciliationFlags(facts)
    ),
    makeCheck(
      'loan_proofs',
      'Loan balances tie three ways',
      'Every loan schedule agrees with the ledger and the lender statement.',
      loanProofFlags(facts)
    ),
    makeCheck(
      'shareholder_deadlines',
      'No shareholder deadline near',
      `No shareholder advance is within ${LOAN_DEADLINE_LOOK_DAYS} days of its s.15(2) repayment deadline.`,
      shareholderDeadlineFlags(facts)
    ),
    makeCheck(
      'gst_filings',
      'GST/HST filings up to date',
      facts.gst.registrationPresent
        ? 'Every ended GST/HST period has a filing recorded.'
        : 'No GST/HST registration on file — there is nothing to file.',
      gstFlags(facts)
    ),
  ];
  return { asOf: facts.asOf, checks, summary: summarize(checks) };
}

// ─── Dismissals ─────────────────────────────────────────────────────

export interface HealthDismissal {
  fingerprint: string;
  reason: string;
  dismissedAt: string; // ISO timestamp
}

export interface DismissedHealthFlag {
  flag: HealthFlag;
  reason: string;
  dismissedAt: string;
}

/**
 * Split a report into the active report (dismissed flags removed,
 * check statuses and summary recomputed) and the dismissed flags
 * themselves, so the page can show what was silenced and restore it.
 */
export function partitionDismissals(
  report: HealthReport,
  dismissals: Map<string, HealthDismissal>
): { report: HealthReport; dismissed: DismissedHealthFlag[] } {
  const dismissed: DismissedHealthFlag[] = [];
  const checks = report.checks.map((check) => {
    const kept: HealthFlag[] = [];
    for (const flag of check.flags) {
      const d = dismissals.get(flag.fingerprint);
      if (d) dismissed.push({ flag, reason: d.reason, dismissedAt: d.dismissedAt });
      else kept.push(flag);
    }
    return makeCheck(check.id, check.label, check.healthyDetail, kept);
  });
  return { report: { asOf: report.asOf, checks, summary: summarize(checks) }, dismissed };
}
