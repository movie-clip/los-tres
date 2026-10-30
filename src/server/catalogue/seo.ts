// The one rule for canonical and robots metadata (S6.2). Pure: no server-only,
// no database, no environment. A page spreads the result into its
// generateMetadata return.

import type { CarContext } from '../car/state';
import { absoluteUrl } from './paths';

export type PageSeo = {
  alternates?: { canonical: string };
  robots?: { index: false };
};

/**
 * - not indexable: `{ robots: { index: false } }`, never a canonical;
 * - indexable, no public origin configured: `{}`;
 * - indexable, origin set: `{ alternates: { canonical: <origin><path> } }`.
 * Links on a noindex page stay followed.
 */
export function pageSeo(origin: string | null, path: string, indexable: boolean): PageSeo {
  if (!indexable) return { robots: { index: false } };
  if (origin === null) return {};
  return { alternates: { canonical: absoluteUrl(origin, path) } };
}

/**
 * A page opened with `coche` in its URL (S5.7) is not indexed, whatever the car
 * state: `{ robots: { index: false } }`, else `{}`. For a page whose own metadata
 * has no canonical (the legal pages); the others fold it into `pageSeo`.
 */
export function noindexWhenCar(car: CarContext): PageSeo {
  return car.state === 'none' ? {} : { robots: { index: false } };
}
