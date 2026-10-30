// The way back from the picker (S5.7, C4). Pure: no server-only, no database, no
// environment. `volver` is user input: it is accepted only as a same-site path.

import { withCar } from '../catalogue/paths';
import { selectedSlug, type CarContext } from './state';

const RETURN_MAX_LENGTH = 512;
const FAKE_ORIGIN = 'http://h.invalid';
// Pages a visitor never returns to, whatever `volver` says.
const REFUSED_PATHS = /^\/(go\/|api\/|admin)/;

/**
 * A `volver` value as a same-site path, or null. Null unless it is a single string
 * of 1 to 512 characters that starts with a single `/`, has no backslash and no
 * character below U+0021 or U+007F, and resolves against a throwaway origin
 * without leaving it or resolving to a `//` path. Also null for the picker itself, the
 * click redirect (`/go/`), the API (`/api/`) and the admin area (a path starting `/admin`).
 * Returns the resolved path and query (fragment dropped); `coche` is kept as given.
 */
export function parseReturnPath(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < 1 || raw.length > RETURN_MAX_LENGTH) return null;
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return null;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x21 || code === 0x7f || code === 0x5c) return null;
  }
  let url: URL;
  try {
    url = new URL(raw, FAKE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== FAKE_ORIGIN) return null;
  const { pathname } = url;
  // `/.//host` resolves to `//host`, which a redirect would read as another site.
  if (pathname.startsWith('//')) return null;
  if (pathname === '/mi-coche') return null;
  if (REFUSED_PATHS.test(pathname)) return null;
  return `${pathname}${url.search}`;
}

/** Where the picker sends the visitor: `returnTo` (or home) with `coche=<slug>` last. */
export function returnPath(returnTo: string | null, slug: string): string {
  return withCar(returnTo ?? '/', slug);
}

export type CarLinks = { select: string; change: string | null; remove: string | null };

/**
 * The no-script hrefs of the header control. `volver` is the current page with
 * the selected car, so a visitor who changes their mind returns to the same page.
 */
export function carLinks(car: CarContext): CarLinks {
  const volver =
    car.path === null ? null : `volver=${encodeURIComponent(withCar(car.path, selectedSlug(car)))}`;
  const select = volver === null ? '/mi-coche' : `/mi-coche?${volver}`;
  if (car.state !== 'selected') return { select, change: null, remove: null };
  const step = `marca=${encodeURIComponent(car.vehicle.makeSlug)}&modelo=${encodeURIComponent(car.vehicle.modelSlug)}`;
  return {
    select,
    change: `/mi-coche?${step}${volver === null ? '' : `&${volver}`}`,
    remove: car.path ?? '/',
  };
}
