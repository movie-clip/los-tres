// Pure rules of the S3.1 network, shop and feed forms: limits, the slug rule,
// the reserved demo slugs, the id parser and the notice keys. No database, no
// feed URL and no `server-only`, so a page, a writer and a test share one copy.
// A 'use server' file may export only async functions, which is why these
// constants live here and not in the actions file.

/** Name length limit, in code points, counted after the trim. */
export const NAME_MAX = 120;
/** Slug length limit. */
export const SLUG_MAX = 64;
/** Feed address length limit, counted after the trim. */
export const FEED_URL_MAX = 2048;
/** Lowercase letters and digits, joined by single hyphens. Every seeded slug matches. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The seed's network slug: a form never creates it (D-12). */
export const RESERVED_NETWORK_SLUG = 'demo';
/** The seed's shop slugs begin with this: a form never creates one (D-12). */
export const RESERVED_SHOP_SLUG_PREFIX = 'tienda-demo-';

/** The notice keys `/admin/tiendas?aviso=` may carry after a write; any other value shows none. */
export const SOURCE_NOTICES = [
  'red-creada',
  'red-guardada',
  'tienda-creada',
  'tienda-guardada',
  'feed-creado',
  'feed-guardado',
  'feed-sin-aprobar',
] as const;

export type SourceNotice = (typeof SOURCE_NOTICES)[number];

export function isSourceNotice(value: unknown): value is SourceNotice {
  return typeof value === 'string' && (SOURCE_NOTICES as readonly string[]).includes(value);
}

/** Postgres `integer` ceiling: a larger id cannot name a row. */
const MAX_ID = 2_147_483_647;

/** A decimal id as a form sends it, or null for anything else (absent, blank, signed, padded, too large). */
export function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_ID ? id : null;
}

export type NameError = 'required' | 'too_long';
export type SlugError = 'required' | 'invalid' | 'too_long' | 'reserved';

/** The text of a form field, or '' when absent or not text. Not trimmed. */
export function textField(form: FormData, field: string): string {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw : '';
}

/** The trimmed name and its error, if any. Names need not be unique (D-17). */
export function checkName(raw: string): { value: string; error: NameError | null } {
  const value = raw.trim();
  if (value === '') return { value, error: 'required' };
  if ([...value].length > NAME_MAX) return { value, error: 'too_long' };
  return { value, error: null };
}

/**
 * The slug and its error, if any, in the order required, too_long, invalid,
 * reserved. "Taken" is the database's to say. The slug is not trimmed: a slug
 * with blank space around it is invalid, not silently repaired.
 */
export function checkSlug(raw: string, kind: 'network' | 'shop'): { value: string; error: SlugError | null } {
  if (raw.trim() === '') return { value: raw, error: 'required' };
  if (raw.length > SLUG_MAX) return { value: raw, error: 'too_long' };
  if (!SLUG_PATTERN.test(raw)) return { value: raw, error: 'invalid' };
  const reserved =
    kind === 'network' ? raw === RESERVED_NETWORK_SLUG : raw.startsWith(RESERVED_SHOP_SLUG_PREFIX);
  if (reserved) return { value: raw, error: 'reserved' };
  return { value: raw, error: null };
}
