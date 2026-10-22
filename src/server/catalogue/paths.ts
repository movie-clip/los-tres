// Public catalogue paths and absolute URLs (S6.2). Pure: no server-only, no
// database, no environment.

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

/** `origin + path`. `origin` has no trailing slash (`URL.origin`); `path` starts with `/`. */
export function absoluteUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}
