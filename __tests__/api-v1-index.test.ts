import { GET } from '@/app/api/v1/route';

describe('GET /api/v1 index', () => {
  test('is public and points at the OpenAPI document', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: 'LedgerPro API',
      version: 'v1',
      openapi: '/api/v1/openapi.json',
    });
    expect(res.headers.get('cache-control')).toContain('public');
  });
});
