// Public API (v1) list conventions: bounded cursor pagination + the
// updatedAfter sync filter. Every list endpoint shares this so pagination
// and change-sync behave identically across resources.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface PageParams {
  limit: number;
  cursor: string | null;
  updatedAfter: Date | null;
}

export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export function pageParamsFrom(searchParams: URLSearchParams): PageParams {
  const rawLimit = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit))) : DEFAULT_LIMIT;

  const cursor = searchParams.get('cursor')?.trim() || null;
  const updatedAfterRaw = searchParams.get('updatedAfter');
  let updatedAfter: Date | null = null;
  if (updatedAfterRaw) {
    const parsed = new Date(updatedAfterRaw);
    if (!Number.isNaN(parsed.getTime())) updatedAfter = parsed;
  }
  return { limit, cursor, updatedAfter };
}

/**
 * Fetch one page with a stable cursor over an id-sorted query. Cursors are
 * opaque record ids — consumers pass back whatever nextCursor they received.
 */
export async function cursorPage<T extends { id: string }>(opts: {
  limit: number;
  cursor: string | null;
  // return limit+1 rows so hasMore can be decided without a second query
  fetch: (take: number) => Promise<T[]>;
}): Promise<{ data: T[]; pagination: PageMeta }> {
  const rows = await opts.fetch(opts.limit + 1);
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const nextCursor = hasMore && page.length ? page[page.length - 1].id : null;
  return { data: page, pagination: { nextCursor, hasMore } };
}

/** Prisma `cursor` input for id-ordered pages; null when starting fresh. */
export function prismaCursor(cursor: string | null): { id: string } | undefined {
  return cursor ? { id: cursor } : undefined;
}

/** The shared `updatedAt` range for change-sync filters (inclusive). */
export function updatedAtFilter(updatedAfter: Date | null): { updatedAt?: { gte: Date } } {
  return updatedAfter ? { updatedAt: { gte: updatedAfter } } : {};
}
