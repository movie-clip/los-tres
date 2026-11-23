import 'server-only';

import { and, eq, exists, not, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { feeds, offers, products } from '../../db/schema';
import { markedFeedSql, markedProductSql } from '../visibility';

// Indexability for search engines (S6.2, S12.2). A product is indexable when it
// is not a marked product and has at least one offer, in any state, from a feed
// that is neither a demo feed nor a collected feed. One condition covers both
// kinds, so there is no second source of truth. This is not a visibility flag:
// visibility.ts stays the one scope for what the public sees (guardrail 1), and
// callers combine this condition with visibleProductWhere(), never in place of
// it. It does not read the local flag: a collected row is never indexed.
// The demo flag is computed only in src/server/catalogue.

/**
 * Condition over `products`: the product may be indexed. Deliberately not
 * filtered by offer visibility, so a product that keeps a hidden real offer
 * stays indexable.
 */
export function indexableProductWhere(): SQL {
  const indexedOffer = new QueryBuilder()
    .select({ one: feeds.id })
    .from(offers)
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .where(and(eq(offers.productId, products.id), eq(feeds.isDemo, false), not(markedFeedSql())));
  return and(not(markedProductSql()), exists(indexedOffer)) as SQL;
}
