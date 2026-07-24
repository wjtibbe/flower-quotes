/**
 * Pure, DB/React-free helpers for server-side pagination (Assortiment
 * overview): parsing the `page`/`pageSize` query params and resolving the
 * effective page/skip/take once the total matching row count is known.
 * Kept separate from any Prisma query so it's directly unit-testable and
 * reusable by any future paginated list.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;

export interface ResolvedPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  skip: number;
  take: number;
}

/** Parses a `?page=` query param - defaults to 1 for anything missing/invalid (not a positive integer). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Parses a `?pageSize=` query param - defaults to `DEFAULT_PAGE_SIZE` for anything not in `ALLOWED_PAGE_SIZES`. */
export function parsePageSizeParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/**
 * Resolves the actual page to serve once the total matching row count is
 * known: a requested page that no longer exists (e.g. a filter narrowed the
 * result set, or the count changed) safely falls back to page 1 rather than
 * showing an empty page. `totalPages` is always at least 1, even for zero
 * results, so pagination controls always have something sane to render.
 */
export function resolvePagination(requestedPage: number, pageSize: number, totalCount: number): ResolvedPagination {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = requestedPage >= 1 && requestedPage <= totalPages ? requestedPage : 1;
  return { page, pageSize, totalCount, totalPages, skip: (page - 1) * pageSize, take: pageSize };
}
