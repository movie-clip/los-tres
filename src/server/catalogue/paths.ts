// Public catalogue paths and absolute URLs (S6.2). Pure: no server-only, no
// database, no environment.

import { DEFAULT_CATEGORY_SORT, sortParamValue, type CategorySort } from './category-query';

/** `/producto/<slug>`. The slug is assumed well-formed (isWellFormedSlug). */
export function productPath(slug: string): string {
  return `/producto/${slug}`;
}

/**
 * `/categoria/<slug>` for page 1, `/categoria/<slug>?pagina=<n>` for n > 1.
 * A page below 2 is the bare path, so `?pagina=1` has one canonical form.
 */
export function categoryPath(slug: string, page = 1): string {
  const base = `/categoria/${slug}`;
  return page > 1 ? `${base}?pagina=${page}` : base;
}

/**
 * A category listing link carrying its state: `marca`, `orden`, `pagina`, in
 * that order. A null brand, the default sort and a page below 2 are omitted, so
 * no state is the bare `/categoria/<slug>`. Not for canonical: that is
 * categoryPath, which never carries a brand or a sort.
 */
export function categoryListingPath(
  slug: string,
  state: { brand?: string | null; sort?: CategorySort; page?: number },
): string {
  const params = new URLSearchParams();
  if (state.brand) params.set('marca', state.brand);
  if (state.sort !== undefined && state.sort !== DEFAULT_CATEGORY_SORT) {
    params.set('orden', sortParamValue(state.sort));
  }
  if (state.page !== undefined && state.page > 1) params.set('pagina', String(state.page));
  const query = params.toString();
  const base = `/categoria/${slug}`;
  return query === '' ? base : `${base}?${query}`;
}

/** The search results page; also the `action` of every search form. */
export const SEARCH_PATH = '/buscar';

export type SearchLinkState = { term: string; page?: number };

/**
 * `/buscar` for an empty term, else `/buscar?q=<term>`, plus `&pagina=<n>` for
 * n > 1. The parameter order is `q`, then `pagina`; values are encoded by
 * URLSearchParams. The one builder of a search URL: no page writes one by hand.
 */
export function searchPath(state: SearchLinkState): string {
  const params = new URLSearchParams();
  if (state.term !== '') params.set('q', state.term);
  if (state.page !== undefined && state.page > 1) params.set('pagina', String(state.page));
  const query = params.toString();
  return query === '' ? SEARCH_PATH : `${SEARCH_PATH}?${query}`;
}

/** `origin + path`. `origin` has no trailing slash (`URL.origin`); `path` starts with `/`. */
export function absoluteUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}
