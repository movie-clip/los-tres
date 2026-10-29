import 'server-only';

import { and, eq, exists, isNotNull, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { feeds, offers, products, shops, vehicles } from '../db/schema';

// The one visibility scope (guardrail 1). Every public read applies these
// conditions and none restates a flag. Outside this file only the schema, the
// seed and the importer may name the approval, hidden and review columns.
//
//   offer visible   = feed approved AND shop approved AND offer not hidden
//                     AND offer not in the matching queue
//   product public = product not hidden AND product mapped to a category
//                     (products.category_id is not null) AND it has at least
//                     one visible offer
//   fitment counted = feed approved AND shop approved AND vehicle not retired
//                     (no offer or product flag: a fitment never makes a
//                     product public, S5.5)

/**
 * Condition over `offers` joined to `feeds` (offers.feed_id) and `shops`
 * (feeds.shop_id): the offer may be shown to the public.
 */
export function visibleOfferWhere(): SQL {
  return and(
    eq(feeds.isApproved, true),
    eq(shops.isApproved, true),
    eq(offers.isHidden, false),
    eq(offers.inReview, false),
  ) as SQL;
}

/** Condition over `products`: the product may be shown to the public. */
export function visibleProductWhere(): SQL {
  const visibleOffer = new QueryBuilder()
    .select({ one: sql`1` })
    .from(offers)
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(and(eq(offers.productId, products.id), visibleOfferWhere()));
  return and(
    eq(products.isHidden, false),
    isNotNull(products.categoryId),
    exists(visibleOffer),
  ) as SQL;
}

/** Condition over `vehicles`: the vehicle is in the current list (not retired). */
export function activeVehicleWhere(): SQL {
  return eq(vehicles.isRetired, false);
}

/**
 * Condition over `fitments` joined to `feeds` (fitments.feed_id), `shops`
 * (feeds.shop_id) and `vehicles` (fitments.vehicle_id): the fitment counts.
 * It names no offer or product flag, so it never decides what is public.
 */
export function countedFitmentWhere(): SQL {
  return and(eq(feeds.isApproved, true), eq(shops.isApproved, true), activeVehicleWhere()) as SQL;
}
