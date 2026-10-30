// The proxy side of the selected car (S5.7, C1). Pure: no server-only, no database,
// no environment. src/proxy.ts calls `carRequestHeaders`; src/server/car/context.ts
// is the only reader of the two headers. They are request headers only: no response
// header, no cookie, no log (guardrail 5).

import { isWellFormedSlug } from '../slug';

export const CAR_HEADER = 'x-car-slug';
export const PATH_HEADER = 'x-car-path';

/** The `x-car-slug` value for a `coche` that is empty, malformed or repeated. Never slug-shaped. */
export const CAR_UNRECOGNISED = '-';

const PATH_MAX_LENGTH = 512;

/**
 * Whether `value` can travel as the forwarded path: 1 to 512 printable ASCII
 * characters, starting with a single `/`, no backslash.
 */
export function isForwardablePath(value: string): boolean {
  if (value.length < 1 || value.length > PATH_MAX_LENGTH) return false;
  if (value[0] !== '/' || value[1] === '/') return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e || code === 0x5c) return false;
  }
  return true;
}

/**
 * A copy of `incoming` for the page request: both car headers deleted first, so a
 * client cannot inject them, then set from `url`.
 *
 * - `x-car-slug`: absent without a `coche`; the value when exactly one is
 *   present and a well-formed slug; `-` otherwise.
 * - `x-car-path`: path and query with every `coche` removed (parameter order
 *   kept), absent when it would not fit `isForwardablePath`.
 */
export function carRequestHeaders(url: URL, incoming: Headers): Headers {
  const headers = new Headers(incoming);
  headers.delete(CAR_HEADER);
  headers.delete(PATH_HEADER);

  const values = url.searchParams.getAll('coche');
  if (values.length > 0) {
    const [only] = values;
    headers.set(CAR_HEADER, values.length === 1 && isWellFormedSlug(only) ? only : CAR_UNRECOGNISED);
  }

  const rest = new URLSearchParams(url.searchParams);
  rest.delete('coche');
  const query = rest.toString();
  const path = query === '' ? url.pathname : `${url.pathname}?${query}`;
  if (isForwardablePath(path)) headers.set(PATH_HEADER, path);
  return headers;
}

export type ForwardedCar =
  | { kind: 'none' }
  | { kind: 'slug'; slug: string }
  | { kind: 'invalid' };

/** Reads the `x-car-slug` value the proxy set. Anything unexpected is `invalid`. */
export function readForwardedCar(value: string | null): ForwardedCar {
  if (value === null) return { kind: 'none' };
  if (isWellFormedSlug(value)) return { kind: 'slug', slug: value };
  return { kind: 'invalid' };
}

/** Reads the `x-car-path` value the proxy set; null when absent or unusable. */
export function readForwardedPath(value: string | null): string | null {
  return value !== null && isForwardablePath(value) ? value : null;
}
