// Pure rules of the S2.4 admin product list and the hide actions: the page size,
// the list query parser, the two href builders and the hide target parser. No
// database and no `server-only`, so a page, an action, the writer and a test
// share one copy; a 'use server' file may export only async functions, which is
// why these live here and not in the actions file. Names no hidden flag.

import { parsePageParam } from '../catalogue/page-param';
import { parseSearchTerm } from '../catalogue/search-query';

/** Products per page of the admin list. */
export const ADMIN_PRODUCTS_PAGE_SIZE = 50;

export type AdminProductListQuery = { term: string; hiddenOnly: boolean; page: number };

/**
 * The list's query string to its query. `q` is cleaned and cut by the public
 * search's rule, `ocultos` is on only for the text `1`, `pagina` follows the
 * public lists' rule (anything but a whole number above zero is page 1). Never
 * throws.
 */
export function parseAdminProductListQuery(params: {
  q?: string | string[];
  ocultos?: string | string[];
  pagina?: string | string[];
}): AdminProductListQuery {
  return {
    term: parseSearchTerm(params.q),
    hiddenOnly: params.ocultos === '1',
    page: parsePageParam(params.pagina),
  };
}

function queryString(query: AdminProductListQuery): string {
  const search = new URLSearchParams();
  if (query.term !== '') search.set('q', query.term);
  if (query.hiddenOnly) search.set('ocultos', '1');
  if (query.page > 1) search.set('pagina', String(query.page));
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** `/admin/productos` plus the query: `q` when non-empty, `ocultos=1` when on, `pagina` above 1. */
export function adminProductListHref(query: AdminProductListQuery): string {
  return `/admin/productos${queryString(query)}`;
}

/** `/admin/productos/<id>` plus the same query rule, so the product page can rebuild the way back (AC 31). */
export function adminProductHref(id: number, query: AdminProductListQuery): string {
  return `/admin/productos/${id}${queryString(query)}`;
}

export type HideTarget = 'hide' | 'unhide';

/** `hide` is true, `unhide` is false; anything else (absent, an array, other text) is null. */
export function parseHideTarget(raw: unknown): boolean | null {
  if (raw === 'hide') return true;
  if (raw === 'unhide') return false;
  return null;
}
