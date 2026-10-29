// Is a public catalogue URL a missing page? Used only by src/proxy.ts, which
// rewrites such a request to the root not-found so Next serves it as a full
// server-rendered 404 (S11.7). "Missing" is whatever the page's own loader says:
// this file adds no query and no visibility rule of its own (guardrail 1).

import { parseBrandParam, parseSortParam } from './category-query';
import { getPublicCategoryPage } from './category-page';
import { parsePageParam } from './page-param';
import { SEARCH_PATH } from './paths';
import { getPublicProductBySlug } from './product-page';
import { getPublicSearchPage } from './search-page';
import { parseSearchTerm } from './search-query';

type SearchParamValue = string | string[] | undefined;

/**
 * URL search params in the shape Next gives a page as `searchParams`: a key
 * absent is `undefined`, present once is a `string`, repeated is a `string[]`.
 * Pure, so a repeated `?pagina` parses here exactly as the page sees it.
 */
export function toSearchParamsShape(params: URLSearchParams): Record<string, SearchParamValue> {
  const shape: Record<string, SearchParamValue> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    shape[key] = values.length === 1 ? values[0] : values;
  }
  return shape;
}

const CATALOGUE_PATH = /^\/(producto|categoria)\/([^/]+)$/;

/**
 * True when `url` is `/producto/<slug>`, `/categoria/<slug>` or `/buscar` and the
 * page loader returns `null` for it (unknown, hidden, malformed, or a page or
 * brand listing past the last; for `/buscar`, a page past the last of a search).
 * Any other path is false, and so is a slug that does not decode: the page
 * decides those. May throw on a database error; the caller falls through to the
 * page. Nothing here logs or keeps the search term.
 */
export async function isMissingPublicPage(url: URL): Promise<boolean> {
  if (url.pathname === SEARCH_PATH) {
    const query = toSearchParamsShape(url.searchParams);
    const search = await getPublicSearchPage(parseSearchTerm(query.q), parsePageParam(query.pagina));
    return search === null;
  }

  const match = CATALOGUE_PATH.exec(url.pathname);
  if (!match) return false;

  let slug: string;
  try {
    slug = decodeURIComponent(match[2]);
  } catch {
    return false;
  }

  if (match[1] === 'producto') {
    return (await getPublicProductBySlug(slug)) === null;
  }

  const query = toSearchParamsShape(url.searchParams);
  const category = await getPublicCategoryPage(
    slug,
    parsePageParam(query.pagina),
    parseBrandParam(query.marca),
    parseSortParam(query.orden),
  );
  return category === null;
}
