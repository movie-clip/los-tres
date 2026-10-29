import 'server-only';

import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { getDb } from '../../db/client';
import { feeds, fitments, products, shops, vehicles } from '../../db/schema';
import { activeVehicleWhere, countedFitmentWhere } from '../visibility';

// The fit-state question of the car filter (S5.5, docs/product/vehicle-fitment.md).
// Which fitments count is decided in visibility.ts (countedFitmentWhere); this
// file names no approval, hidden or review flag. It returns states, never
// product data, and the product scope still decides what is public. It writes
// nothing and logs nothing about the vehicle or the products it is asked about
// (guardrail 5).

export type FitState = 'fits' | 'no-fit' | 'unknown';

/** The counted fitments of `products.id`, optionally to one vehicle. */
function countedFitmentOf(vehicleId?: number) {
  const condition =
    vehicleId === undefined
      ? and(eq(fitments.productId, products.id), countedFitmentWhere())
      : and(
          eq(fitments.productId, products.id),
          eq(fitments.vehicleId, vehicleId),
          countedFitmentWhere(),
        );
  return new QueryBuilder()
    .select({ one: sql`1` })
    .from(fitments)
    .innerJoin(feeds, eq(fitments.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .innerJoin(vehicles, eq(fitments.vehicleId, vehicles.id))
    .where(condition);
}

/**
 * SQL expression over `products` (correlated on `products.id`), composable in
 * any listing query: `fits` when a counted fitment of the product to this
 * vehicle exists; `no-fit` when the product has counted fitments and none to
 * it; `unknown` when it has none. Two index probes per product on the fitments
 * unique index prefix. The caller passes a vehicle id it got from
 * `findActiveVehicle`.
 */
export function fitStateSql(vehicleId: number): SQL<FitState> {
  return sql<FitState>`case when ${exists(countedFitmentOf(vehicleId))} then 'fits' when ${exists(countedFitmentOf())} then 'no-fit' else 'unknown' end`;
}

/** Fixed error: a Drizzle error message embeds its bound params (the slug, the ids). */
function failed(): Error {
  return new Error('fit-state: failed');
}

/** The active vehicle with this slug, or null when unknown or retired. */
export async function findActiveVehicle(
  slug: string,
): Promise<{ id: number; slug: string } | null> {
  try {
    const rows = await getDb()
      .select({ id: vehicles.id, slug: vehicles.slug })
      .from(vehicles)
      .where(and(eq(vehicles.slug, slug), activeVehicleWhere()))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    throw failed();
  }
}

export type FitStateResult =
  | { status: 'no-such-vehicle' }
  | {
      status: 'ok';
      vehicle: { id: number; slug: string };
      /** One entry per asked product that exists, keyed by products.id. */
      states: ReadonlyMap<number, FitState>;
    };

/**
 * Fit state of each asked product (by `products.id`) for one vehicle slug. An
 * unknown or retired vehicle answers `no-such-vehicle`, even for an empty list.
 * An empty list gives an empty map with no product query; a missing id has no
 * entry; no id that was not asked about appears.
 */
export async function readFitStates(
  vehicleSlug: string,
  productIds: readonly number[],
): Promise<FitStateResult> {
  const vehicle = await findActiveVehicle(vehicleSlug);
  if (vehicle === null) {
    return { status: 'no-such-vehicle' };
  }
  const ids = [...new Set(productIds)];
  if (ids.length === 0) {
    return { status: 'ok', vehicle, states: new Map() };
  }
  try {
    const rows = await getDb()
      .select({ id: products.id, state: fitStateSql(vehicle.id) })
      .from(products)
      .where(inArray(products.id, ids));
    return { status: 'ok', vehicle, states: new Map(rows.map((row) => [row.id, row.state])) };
  } catch {
    throw failed();
  }
}
