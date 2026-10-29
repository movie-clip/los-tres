// The query parameter of the search page (S5.4). Pure: no server-only, no
// database, no environment. The part-number route reuses normalizePartNumber
// from ../matching in the loader; nothing here copies it.

export const SEARCH_TERM_MAX_LENGTH = 100;

/**
 * `?q` value to the cleaned term; '' means an empty query. Never throws.
 * In order: an array gives its first element and undefined gives ''; every C0
 * and C1 control character (NUL included, which PostgreSQL rejects) becomes a
 * space; trim and collapse runs of whitespace to one space; cut to 100 code
 * points, never UTF-16 units, so a surrogate pair is not split; trim again.
 */
export function parseSearchTerm(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return Array.from(cleaned).slice(0, SEARCH_TERM_MAX_LENGTH).join('').trim();
}

/**
 * The term with spaces, hyphens and dots removed, when what is left is exactly
 * 8 or 13 digits; else null. No check-digit test on purpose: stored
 * ean_normalised values are already valid, so equality is the check.
 */
export function eanCandidate(term: string): string | null {
  const digits = term.replace(/[\s.-]/g, '');
  return /^(\d{8}|\d{13})$/.test(digits) ? digits : null;
}
