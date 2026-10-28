// Product slugs (TD-30). Pure.

const MAX_LENGTH = 80;
const FALLBACK = 'producto';
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 120;

/**
 * Whether `slug` is a well-formed slug: lower-case ASCII words joined by single
 * hyphens, at most 120 characters. Public reads check it before any query.
 */
export function isWellFormedSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_FORMAT.test(slug);
}

/**
 * The shared slug transform: accents stripped, lower-cased, every run of
 * characters outside [a-z0-9] becomes one hyphen, trimmed, cut to `max`
 * characters and trimmed again. Empty when nothing is left; the caller decides
 * whether that is a fallback or an absence.
 */
export function toSlugWords(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * Lower-case ASCII slug of a title: accents stripped, every run of characters
 * outside [a-z0-9] becomes one hyphen, trimmed, at most 80 characters.
 * Falls back to `producto` when nothing is left.
 */
export function slugify(title: string): string {
  return toSlugWords(title, MAX_LENGTH) || FALLBACK;
}

/**
 * The first of `base`, `base-2`, `base-3`, ... that `isTaken` reports free.
 * The caller supplies the lookup, so this stays free of the database.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
