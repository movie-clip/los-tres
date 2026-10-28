// The query parameters of a category listing (S11.4): sort and brand. Pure: no
// server-only, no database, no environment.
//
// The code vocabulary is English; the public URL vocabulary is Spanish. The
// table below is the one place that maps them, and only the parser and the
// link builder read it.

import { toSlugWords } from '../slug';

export type CategorySort = 'price-asc' | 'price-desc' | 'name';

export const DEFAULT_CATEGORY_SORT: CategorySort = 'price-asc';

/** CategorySort to its public `orden` URL value. */
const SORT_URL_VALUES: Record<CategorySort, string> = {
  'price-asc': 'precio-asc',
  'price-desc': 'precio-desc',
  name: 'nombre',
};

const BRAND_SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BRAND_SLUG_MAX_LENGTH = 64;

/**
 * `?orden` value to a CategorySort. A single string equal to a URL value of
 * the table returns its sort; anything else (absent, repeated, empty, unknown,
 * other case) is the default. Never throws.
 */
export function parseSortParam(value: string | string[] | undefined): CategorySort {
  if (typeof value !== 'string') return DEFAULT_CATEGORY_SORT;
  for (const sort of Object.keys(SORT_URL_VALUES) as CategorySort[]) {
    if (SORT_URL_VALUES[sort] === value) return sort;
  }
  return DEFAULT_CATEGORY_SORT;
}

/** The `orden` URL value of a sort, for links and form options. */
export function sortParamValue(sort: CategorySort): string {
  return SORT_URL_VALUES[sort];
}

/**
 * `?marca` value to a brand slug, or null for no filter. A single string of
 * lower-case ASCII words joined by single hyphens, at most 64 characters, is
 * returned as it is; anything else (absent, repeated, empty, upper case, other
 * characters, too long) is null. Malformed is ignored, never an error. Never
 * throws.
 */
export function parseBrandParam(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > BRAND_SLUG_MAX_LENGTH || !BRAND_SLUG_FORMAT.test(value)) return null;
  return value;
}

/**
 * The public slug of a normalised brand (`products.brand_normalised`): the
 * shared slug transform cut to 64 characters, with no fallback. Null when
 * nothing is left, so such a brand has no chip.
 */
export function brandSlug(brandNormalised: string): string | null {
  return toSlugWords(brandNormalised, BRAND_SLUG_MAX_LENGTH) || null;
}
