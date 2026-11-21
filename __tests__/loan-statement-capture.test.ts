/**
 * Phase 3 item 3 — loan statement-capture pre-fill.
 *
 * Pins, with FAKE providers and fixture statement JSON (no network):
 *  1. The key-value mapper: a Ford-Credit-style layout read lands in
 *     the loan fields with the model's confidences untouched; labels
 *     the statement does not print stay null — never invented.
 *  2. The Azure loan provider's network path (submit → poll →
 *     succeeded) against a fake fetch, on the shared transport, with
 *     the layout model in the URL; env resolution (no env → null).
 *  3. Account-number masking: only the last 4 ever leave the server.
 *  4. The draft pre-fill: statement values carry 'statement'
 *     provenance, the engine-solved remaining term is 'calculated',
 *     low-confidence fields are flagged.
 *  5. The schedule check: exact match / small drift / large drift,
 *     difference = statement − schedule, to the cent.
 *  6. The pipeline against a mocked db: extracted stores the read
 *     verbatim; unconfigured → 'unavailable' with NO field values
 *     written (zero fabrication); failing → 'failed', nothing written.
 *  7. The apply: statement leg set on the loan, check recorded, and
 *     an accepted correction re-amortizes the tail from the statement
 *     balance (posted rows untouched).
 */
