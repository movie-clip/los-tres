// Product slugs (TD-30). Pure.

const MAX_LENGTH = 80;
const FALLBACK = 'producto';

/**
 * Lower-case ASCII slug of a title: accents stripped, every run of characters
 * outside [a-z0-9] becomes one hyphen, trimmed, at most 80 characters.
 * Falls back to `producto` when nothing is left.
 */
export function slugify(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, '');
  return base || FALLBACK;
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
