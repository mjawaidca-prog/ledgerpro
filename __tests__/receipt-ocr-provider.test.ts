/**
 * Phase 2 item 2 — the Azure Document Intelligence provider.
 *
 * Pins three things without any network:
 *  1. The response mapper: Azure's prebuilt-receipt fields land in the
 *     provider-neutral shape with the model's confidences untouched,
 *     and fields the model did not return stay null (never invented).
 *  2. The network path against a fake fetch: submit → 202 +
 *     Operation-Location → poll → succeeded, with the right URL,
 *     headers and api-version.
 *  3. Configuration: no env → no provider (the pipeline's
 *     'unavailable' state depends on this).
 */
import {
  createAzureDocumentIntelligenceProvider,
  createAzureProviderFromEnv,
  mapAzureAnalyzeResult,
  AZURE_DI_PROVIDER_ID,
} from '@/lib/receipts/azure-document-intelligence';
import { resolveReceiptOcrProvider } from '@/lib/receipts/ocr-provider';

const AZURE_RESULT = {
  status: 'succeeded',
  analyzeResult: {
    documents: [
      {
        docType: 'receipt.retail',
        confidence: 0.95,
        fields: {
          MerchantName: { type: 'string', valueString: 'STAPLES', content: 'STAPLES', confidence: 0.97 },
          TransactionDate: { type: 'date', valueDate: '2026-10-15', content: '10/15/2026', confidence: 0.99 },
          Subtotal: {
            type: 'currency',
            valueCurrency: { amount: 5.28, currencyCode: 'CAD' },
            confidence: 0.93,
          },
          TotalTax: {
            type: 'currency',
            valueCurrency: { amount: 0.26, currencyCode: 'CAD' },
            confidence: 0.88,
          },
          Total: {
            type: 'currency',
            valueCurrency: { amount: 5.54, currencyCode: 'CAD' },
            confidence: 0.96,
          },
          Items: {
            type: 'array',
            valueArray: [
              {
                type: 'object',
                valueObject: {
                  Description: { type: 'string', valueString: 'Copy Paper', confidence: 0.9 },
                  Quantity: { type: 'number', valueNumber: 1, confidence: 0.95 },
                  TotalPrice: {
                    type: 'currency',
                    valueCurrency: { amount: 5.28, currencyCode: 'CAD' },
                    confidence: 0.91,
                  },
                },
              },
            ],
          },
        },
      },
    ],
  },
};

describe('mapAzureAnalyzeResult', () => {
  test('maps the prebuilt-receipt fields with confidences passed through untouched', () => {
    const x = mapAzureAnalyzeResult(AZURE_RESULT);
    expect(x.vendor).toEqual({ value: 'STAPLES', confidence: 0.97 });
    expect(x.date).toEqual({ value: '2026-10-15', confidence: 0.99 });
    expect(x.subtotal).toEqual({ value: 5.28, confidence: 0.93 });
    expect(x.taxAmount).toEqual({ value: 0.26, confidence: 0.88 });
    expect(x.total).toEqual({ value: 5.54, confidence: 0.96 });
    expect(x.currency.value).toBe('CAD');
    expect(x.lineItems).toHaveLength(1);
    expect(x.lineItems[0]).toMatchObject({ description: 'Copy Paper', quantity: 1, amount: 5.28 });
  });

  test('fields the model did not return stay null — nothing is invented', () => {
    const sparse = {
      analyzeResult: {
        documents: [
          {
            confidence: 0.5,
            fields: {
              Total: { type: 'currency', valueCurrency: { amount: 12.0, currencyCode: 'USD' }, confidence: 0.8 },
            },
          },
        ],
      },
    };
    const x = mapAzureAnalyzeResult(sparse);
    expect(x.total.value).toBe(12);
    expect(x.vendor).toEqual({ value: null, confidence: null });
    expect(x.date).toEqual({ value: null, confidence: null });
    expect(x.subtotal.value).toBeNull();
    expect(x.taxAmount.value).toBeNull();
    expect(x.lineItems).toEqual([]);
    expect(x.currency.value).toBe('USD');
  });

  test('tax falls back to the sum of TaxDetails when TotalTax is absent', () => {
    const withDetails = {
      analyzeResult: {
        documents: [
          {
            confidence: 0.9,
            fields: {
              TaxDetails: {
                type: 'array',
                valueArray: [
                  { type: 'object', valueObject: { Amount: { type: 'currency', valueCurrency: { amount: 0.5, currencyCode: 'CAD' }, confidence: 0.9 } } },
                  { type: 'object', valueObject: { Amount: { type: 'currency', valueCurrency: { amount: 0.78, currencyCode: 'CAD' }, confidence: 0.7 } } },
                ],
              },
            },
          },
        ],
      },
    };
    const x = mapAzureAnalyzeResult(withDetails);
    expect(x.taxAmount.value).toBe(1.28);
    // The sum is only as trustworthy as its weakest part.
    expect(x.taxAmount.confidence).toBe(0.7);
  });

  test('an empty or document-less result maps to an all-null extraction', () => {
    expect(mapAzureAnalyzeResult({ analyzeResult: { documents: [] } }).total.value).toBeNull();
    expect(mapAzureAnalyzeResult({}).vendor.value).toBeNull();
    expect(mapAzureAnalyzeResult(null).lineItems).toEqual([]);
  });
});

