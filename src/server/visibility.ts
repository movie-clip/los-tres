import 'server-only';

import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { feeds, offers, products, shops } from '../db/schema';

// The one visibility scope (guardrail 1). Every public read applies these two
// conditions and none restates a flag. Outside this file only the schema, the
// seed and the importer may name the approval, hidden and review columns.
//
//   offer visible   = feed approved AND shop approved AND offer not hidden
//                     AND offer not in the matching queue
//   product public = product not hidden AND it has at least one visible offer

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
  return and(eq(products.isHidden, false), exists(visibleOffer)) as SQL;
}
