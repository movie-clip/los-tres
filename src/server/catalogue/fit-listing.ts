import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { products } from '../../db/schema';
import { fitStateSql, type FitState } from './fit-state';

// The shared pieces of a car-aware listing (S5.8). A listing builds one derived
// table of `products.id` and its fit state, joins it into its own queries and
// orders, counts and filters on the `fit` column, so the group of every product
// is known before LIMIT. Which fitments count is decided in visibility.ts and
// turned into a state by fit-state.ts; this file names no flag and no fitment
// condition, it only composes the state. It writes nothing and logs nothing: the
// vehicle id is a bound parameter only (guardrail 5).

/** Which group a listed card belongs to under a selected car. */
export type ListingGroup = 'fits' | 'unknown' | 'no-fit-exact';

/** The `fit` column of a fit scope, or any SQL that yields a FitState. */
export type FitColumn = SQL | SQL.Aliased<FitState>;

/**
 * Derived table `fit_scope(id, fit)`: every product matching `where` and the
 * fit state of each for this vehicle, evaluated once per product per query.
 * `where` is the caller's scope; it carries the visibility conditions.
 */
export function fitScope(vehicleId: number, where: SQL | undefined) {
  return getDb()
    .select({ id: products.id, fit: fitStateSql(vehicleId).as('fit') })
    .from(products)
    .where(where)
    .as('fit_scope');
}

/**
 * Sort key: fits 0, unknown 1, no-fit 2. With `exact` (search, S5.8 D-1): fits 0,
 * unknown 1, no-fit listed by an exact code 2, any other no-fit 3. `exact` must be
 * a non-null boolean, so the caller wraps its code match in `coalesce(..., false)`.
 */
export function groupRankSql(fit: FitColumn, exact?: SQL): SQL<number> {
  if (exact === undefined) {
    return sql<number>`case when ${fit} = 'fits' then 0 when ${fit} = 'unknown' then 1 else 2 end`;
  }
  return sql<number>`case when ${fit} = 'fits' then 0 when ${fit} = 'unknown' then 1 when ${exact} then 2 else 3 end`;
}

/** `fit <> 'no-fit'`: the product is listed under a car. */
export function listedFitSql(fit: FitColumn): SQL<boolean> {
  return sql<boolean>`${fit} <> 'no-fit'`;
}

/**
 * The counts of a listed scope, as columns of one aggregate select: fits, unknown
 * and left out. With `exact` (search, S5.8 D-1) a no-fit product matched by an exact
 * code is counted in `exactNoFitCount` and not in `leftOutCount`, so the four sum to
 * the scope. `exact` must be a non-null boolean (`coalesce(..., false)`): a null
 * inside `not exact` would drop rows from the left-out filter.
 */
export function fitCountsSql(fit: FitColumn): {
  fitsCount: SQL<number>;
  unknownCount: SQL<number>;
  leftOutCount: SQL<number>;
};
export function fitCountsSql(
  fit: FitColumn,
  exact: SQL,
): {
  fitsCount: SQL<number>;
  unknownCount: SQL<number>;
  leftOutCount: SQL<number>;
  exactNoFitCount: SQL<number>;
};
export function fitCountsSql(fit: FitColumn, exact?: SQL) {
  const fitsCount = sql<number>`count(*) filter (where ${fit} = 'fits')::int`;
  const unknownCount = sql<number>`count(*) filter (where ${fit} = 'unknown')::int`;
  if (exact === undefined) {
    return {
      fitsCount,
      unknownCount,
      leftOutCount: sql<number>`count(*) filter (where ${fit} = 'no-fit')::int`,
    };
  }
  return {
    fitsCount,
    unknownCount,
    leftOutCount: sql<number>`count(*) filter (where ${fit} = 'no-fit' and not ${exact})::int`,
    exactNoFitCount: sql<number>`count(*) filter (where ${fit} = 'no-fit' and ${exact})::int`,
  };
}

/**
 * A listed category card's group from its fit state. A no-fit product is never
 * listed there (the query filters it), so one reaching here is a fault, not a
 * group to invent.
 */
export function listingGroupOf(fit: FitState): ListingGroup {
  if (fit === 'no-fit') throw new Error('fit-listing: no-fit card');
  return fit;
}