describe('Azure provider — network path against a fake fetch', () => {
  test('submits the document bytes, polls the operation, and returns the mapped read', async () => {
    const calls: { url: string; init: any }[] = [];
    const fakeFetch = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 202,
          headers: { get: (n: string) => (n === 'Operation-Location' ? 'https://di.example/operations/1' : null) },
          json: async () => ({}),
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => AZURE_RESULT,
        text: async () => '',
      };
    });

    const provider = createAzureDocumentIntelligenceProvider({
      endpoint: 'https://di.example/',
      key: 'secret-key',
      fetchImpl: fakeFetch as any,
      pollIntervalMs: 1,
    });
    expect(provider.id).toBe(AZURE_DI_PROVIDER_ID);
    expect(provider.isConfigured()).toBe(true);

    const x = await provider.extract({ buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' });
    expect(x.vendor.value).toBe('STAPLES');
    expect(x.total.value).toBe(5.54);

    expect(calls[0].url).toBe(
      'https://di.example/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30',
    );
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Ocp-Apim-Subscription-Key']).toBe('secret-key');
    expect(calls[0].init.headers['Content-Type']).toBe('image/jpeg');
    expect(calls[1].url).toBe('https://di.example/operations/1');
  });

  test('a non-202 submit is an error, and WebP is refused before any call', async () => {
    const rejectingFetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => 'bad key',
    }));
    const provider = createAzureDocumentIntelligenceProvider({
      endpoint: 'https://di.example',
      key: 'k',
      fetchImpl: rejectingFetch as any,
      pollIntervalMs: 1,
    });
    await expect(provider.extract({ buffer: Buffer.from('x'), mimeType: 'image/png' })).rejects.toThrow(/401/);

    const neverFetch = jest.fn();
    const webpProvider = createAzureDocumentIntelligenceProvider({
      endpoint: 'https://di.example',
      key: 'k',
      fetchImpl: neverFetch as any,
    });
    await expect(webpProvider.extract({ buffer: Buffer.from('x'), mimeType: 'image/webp' })).rejects.toThrow(/cannot read/);
    expect(neverFetch).not.toHaveBeenCalled();
  });
});

describe('provider configuration from env', () => {
  test('no env → no provider; both variables → the Azure provider', () => {
    expect(createAzureProviderFromEnv({})).toBeNull();
    expect(createAzureProviderFromEnv({ AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://di.example' })).toBeNull();
    expect(createAzureProviderFromEnv({ AZURE_DOCUMENT_INTELLIGENCE_KEY: 'k' })).toBeNull();

    const provider = createAzureProviderFromEnv({
      AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://di.example',
      AZURE_DOCUMENT_INTELLIGENCE_KEY: 'k',
    });
    expect(provider?.id).toBe(AZURE_DI_PROVIDER_ID);
    expect(provider?.isConfigured()).toBe(true);

    expect(resolveReceiptOcrProvider({})).toBeNull();
    expect(
      resolveReceiptOcrProvider({
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: 'https://di.example',
        AZURE_DOCUMENT_INTELLIGENCE_KEY: 'k',
      })?.id,
    ).toBe(AZURE_DI_PROVIDER_ID);
  });
});
