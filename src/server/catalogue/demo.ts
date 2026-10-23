import 'server-only';

import { and, eq, exists, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { feeds, offers, products } from '../../db/schema';

// Demo identification for search engines (S6.2). A demo product is one with no
// offer, in any state, from a non-demo feed. This is not a visibility flag:
// visibility.ts stays the one scope for what the public sees (guardrail 1), and
// callers combine this condition with visibleProductWhere(), never in place of it.
// The demo flag is computed only in src/server/catalogue.

/**
 * Condition over `products`: the product has at least one offer from a feed
 * that is not a demo feed. Deliberately not filtered by offer visibility, so a
 * product that keeps a hidden real offer stays indexable.
 */
export function hasNonDemoOfferWhere(): SQL {
  const nonDemoOffer = new QueryBuilder()
    .select({ one: feeds.id })
    .from(offers)
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .where(and(eq(offers.productId, products.id), eq(feeds.isDemo, false)));
  return exists(nonDemoOffer);
}
