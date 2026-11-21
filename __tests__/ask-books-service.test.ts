/**
 * Phase 3 item 4 — ask your books: the service pipeline.
 *
 * Matcher first, LLM only on a miss, validation as the gate for both,
 * honest refusal with the library, and the audit trail — which must
 * record question + intent + parameters + source and NEVER an amount:
 * the sentinel figure an executor returns (987654.32) must not appear
 * anywhere in the audit record.
 */
import { answerQuestion, type AskAuditRecord } from '@/lib/ask/service';
import type { AskAnswer } from '@/lib/ask/executors';

const mockCompanyFindUnique = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    company: { findUnique: (...args: unknown[]) => mockCompanyFindUnique(...args) },
    askBooksQuery: { create: (...args: unknown[]) => mockAuditCreate(...args) },
  },
}));

const NOW = () => new Date('2026-11-20T15:00:00Z');
const SENTINEL = 987654.32;

function fakeAnswer(intentId: string): AskAnswer {
  return {
    intentId,
    title: 'Fake',
    headline: `The answer is $${SENTINEL}`,
    figures: [{ label: 'Sentinel figure', amount: SENTINEL }],
    rows: [],
    workings: 'Fake workings.',
    sourceReport: { label: 'Fake Report', href: '/reports/fake' },
  };
}

const fakeExecutors = (intentId: string) => ({
  [intentId]: async () => fakeAnswer(intentId),
});

function auditCapture() {
  const records: AskAuditRecord[] = [];
  return {
    records,
    writeAudit: async (record: AskAuditRecord) => {
      records.push(record);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompanyFindUnique.mockResolvedValue({
    currency: 'CAD',
    fiscalYearStart: new Date(2025, 9, 2),
    firstFiscalYearEnd: null,
  });
  mockAuditCreate.mockResolvedValue({});
});

describe('answerQuestion pipeline', () => {
  it('answers via the matcher without ever calling the LLM, and audits without amounts', async () => {
    const { records, writeAudit } = auditCapture();
    const llmSelect = jest.fn(async () => null);
    const response = await answerQuestion('co-1', 'user-1', 'How much cash do we have?', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect,
      writeAudit,
      now: NOW,
    });

    expect(response.status).toBe('answered');
    if (response.status === 'answered') expect(response.source).toBe('matcher');
    expect(llmSelect).not.toHaveBeenCalled();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      companyId: 'co-1',
      userId: 'user-1',
      question: 'How much cash do we have?',
      intentId: 'cash_by_account',
      source: 'matcher',
    });
    expect(JSON.stringify(records[0])).not.toContain('987654');
  });

  it('falls back to the LLM selector on a matcher miss', async () => {
    const { records, writeAudit } = auditCapture();
    const response = await answerQuestion('co-1', 'user-1', 'Show me the money picture', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect: async () => ({ intentId: 'cash_by_account', params: {} }),
      writeAudit,
      now: NOW,
    });
    expect(response.status).toBe('answered');
    if (response.status === 'answered') expect(response.source).toBe('llm');
    expect(records[0]).toMatchObject({ intentId: 'cash_by_account', source: 'llm' });
  });

  it('refuses with the full library when neither selector can ground the question', async () => {
    const { records, writeAudit } = auditCapture();
    const response = await answerQuestion('co-1', 'user-1', 'What is the meaning of life?', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect: async () => null,
      writeAudit,
      now: NOW,
    });
    expect(response.status).toBe('refused');
    if (response.status === 'refused') {
      expect(response.library).toHaveLength(10);
      expect(response.library.map((i) => i.id)).toContain('gst_position');
      for (const entry of response.library) expect(entry.examples.length).toBeGreaterThan(0);
      expect(response.message).toContain("can't answer that from the books");
    }
    expect(records[0]).toMatchObject({ intentId: null, source: 'none', paramsJson: null });
  });

  it('rejects hallucinated LLM selections: invented params and unknown intents', async () => {
    const { writeAudit } = auditCapture();
    const invented = await answerQuestion('co-1', 'user-1', 'Show me the money picture', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect: async () => ({ intentId: 'cash_by_account', params: { amount: 500 } }),
      writeAudit,
      now: NOW,
    });
    expect(invented.status).toBe('refused');

    const unknown = await answerQuestion('co-1', 'user-1', 'Show me the money picture', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect: async () => ({ intentId: 'predict_next_quarter', params: {} }),
      writeAudit,
      now: NOW,
    });
    expect(unknown.status).toBe('refused');
  });

  it('audit parameters carry the period and category — and nothing else', async () => {
    const { records, writeAudit } = auditCapture();
    const response = await answerQuestion('co-1', 'user-1', 'How much did we spend on fuel this quarter?', {
      executors: fakeExecutors('spend_by_category'),
      llmSelect: async () => null,
      writeAudit,
      now: NOW,
    });
    expect(response.status).toBe('answered');
    const params = JSON.parse(records[0].paramsJson as string);
    expect(params.category).toBe('fuel');
    expect(params.period).toMatchObject({ start: '2026-10-01', end: '2026-11-20' });
    expect(JSON.stringify(records[0])).not.toContain('987654');
  });

  it('an executor that cannot answer yet becomes an unavailable response with its reason', async () => {
    const { writeAudit } = auditCapture();
    const response = await answerQuestion('co-1', 'user-1', 'What is our GST/HST position this quarter?', {
      executorDeps: {
        computeGstReturn: (async () => {
          throw new Error('No GST/HST registration number on file');
        }) as never,
        assembleCcaRegisterExport: (async () => {
          throw new Error('unused');
        }) as never,
      },
      llmSelect: async () => null,
      writeAudit,
      now: NOW,
    });
    expect(response.status).toBe('unavailable');
    if (response.status === 'unavailable') {
      expect(response.intentId).toBe('gst_position');
      expect(response.message).toContain('No GST/HST registration number on file');
      expect(response.sourceReport.href).toBe('/reports/gst-hst-return');
    }
  });

  it('the default audit writer persists through the AskBooksQuery delegate', async () => {
    const response = await answerQuestion('co-1', 'user-1', 'How much cash do we have?', {
      executors: fakeExecutors('cash_by_account'),
      llmSelect: async () => null,
      now: NOW,
    });
    expect(response.status).toBe('answered');
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditCreate.mock.calls[0][0].data).toMatchObject({
      companyId: 'co-1',
      userId: 'user-1',
      question: 'How much cash do we have?',
      intentId: 'cash_by_account',
      source: 'matcher',
    });
  });
});