jest.mock('@/lib/db', () => ({
  db: {
    loanStatement: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    loan: { findFirst: jest.fn(), update: jest.fn() },
    loanPayment: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { db } from '@/lib/db';
import {
  createAzureLoanStatementProvider,
  createAzureLoanStatementProviderFromEnv,
  mapLoanStatementResult,
  maskAccountNumber,
  accountNumberLast4,
  resolveLoanStatementProvider,
  AZURE_DI_LAYOUT_MODEL,
  type LoanStatementExtraction,
  type LoanStatementOcrProvider,
} from '@/lib/loans/statement-ocr';
import {
  buildLoanDraftPrefill,
  computeScheduleCheck,
  classifyDrift,
  planTailCorrection,
  SMALL_DRIFT_CENTS,
} from '@/lib/loans/statement';
import { runLoanStatementExtraction } from '@/lib/loans/statement-pipeline';
import {
  applyStatementToLoan,
  computeStatementCheck,
  serializeLoanStatement,
} from '@/lib/loans/statement-service';
import { buildSchedule, toCents } from '@/lib/loans/engine';

const mockDb = db as any;

// A Ford-Credit-style prebuilt-layout result.
const LAYOUT_RESULT = {
  status: 'succeeded',
  analyzeResult: {
    modelId: 'prebuilt-layout',
    keyValuePairs: [
      { key: { content: 'Lender', confidence: 0.98 }, value: { content: 'Ford Credit Canada', confidence: 0.97 } },
      { key: { content: 'Account Number', confidence: 0.99 }, value: { content: '0012 3456 7890 4417', confidence: 0.99 } },
      { key: { content: 'Statement Date', confidence: 0.96 }, value: { content: '11/15/2026', confidence: 0.95 } },
      { key: { content: 'Current Balance', confidence: 0.93 }, value: { content: '$18,432.17', confidence: 0.92 } },
      { key: { content: 'Regular Payment Amount', confidence: 0.9 }, value: { content: '$486.23', confidence: 0.72 } },
      { key: { content: 'Annual Percentage Rate (APR)', confidence: 0.94 }, value: { content: '6.99%', confidence: 0.93 } },
      { key: { content: 'Next Payment Due Date', confidence: 0.91 }, value: { content: 'December 1, 2026', confidence: 0.9 } },
    ],
  },
};

const EXTRACTION: LoanStatementExtraction = {
  lenderName: { value: 'Ford Credit Canada', confidence: 0.97 },
  statementDate: { value: '2026-11-15', confidence: 0.95 },
  currentBalance: { value: 18432.17, confidence: 0.92 },
  paymentAmount: { value: 486.23, confidence: 0.72 },
  annualRatePct: { value: 6.99, confidence: 0.93 },
  nextPaymentDate: { value: '2026-12-01', confidence: 0.9 },
  accountNumber: { value: '0012 3456 7890 4417', confidence: 0.99 },
};

describe('mapLoanStatementResult', () => {
  test('maps the statement labels with confidences passed through untouched', () => {
    const x = mapLoanStatementResult(LAYOUT_RESULT);
    expect(x.lenderName).toEqual({ value: 'Ford Credit Canada', confidence: 0.97 });
    expect(x.statementDate).toEqual({ value: '2026-11-15', confidence: 0.95 });
    expect(x.currentBalance).toEqual({ value: 18432.17, confidence: 0.92 });
    expect(x.paymentAmount).toEqual({ value: 486.23, confidence: 0.72 });
    expect(x.annualRatePct).toEqual({ value: 6.99, confidence: 0.93 });
    expect(x.nextPaymentDate).toEqual({ value: '2026-12-01', confidence: 0.9 });
    expect(x.accountNumber).toEqual({ value: '0012 3456 7890 4417', confidence: 0.99 });
  });

  test('labels the statement does not print stay null — nothing is invented', () => {
    const sparse = {
      analyzeResult: {
        keyValuePairs: [
          { key: { content: 'Current Balance', confidence: 0.8 }, value: { content: '$5,000.00', confidence: 0.8 } },
        ],
      },
    };
    const x = mapLoanStatementResult(sparse);
    expect(x.currentBalance.value).toBe(5000);
    expect(x.lenderName).toEqual({ value: null, confidence: null });
    expect(x.statementDate).toEqual({ value: null, confidence: null });
    expect(x.paymentAmount.value).toBeNull();
    expect(x.annualRatePct.value).toBeNull();
    expect(x.nextPaymentDate.value).toBeNull();
    expect(x.accountNumber.value).toBeNull();
  });

  test('a statement-period range reads its END as the statement date', () => {
    const ranged = {
      analyzeResult: {
        keyValuePairs: [
          {
            key: { content: 'Statement Period', confidence: 0.9 },
            value: { content: '10/16/2026 - 11/15/2026', confidence: 0.9 },
          },
        ],
      },
    };
    expect(mapLoanStatementResult(ranged).statementDate.value).toBe('2026-11-15');
  });

  test('an empty or pair-less result maps to an all-null extraction', () => {
    expect(mapLoanStatementResult({ analyzeResult: {} }).currentBalance.value).toBeNull();
    expect(mapLoanStatementResult({}).lenderName.value).toBeNull();
    expect(mapLoanStatementResult(null).accountNumber.value).toBeNull();
  });
});

describe('Azure loan statement provider — shared transport, fake fetch', () => {
  test('submits to the layout model, polls, and returns the mapped read', async () => {
    const calls: { url: string; init: any }[] = [];
    const fakeFetch = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 202,
          headers: { get: (n: string) => (n === 'Operation-Location' ? 'https://di.example/operations/9' : null) },
          json: async () => ({}),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => LAYOUT_RESULT,
        text: async () => '',
      };
    });

    const provider = createAzureLoanStatementProvider({
      endpoint: 'https://di.example/',
      key: 'secret-key',
      fetchImpl: fakeFetch as any,
      pollIntervalMs: 1,
    });
    expect(provider.isConfigured()).toBe(true);

    const x = await provider.extract({ buffer: Buffer.from('bytes'), mimeType: 'application/pdf' });
    expect(x.currentBalance.value).toBe(18432.17);
    expect(x.lenderName.value).toBe('Ford Credit Canada');
    expect(calls[0].url).toBe(
      `https://di.example/documentintelligence/documentModels/${AZURE_DI_LAYOUT_MODEL}:analyze?api-version=2024-11-30`,
    );
    expect(calls[0].init.headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
  });

  test('no env → no provider (the unavailable state depends on it)', () => {
    expect(createAzureLoanStatementProviderFromEnv({})).toBeNull();
    expect(resolveLoanStatementProvider({})).toBeNull();
    const provider = resolveLoanStatementProvider({
      AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://di.example',
      AZURE_DOCUMENT_INTELLIGENCE_KEY: 'k',
    });
    expect(provider?.isConfigured()).toBe(true);
  });
});

describe('account-number masking', () => {
  test('only the last four ever show', () => {
    expect(accountNumberLast4('0012 3456 7890 4417')).toBe('4417');
    expect(maskAccountNumber('0012 3456 7890 4417')).toBe('••••4417');
    expect(maskAccountNumber('0012 3456 7890 4417')).not.toContain('7890');
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskAccountNumber('12')).toBeNull();
  });

  test('the serializer never exposes the full account number', () => {
    const s = serializeLoanStatement({
      id: 's1',
      companyId: 'c1',
      loanId: null,
      originalFileName: 'ford.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      extractionStatus: 'extracted',
      extractionProvider: 'azure-document-intelligence',
      extractionError: null,
      extractionFields: EXTRACTION,
      checkStatementBalance: null,
      correctionApplied: false,
      appliedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(s.fields?.accountNumber.value).toBeNull();
    expect(s.fields?.accountNumber.masked).toBe('••••4417');
    expect(JSON.stringify(s)).not.toContain('7890 4417');
    expect(s.prefill?.lenderName.value).toBe('Ford Credit Canada');
  });
});

describe('buildLoanDraftPrefill', () => {
  test('statement values carry statement provenance; the solved term is calculated', () => {
    const p = buildLoanDraftPrefill(EXTRACTION);
    expect(p.lenderName).toMatchObject({ value: 'Ford Credit Canada', source: 'statement', lowConfidence: false });
    expect(p.principal).toMatchObject({ value: 18432.17, source: 'statement' });
    expect(p.startDate).toMatchObject({ value: '2026-11-15', source: 'statement' });
    expect(p.firstPaymentDate).toMatchObject({ value: '2026-12-01', source: 'statement' });
    // The payment was read at 0.72 — below the 0.80 review threshold.
    expect(p.paymentAmount.lowConfidence).toBe(true);
    expect(p.annualRatePct.lowConfidence).toBe(false);
    // Derived, and marked as derived.
    expect(p.remainingPayments.source).toBe('calculated');
    expect(p.remainingPayments.confidence).toBeNull();
    expect(p.remainingPayments.value).not.toBeNull();
    const solved = buildSchedule({
      principalCents: toCents(18432.17),
      annualRatePct: 6.99,
      frequency: 'monthly',
      firstPaymentDate: '2026-12-01',
      paymentCents: toCents(486.23),
    });
    expect(p.remainingPayments.value).toBe(solved.numberOfPayments);
  });

  test('no rate read → no derived term, and missing fields stay sourceless', () => {
    const partial: LoanStatementExtraction = {
      ...EXTRACTION,
      annualRatePct: { value: null, confidence: null },
      lenderName: { value: null, confidence: null },
    };
    const p = buildLoanDraftPrefill(partial);
    expect(p.remainingPayments).toEqual({ value: null, confidence: null, source: null, lowConfidence: false });
    expect(p.lenderName.source).toBeNull();
  });
});

// A schedule to check against: $35,000 at 6.99% over 60 monthly
// payments from 2026-01-01 (the Phase 1 engine's verified case).
const SCHEDULE = buildSchedule({
  principalCents: toCents(35000),
  annualRatePct: 6.99,
  frequency: 'monthly',
  firstPaymentDate: '2026-01-01',
  numberOfPayments: 60,
});

describe('computeScheduleCheck', () => {
  const balanceAtNov15 = SCHEDULE.rows
    .filter((r) => r.date <= '2026-11-15')
    .pop()!.closingCents;

  test('exact match: the statement agrees with the schedule to the cent', () => {
    const check = computeScheduleCheck({
      rows: SCHEDULE.rows,
      principalCents: toCents(35000),
      statementDate: '2026-11-15',
      statementBalanceCents: balanceAtNov15,
    });
    expect(check.scheduleBalanceCents).toBe(balanceAtNov15);
    expect(check.differenceCents).toBe(0);
    expect(check.drift).toBe('match');
  });

  test('small drift: a few dollars of interest timing stays small', () => {
    const check = computeScheduleCheck({
      rows: SCHEDULE.rows,
      principalCents: toCents(35000),
      statementDate: '2026-11-15',
      statementBalanceCents: balanceAtNov15 + 325,
    });
    expect(check.differenceCents).toBe(325);
    expect(check.drift).toBe('small');
    expect(classifyDrift(SMALL_DRIFT_CENTS)).toBe('small');
    expect(classifyDrift(-SMALL_DRIFT_CENTS)).toBe('small');
  });

  test('large drift: a real divergence is named large, sign preserved', () => {
    const check = computeScheduleCheck({
      rows: SCHEDULE.rows,
      principalCents: toCents(35000),
      statementDate: '2026-11-15',
      statementBalanceCents: balanceAtNov15 - 25000,
    });
    expect(check.differenceCents).toBe(-25000);
    expect(check.drift).toBe('large');
    expect(classifyDrift(SMALL_DRIFT_CENTS + 1)).toBe('large');
  });

  test('the tail plan anchors on the last row due by the statement date', () => {
    const plan = planTailCorrection(SCHEDULE.rows, '2026-11-15');
    const anchor = SCHEDULE.rows.filter((r) => r.date <= '2026-11-15').pop()!;
    const firstTail = SCHEDULE.rows.find((r) => r.date > '2026-11-15')!;
    expect(plan.anchorPeriod).toBe(anchor.period);
    expect(plan.startPeriod).toBe(firstTail.period);
    expect(plan.firstTailDate).toBe(firstTail.date);
    expect(plan.regularPaymentCents).toBe(firstTail.paymentCents);
  });
});

describe('runLoanStatementExtraction (mocked db, fake providers)', () => {
  const statementRow = {
    id: 's1',
    companyId: 'c1',
    storageBackend: 'db',
    imageData: Buffer.from('fake-statement-bytes'),
    mimeType: 'application/pdf',
  };

  const succeedingProvider: LoanStatementOcrProvider = {
    id: 'fake-provider',
    isConfigured: () => true,
    extract: jest.fn(async () => EXTRACTION),
  };
  const failingProvider: LoanStatementOcrProvider = {
    id: 'fake-provider',
    isConfigured: () => true,
    extract: jest.fn(async () => {
      throw new Error('provider exploded');
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.loanStatement.findFirst.mockResolvedValue({ ...statementRow });
    mockDb.loanStatement.update.mockResolvedValue({});
  });

  test('extracted: the raw read is stored verbatim', async () => {
    const result = await runLoanStatementExtraction(
      { companyId: 'c1', statementId: 's1' },
      { provider: succeedingProvider },
    );
    expect(result).toEqual({ status: 'extracted', providerId: 'fake-provider', error: null });
    const update = mockDb.loanStatement.update.mock.calls[0][0];
    expect(update.data.extractionStatus).toBe('extracted');
    expect(update.data.extractionFields).toEqual(EXTRACTION);
  });

  test('unavailable: no provider configured — NO values are written at all', async () => {
    const result = await runLoanStatementExtraction(
      { companyId: 'c1', statementId: 's1' },
      { provider: null },
    );
    expect(result.status).toBe('unavailable');
    const update = mockDb.loanStatement.update.mock.calls[0][0];
    expect(update.data).toEqual({
      extractionStatus: 'unavailable',
      extractionProvider: null,
      extractionError: null,
    });
    expect(update.data.extractionFields).toBeUndefined();
  });

  test('failed: the error is recorded and no fields are written', async () => {
    const result = await runLoanStatementExtraction(
      { companyId: 'c1', statementId: 's1' },
      { provider: failingProvider },
    );
    expect(result.status).toBe('failed');
    const update = mockDb.loanStatement.update.mock.calls[0][0];
    expect(update.data.extractionStatus).toBe('failed');
    expect(update.data.extractionError).toMatch(/provider exploded/);
    expect(update.data.extractionFields).toBeUndefined();
  });
});

describe('applyStatementToLoan (mocked db)', () => {
  const statementBalanceCents = (() => {
    const at = SCHEDULE.rows.filter((r) => r.date <= '2026-11-15').pop()!;
    return at.closingCents + 12000; // statement says $120 MORE than the schedule
  })();

  const loanRow = {
    id: 'l1',
    companyId: 'c1',
    kind: 'term',
    lenderName: 'Ford Credit Canada',
    principal: 35000,
    annualRatePct: 6.99,
    compoundingPerYear: null,
    paymentFrequency: 'monthly',
    paymentAmount: 692.88,
    balloonAmount: null,
    payments: SCHEDULE.rows.map((r) => ({
      periodNumber: r.period,
      dueDate: new Date(`${r.date}T00:00:00.000Z`),
      openingBalance: r.openingCents / 100,
      paymentAmount: r.paymentCents / 100,
      interestPortion: r.interestCents / 100,
      principalPortion: r.principalCents / 100,
      closingBalance: r.closingCents / 100,
      status: 'scheduled',
    })),
  };

  const statementDbRow = {
    id: 's1',
    companyId: 'c1',
    extractionStatus: 'extracted',
    extractionFields: {
      ...EXTRACTION,
      currentBalance: { value: statementBalanceCents / 100, confidence: 0.92 },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.loanStatement.findFirst.mockResolvedValue({ ...statementDbRow });
    mockDb.loan.findFirst.mockImplementation(async () => ({
      ...loanRow,
      payments: loanRow.payments.map((p) => ({ ...p, dueDate: new Date(p.dueDate) })),
    }));
    mockDb.loan.update.mockResolvedValue({});
    mockDb.loanStatement.update.mockResolvedValue({});
    mockDb.loanPayment.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.loanPayment.createMany.mockResolvedValue({ count: 0 });
    mockDb.$transaction.mockImplementation(async (fn: any) =>
      fn({
        loan: mockDb.loan,
        loanPayment: mockDb.loanPayment,
        loanStatement: mockDb.loanStatement,
      }),
    );
  });

  test('preview check reports the difference without persisting anything', async () => {
    const preview = await computeStatementCheck('c1', 's1', 'l1');
    expect(preview.check.difference).toBe(120);
    expect(preview.check.drift).toBe('large');
    expect(preview.correction.available).toBe(true);
    expect(mockDb.loan.update).not.toHaveBeenCalled();
    expect(mockDb.loanStatement.update).not.toHaveBeenCalled();
  });

  test('apply without correction sets the statement leg and records the check only', async () => {
    const result = await applyStatementToLoan({
      companyId: 'c1',
      statementId: 's1',
      loanId: 'l1',
      acceptCorrection: false,
    });
    expect(result.correctionApplied).toBe(false);
    const loanUpdate = mockDb.loan.update.mock.calls[0][0];
    expect(loanUpdate.data.statementBalance).toBe(statementBalanceCents / 100);
    expect(loanUpdate.data.statementBalanceDate).toEqual(new Date('2026-11-15T00:00:00.000Z'));
    expect(mockDb.loanPayment.deleteMany).not.toHaveBeenCalled();
    const stUpdate = mockDb.loanStatement.update.mock.calls[0][0];
    expect(stUpdate.data.loanId).toBe('l1');
    expect(stUpdate.data.checkDifference).toBe(120);
    expect(stUpdate.data.correctionApplied).toBe(false);
  });

  test('apply with correction re-amortizes the tail from the statement balance', async () => {
    const result = await applyStatementToLoan({
      companyId: 'c1',
      statementId: 's1',
      loanId: 'l1',
      acceptCorrection: true,
    });
    expect(result.correctionApplied).toBe(true);

    const del = mockDb.loanPayment.deleteMany.mock.calls[0][0];
    expect(del.where.status).toBe('scheduled'); // posted rows are never deleted
    const anchor = SCHEDULE.rows.filter((r) => r.date <= '2026-11-15').pop()!;
    expect(del.where.periodNumber).toEqual({ gt: anchor.period });

    const created = mockDb.loanPayment.createMany.mock.calls[0][0].data;
    expect(created.length).toBeGreaterThan(0);
    // The rebuilt tail opens at the STATEMENT balance on the first
    // tail date and closes at exactly zero.
    expect(created[0].openingBalance).toBe(statementBalanceCents / 100);
    expect(created[0].periodNumber).toBe(anchor.period + 1);
    expect(created[created.length - 1].closingBalance).toBe(0);
  });
});
