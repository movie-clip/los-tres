import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { feeds, offers, products, shops } from '../../db/schema';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';

// The one place that reads the shop URL (offers.url) for the public side.
// The redirect needs it; no other public read returns it (guardrail 1: the
// lookup goes through the one visibility scope and restates no flag).

export type RedirectTarget = {
  offerId: number;
  /** feeds.shop_id of the offer, now: the click stores it as a snapshot. */
  shopId: number;
  /** offers.product_id, now: the click stores it as a snapshot. */
  productId: number;
  /** offers.url as stored. Never logged, never returned to a caller of a public read. */
  url: string;
  /** The offer's feed is a demo feed (feeds.is_demo): redirected, never counted. */
  isDemoFeed: boolean;
};

/**
 * The redirect target of a visible offer on a public product, or null for every
 * not-visible reason alike (unknown, unapproved feed or shop, hidden or in
 * review offer, hidden product). The caller cannot tell which, by design.
 */
export async function getRedirectTarget(offerId: number): Promise<RedirectTarget | null> {
  const rows = await getDb()
    .select({
      offerId: offers.id,
      shopId: feeds.shopId,
      productId: offers.productId,
      url: offers.url,
      isDemoFeed: feeds.isDemo,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(and(eq(offers.id, offerId), visibleProductWhere(), visibleOfferWhere()))
    .limit(1);
  return rows[0] ?? null;
}
