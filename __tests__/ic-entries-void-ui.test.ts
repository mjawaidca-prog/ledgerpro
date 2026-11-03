/**
 * Void UI on the inter-company entries page.
 *
 * This repo has NO component/DOM test pattern (jest testEnvironment is
 * 'node', no @testing-library, no *.test.tsx anywhere), so coverage here is
 * the pure logic the component is built on — eligibility, the confirmation
 * summary content, and the POST the confirm button issues (mocked fetch).
 */
import {
  canVoid,
  voidEndpoint,
  voidConfirmSummary,
  formatVoidAmount,
  postVoid,
  type VoidableTransaction,
} from '@/app/intercompany/entries/void-helpers';

const posted: VoidableTransaction = {
  id: 'txn_123',
  reference: 'IC-0005',
  date: '2026-11-02',
  amount: '12500',
  currency: 'CAD',
  status: 'POSTED',
  sourceCompanyName: 'Muja Corporation',
  targetCompanyName: 'Agha Brothers Ltd.',
};

describe('canVoid — Void action eligibility', () => {
  it('is true only for POSTED transactions', () => {
    expect(canVoid('POSTED')).toBe(true);
    expect(canVoid('VOIDED')).toBe(false);
    expect(canVoid('UNMATCHED')).toBe(false);
  });
});

describe('voidConfirmSummary — panel names the pair being reversed', () => {
  it('contains the reference, both company names, amount + currency, and date', () => {
    const summary = voidConfirmSummary(posted);
    expect(summary).toContain('IC-0005');
    expect(summary).toContain('Muja Corporation');
    expect(summary).toContain('Agha Brothers Ltd.');
    expect(summary).toContain('12,500.00 CAD');
    expect(summary).toContain('2026-11-02');
  });

  it('states plainly that both entries reverse together and the pair is marked VOIDED', () => {
    const summary = voidConfirmSummary(posted);
    expect(summary).toContain("Both companies' entries will be reversed together");
    expect(summary).toContain('VOIDED');
  });
});

describe('formatVoidAmount', () => {
  it('formats with en-CA grouping and appends the currency', () => {
    expect(formatVoidAmount('12500', 'CAD')).toBe('12,500.00 CAD');
    expect(formatVoidAmount('99.5', 'USD')).toBe('99.50 USD');
  });

  it('falls back to CAD when currency is empty', () => {
    expect(formatVoidAmount('10', '')).toBe('10.00 CAD');
  });
});

describe('postVoid — the confirm action', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs an empty JSON body to the transaction void endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    global.fetch = fetchMock as any;

    await postVoid('txn_123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/intercompany/transactions/txn_123/void');
    expect(url).toBe(voidEndpoint('txn_123'));
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({});
  });

  it('throws the server error message on failure so the panel can show it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Transaction has already been voided' }),
    }) as any;

    await expect(postVoid('txn_123')).rejects.toThrow('Transaction has already been voided');
  });

  it('throws a fallback message when the error body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => { throw new Error('not json'); },
    }) as any;

    await expect(postVoid('txn_123')).rejects.toThrow('Failed to void inter-company transaction');
  });
});
