import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import { bestPriceFlags } from './best-price';
import { hasNonDemoOfferWhere } from './demo';

// The backend/frontend contract for the product page (C-11). The page formats;
// this returns integer cents and `Date`, never a formatted amount or date.

export type PublicCategoryCrumb = {
  /** categories.slug; the page links it with categoryPath(slug) (page 1, no filter). */
  slug: string;
  /** categories.name. Never empty. Display text, not a message key. */
  name: string;
};

export type PublicOffer = {
  /** offers.id; the page links to it through /go (goPath), never to a shop URL. */
  offerId: number;
  /** shops.name */
  shopName: string;
  /** Integer, > 0, EUR, IVA included. Never a formatted string. */
  priceCents: number;
  /** offers.price_updated_at */
  priceUpdatedAt: Date;
  /** bestPriceFlags (best-price.ts) over the visible offers' priceCents. */
  isBestPrice: boolean;
};

export type PublicProductPage = {
  slug: string;
  /** Never empty. */
  title: string;
  /** Trimmed; null when null or blank. */
  brand: string | null;
  /** Trimmed; null when null or blank, for example "OC 1234". */
  partNumber: string | null;
  /** Trimmed; null when null or blank. */
  ean: string | null;
  /** Trimmed; null when null or blank. Plain text: the page must render it as text, never as HTML. */
  description: string | null;
  /** categories.slug of the product's own category; equals categoryTrail.at(-1).slug. */
  categorySlug: string;
  /** Root first, ends with the product's own category. Length >= 1. */
  categoryTrail: PublicCategoryCrumb[];
  /** Length >= 1, visible offers only, already sorted by price, shop, id. */
  offers: PublicOffer[];
  /** True when every listed (visible) offer is from a demo feed. offers.length >= 1, so never vacuous. */
  demoOnly: boolean;
  /**
   * True when the product has an offer, in any state, from a non-demo feed:
   * search engines may index the page (canonical) and the sitemap lists it.
   * False means noindex. Never null. Independent of `demoOnly`, which drives
   * the demo notice only.
   */
  indexable: boolean;
};

function nonBlank(value: string | null): string | null {
  return value?.trim() || null;
}

/**
 * The category and its ancestors, root first. Read from the `categories` table
 * (runtime truth), not from the fixed-tree constant. `depth < 8` is the cycle
 * guard: the depth column makes rows distinct, so UNION alone would not stop a
 * malformed parent cycle; a deeper chain is cut at the root end.
 */
async function readCategoryTrail(categoryId: number): Promise<PublicCategoryCrumb[]> {
  const result = await getDb().execute<PublicCategoryCrumb>(sql`
    with recursive trail(id, parent_id, slug, name, depth) as (
      select id, parent_id, slug, name, 0 from ${categories} where id = ${categoryId}
      union all
      select c.id, c.parent_id, c.slug, c.name, t.depth + 1
      from ${categories} c join trail t on c.id = t.parent_id
      where t.depth < 8
    )
    select slug, name from trail order by depth desc
  `);
  return result.rows.map((row) => ({ slug: row.slug, name: row.name }));
}

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
      categorySlug: categories.slug,
      categoryId: products.categoryId,
      offerId: offers.id,
      shopName: shops.name,
      priceCents: offers.priceCents,
      priceUpdatedAt: offers.priceUpdatedAt,
      isDemo: feeds.isDemo,
      indexable: sql<boolean>`${hasNonDemoOfferWhere()}`,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), visibleProductWhere(), visibleOfferWhere()))
    .orderBy(asc(offers.priceCents), asc(shops.name), asc(offers.id));

  const first = rows[0];
  if (!first) return null;
  // The inner join and visibleProductWhere() guarantee a category; the guard narrows the type.
  if (first.categoryId === null) return null;
  const categoryTrail = await readCategoryTrail(first.categoryId);
  const flags = bestPriceFlags(rows.map((row) => row.priceCents));
  return {
    slug: first.slug,
    title: first.title,
    brand: nonBlank(first.brand),
    partNumber: nonBlank(first.partNumber),
    ean: nonBlank(first.ean),
    description: nonBlank(first.description),
    categorySlug: first.categorySlug,
    categoryTrail,
    offers: rows.map((row, i) => ({
      offerId: row.offerId,
      shopName: row.shopName,
      priceCents: row.priceCents,
      priceUpdatedAt: row.priceUpdatedAt,
      isBestPrice: flags[i],
    })),
    demoOnly: rows.every((row) => row.isDemo),
    indexable: first.indexable,
  };
}
