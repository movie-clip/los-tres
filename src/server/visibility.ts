import 'server-only';

import { and, eq, exists, isNotNull, not, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { collectedRowsShown } from '../config/local-flag';
import { feeds, offers, products, shops, vehicles } from '../db/schema';

// The one visibility scope (guardrail 1). Every public read applies these
// conditions and none restates a flag. Outside this file only the schema, the
// seed, the importer and the two admin writers (src/server/admin/sources.ts for
// approvals, src/server/admin/products.ts for the hidden flags) may name the
// approval, hidden and review columns.
//
//   offer visible   = feed approved AND shop approved AND offer not hidden
//                     AND offer not in the matching queue AND offer not
//                     removed by import (S3.3)
//   product public = product not hidden AND product mapped to a category
//                     (products.category_id is not null) AND it has at least
//                     one visible offer
//   fitment counted = feed approved AND shop approved AND vehicle not retired
//                     AND feed not a collected feed (no offer or product flag:
//                     a fitment never makes a product public, S5.5)
//
// Marked rows (S12.2, decision 0017): an offer of a collected feed and a product
// created from a row of one. Both scopes leave them out unless the local flag is
// on beside a loopback SITE_URL (`collectedRowsShown`, read on every call); the
// flag lifts that exclusion and no other rule. A collected feed's fitment never
// counts, flag on or off.

/** Condition over `feeds`: the feed is a collected feed. Flag-independent. */
export function markedFeedSql(): SQL {
  return eq(feeds.sourceType, 'collected_file');
}

/** Condition over `products`: the product was created from a collected row. Flag-independent. */
export function markedProductSql(): SQL {
  return eq(products.isCollected, true);
}

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
    eq(offers.isRemoved, false),
    collectedRowsShown() ? undefined : not(markedFeedSql()),
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
    collectedRowsShown() ? undefined : not(markedProductSql()),
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
 * It names no offer or product flag, so it never decides what is public. A
 * collected feed's fitment never counts, whatever the local flag says (AC 32).
 */
export function countedFitmentWhere(): SQL {
  return and(
    eq(feeds.isApproved, true),
    eq(shops.isApproved, true),
    activeVehicleWhere(),
    not(markedFeedSql()),
  ) as SQL;
}
