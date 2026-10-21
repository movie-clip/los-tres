import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { feeds, offers, products, shops } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';

// The backend/frontend contract for the product page (C-11). The page formats;
// this returns integer cents and `Date`, never a formatted amount or date.

export type PublicOffer = {
  /** offers.id; the page links to it through /go (goPath), never to a shop URL. */
  offerId: number;
  /** shops.name */
  shopName: string;
  /** Integer, > 0, EUR, IVA included. Never a formatted string. */
  priceCents: number;
  /** offers.price_updated_at */
  priceUpdatedAt: Date;
};

export type PublicProductPage = {
  slug: string;
  /** Never empty. */
  title: string;
  /** As received. */
  brand: string | null;
  /** As received (raw), for example "OC 1234". */
  partNumber: string | null;
  /** As received (raw). */
  ean: string | null;
  /** Plain text: the page must render it as text, never as HTML. */
  description: string | null;
  /** Length >= 1, visible offers only, already sorted by price, shop, id. */
  offers: PublicOffer[];
  /** True when every listed (visible) offer is from a demo feed. offers.length >= 1, so never vacuous. */
  demoOnly: boolean;
};

/**
 * The public page of one product, or `null` for every not-public reason alike:
 * malformed slug (rejected before any query), unknown slug, hidden product, or
 * no visible offer. The caller cannot tell which, by design (TD-31).
 */
export async function getPublicProductBySlug(slug: string): Promise<PublicProductPage | null> {
  if (!isWellFormedSlug(slug)) return null;

  const rows = await getDb()
    .select({
      slug: products.slug,
      title: products.title,
      brand: products.brand,
      partNumber: products.partNumber,
      ean: products.ean,
      description: products.description,
      offerId: offers.id,
      shopName: shops.name,
      priceCents: offers.priceCents,
      priceUpdatedAt: offers.priceUpdatedAt,
      isDemo: feeds.isDemo,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(and(eq(products.slug, slug), visibleProductWhere(), visibleOfferWhere()))
    .orderBy(asc(offers.priceCents), asc(shops.name), asc(offers.id));

  const first = rows[0];
  if (!first) return null;
  return {
    slug: first.slug,
    title: first.title,
    brand: first.brand,
    partNumber: first.partNumber,
    ean: first.ean,
    description: first.description,
    offers: rows.map((row) => ({
      offerId: row.offerId,
      shopName: row.shopName,
      priceCents: row.priceCents,
      priceUpdatedAt: row.priceUpdatedAt,
    })),
    demoOnly: rows.every((row) => row.isDemo),
  };
}
