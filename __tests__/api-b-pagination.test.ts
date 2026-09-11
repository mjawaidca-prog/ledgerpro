import { pageParamsFrom, cursorPage, prismaCursor, DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/api/pagination';

describe('api-b pagination', () => {
  test('limit defaults to 50 and is bounded to [1, 100]', () => {
    expect(pageParamsFrom(new URLSearchParams()).limit).toBe(DEFAULT_LIMIT);
    expect(pageParamsFrom(new URLSearchParams('limit=5000')).limit).toBe(MAX_LIMIT);
    expect(pageParamsFrom(new URLSearchParams('limit=0')).limit).toBe(1);
    expect(pageParamsFrom(new URLSearchParams('limit=-3')).limit).toBe(1);
    expect(pageParamsFrom(new URLSearchParams('limit=abc')).limit).toBe(DEFAULT_LIMIT);
    expect(pageParamsFrom(new URLSearchParams('limit=37')).limit).toBe(37);
  });

  test('invalid updatedAfter is ignored rather than failing the request', () => {
    const p = pageParamsFrom(new URLSearchParams('updatedAfter=not-a-date'));
    expect(p.updatedAfter).toBeNull();
    const p2 = pageParamsFrom(new URLSearchParams('updatedAfter=2026-09-01T00:00:00.000Z'));
    expect(p2.updatedAfter?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  test('cursor pages return at most limit rows and a stable nextCursor', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `row-${i}` }));
    // The route applies the cursor inside its fetch closure (prismaCursor);
    // mirror that contract here with a mutable cursor variable.
    let cursor: string | null = null;
    const fetch = jest.fn(async (take: number) => {
      const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
      return rows.slice(start, start + take);
    });

    const first = await cursorPage({ limit: 10, cursor, fetch });
    expect(first.data).toHaveLength(10);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.nextCursor).toBe('row-9');
    expect(fetch).toHaveBeenCalledWith(11);

    cursor = first.pagination.nextCursor;
    const second = await cursorPage({ limit: 10, cursor, fetch });
    expect(second.data.map((r) => r.id)).toEqual(rows.slice(10, 20).map((r) => r.id));
    expect(second.pagination.nextCursor).toBe('row-19');

    cursor = second.pagination.nextCursor;
    const last = await cursorPage({ limit: 10, cursor, fetch });
    expect(last.data).toHaveLength(5);
    expect(last.pagination.hasMore).toBe(false);
    expect(last.pagination.nextCursor).toBeNull();
  });

  test('prismaCursor passes opaque ids through untouched', () => {
    expect(prismaCursor(null)).toBeUndefined();
    expect(prismaCursor('abc')).toEqual({ id: 'abc' });
  });
});
