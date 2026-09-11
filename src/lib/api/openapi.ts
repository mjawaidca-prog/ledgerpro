// The OpenAPI 3.0 document for the public API, served at /api/v1/openapi.json
// and mirrored in the API-E stage document. This is the endpoint reference —
// every v1 route must appear here.

const money = { type: 'string', description: 'Decimal string with explicit precision (e.g. "100.50", rate "0.130", FX "1.34567890").' };
const pagination = {
  type: 'object',
  properties: {
    nextCursor: { type: ['string', 'null'], description: 'Opaque cursor for the next page; null when the list is exhausted.' },
    hasMore: { type: 'boolean' },
  },
};
const errorEnvelope = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Stable machine-readable code, e.g. invalid_api_key, rate_limited, validation_error.' },
        message: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Field-level errors (validation_error only).' },
        retryAfterSeconds: { type: 'number', description: 'Rate-limit windows only.' },
      },
      required: ['code', 'message'],
    },
  },
};

export function openapiDocument(): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'LedgerPro API',
      version: 'v1',
      description:
        'Versioned public API for LedgerPro accounting. Financial values are decimal strings with explicit currencies; reports carry their reporting period, accounting basis and generation time. Versioning policy: v1 is stable; breaking changes arrive as a new major version with a documented deprecation period.',
    },
    servers: [{ url: 'https://ledger.nexvarlab.com/api/v1' }],
    security: [{ apiKey: [] }],
    paths: {
      '/company': {
        get: { operationId: 'getCompany', summary: 'Company profile', responses: { '200': { description: 'Company profile' } } },
      },
      '/accounts': {
        get: {
          operationId: 'listAccounts',
          summary: 'Chart of accounts',
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'] } },
            { name: 'active', in: 'query', schema: { type: 'string', enum: ['0', '1'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Accounts with pagination' } },
        },
      },
      '/contacts': {
        get: {
          operationId: 'listContacts',
          summary: 'Customers and vendors',
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['customer', 'supplier'] } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Contacts' } },
        },
        post: {
          operationId: 'createContact',
          summary: 'Create a customer or vendor (write_draft)',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Created' } },
        },
      },
      '/contacts/{id}': {
        get: { operationId: 'getContact', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Contact' }, '404': { description: 'not_found' } } },
        patch: {
          operationId: 'updateContact',
          summary: 'Update a contact (write_draft)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated' } },
        },
      },
      '/invoices': {
        get: {
          operationId: 'listInvoices',
          summary: 'Invoices with line items (voided included for sync)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'sent', 'paid', 'overdue', 'void'] } },
            { name: 'customerId', in: 'query', schema: { type: 'string' } },
            { name: 'issueFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'issueTo', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Invoices' } },
        },
        post: {
          operationId: 'createInvoice',
          summary: 'Create a DRAFT invoice (write_draft). Foreign-currency drafts require fxRate.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Draft invoice' } },
        },
      },
      '/invoices/{id}': {
        get: { operationId: 'getInvoice', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Invoice' }, '404': { description: 'not_found' } } },
      },
      '/invoices/{id}/post': {
        post: {
          operationId: 'postInvoice',
          summary: 'Post a draft through the reviewed-tax engine (write_posting). Body: { requestKey, lines: [{ lineIndex, taxCodeVersionId, jurisdictionEvidence }] }.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Posted with server-computed totals' }, '409': { description: 'document_not_draft | closed_period' } },
        },
      },
      '/invoices/{id}/void': {
        post: {
          operationId: 'voidInvoice',
          summary: 'Void a draft (deleted) or posted invoice (tax-posting reversal; unreversed payments block it).',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Voided' }, '409': { description: 'tax_settlement_reversal_required' } },
        },
      },
      '/bills': {
        get: {
          operationId: 'listBills',
          summary: 'Bills with line items',
          parameters: [
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['bill', 'expense'] } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'vendorId', in: 'query', schema: { type: 'string' } },
            { name: 'billFrom', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'billTo', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Bills' } },
        },
        post: {
          operationId: 'createBill',
          summary: 'Create a DRAFT bill (write_draft).',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Draft bill' } },
        },
      },
      '/bills/{id}': {
        get: { operationId: 'getBill', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Bill' }, '404': { description: 'not_found' } } },
      },
      '/bills/{id}/post': {
        post: {
          operationId: 'postBill',
          summary: 'Post a draft bill through the reviewed-tax engine (write_posting).',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Posted' } },
        },
      },
      '/bills/{id}/void': {
        post: {
          operationId: 'voidBill',
          summary: 'Void a draft or posted bill (write_posting).',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Voided' } },
        },
      },
      '/payments': {
        get: {
          operationId: 'listPayments',
          summary: 'Recorded payments (payment journal entries with GL lines). Sync via createdAfter.',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'createdAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Payments' } },
        },
        post: {
          operationId: 'recordPayment',
          summary: 'Record a payment already made externally (write_posting). Body: { documentType, documentId, amount, paymentDate, paymentAccountId, settlementRate? }.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Recorded' }, '409': { description: 'document_not_posted | closed_period' } },
        },
      },
      '/payments/{id}/reverse': {
        post: {
          operationId: 'reversePayment',
          summary: 'Reverse one recorded payment with synchronized balances (write_posting).',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Reversed' } },
        },
      },
      '/transactions': {
        get: {
          operationId: 'listTransactions',
          summary: 'Bank and card transactions',
          parameters: [
            { name: 'financialAccountId', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Transactions' } },
        },
      },
      '/journal-entries': {
        get: {
          operationId: 'listJournalEntries',
          summary: 'The general journal with GL lines',
          parameters: [
            { name: 'sourceType', in: 'query', schema: { type: 'string', enum: ['invoice', 'bill', 'payment', 'transfer', 'manual', 'revaluation'] } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'createdAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Journal entries' } },
        },
        post: {
          operationId: 'createJournalEntry',
          summary: 'Create and post a balanced journal (write_posting).',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Posted' }, '400': { description: 'journal_unbalanced | invalid_account' } },
        },
      },
      '/journal-entries/{id}': {
        get: { operationId: 'getJournalEntry', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Journal entry' } } },
      },
      '/journal-entries/{id}/void': {
        post: {
          operationId: 'voidJournalEntry',
          summary: 'Void a posted journal entry with an equal-and-opposite reversal.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Voided' } },
        },
      },
      '/tax-codes': {
        get: {
          operationId: 'listTaxCodes',
          summary: 'Active tax codes with APPROVED versions and component rates',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'updatedAfter', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Tax codes' } },
        },
      },
      '/reports/trial-balance': {
        get: {
          operationId: 'trialBalance',
          summary: 'Trial balance as of a date (report rate limits apply).',
          parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }],
          responses: { '200': { description: 'Rows with debit/credit decimal strings + meta' } },
        },
      },
      '/reports/balance-sheet': {
        get: { operationId: 'balanceSheet', summary: 'Balance sheet as of a date.', parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { '200': { description: 'Sections + meta' } } },
      },
      '/reports/profit-loss': {
        get: {
          operationId: 'profitLoss',
          summary: 'P&L over a period (from defaults to the fiscal-year start).',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { '200': { description: 'Sections + meta' } },
        },
      },
      '/reports/ar-aging': {
        get: { operationId: 'arAging', summary: 'AR aging buckets as of a date.', parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { '200': { description: 'Buckets + meta' } } },
      },
      '/reports/ap-aging': {
        get: { operationId: 'apAging', summary: 'AP aging buckets as of a date.', parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { '200': { description: 'Buckets + meta' } } },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key created in Settings → Developer / API Access. Format: lp_live_ + 32 hex chars.',
        },
      },
      schemas: {
        Money: money,
        Pagination: pagination,
        Error: errorEnvelope,
        WebhookSignature: {
          type: 'object',
          description:
            'Webhook verification: HMAC-SHA256 over `${x-ledgerpro-timestamp}.${raw body}` compared to x-ledgerpro-signature (sha256=hex). Dedupe on x-ledgerpro-event-id. Retries use the same event id.',
          properties: {
            'x-ledgerpro-event': { type: 'string' },
            'x-ledgerpro-event-id': { type: 'string' },
            'x-ledgerpro-timestamp': { type: 'string' },
            'x-ledgerpro-signature': { type: 'string' },
          },
        },
      },
    },
  };
}
