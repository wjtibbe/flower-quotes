/**
 * Pure query-string builder for the Assortiment overview's pagination links
 * (`/products?page=2&pageSize=50&search=...`) - preserves every active
 * filter/search param while only changing `page`, so navigating between
 * pages never drops the user's current search/filter state (section C6).
 */

export interface AssortmentPageLinkParams {
  farmId?: string;
  product?: string;
  variety?: string;
  length?: string;
  box?: string;
  weight?: string;
  q?: string;
  pageSize?: string;
}

export function buildAssortmentPageHref(current: AssortmentPageLinkParams, page: number): string {
  const params = new URLSearchParams();
  if (current.farmId) params.set("farmId", current.farmId);
  if (current.product) params.set("product", current.product);
  if (current.variety) params.set("variety", current.variety);
  if (current.length) params.set("length", current.length);
  if (current.box) params.set("box", current.box);
  if (current.weight) params.set("weight", current.weight);
  if (current.q) params.set("q", current.q);
  if (current.pageSize) params.set("pageSize", current.pageSize);
  params.set("page", String(page));
  return `/products?${params.toString()}`;
}
