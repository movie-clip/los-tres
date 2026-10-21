import 'server-only';

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';

// The backend/frontend contract for the category page (C-3). The page formats;
// this returns integer cents, never a formatted amount. Every product it lists
// is public by the one visibility scope, the same one the product page uses.

export const CATEGORY_PAGE_SIZE = 24;

export type CategoryProductCard = {
  /** products.slug; link target /producto/<slug>. */
  slug: string;
  /** Never empty. */
  title: string;
  /** As received; null means render no brand line. */
  brand: string | null;
  /**
   * min(visible offers.price_cents). Integer > 0, EUR, IVA included. Equals
   * getPublicProductBySlug(slug).offers[0].priceCents for the same data.
   */
  lowestPriceCents: number;
  /**
   * count(visible offers). Integer >= 1. The same number the product page
   * shows as offers.length.
   */
  offerCount: number;
};

export type PublicCategoryPage = {
  /** categories.slug */
  slug: string;
  /** categories.name */
  name: string;
  /** 1-based, the page returned. */
  page: number;
  /** >= 1; exactly 1 when productCount is 0. */
  pageCount: number;
  /** Public products in the category and every descendant. */
  productCount: number;
  /** Length 0..CATEGORY_PAGE_SIZE; 0 only when productCount is 0. */
  products: CategoryProductCard[];
};

/**
 * `products.category_id` is in the category's subtree: the category and every
 * descendant at any depth. `UNION` (not `UNION ALL`) so a malformed parent
 * cycle terminates. The category id is a bound parameter.
 */
function inSubtree(categoryId: number): SQL {
  const subtree = sql`(
    with recursive subtree(id) as (
      select ${categoryId}::int
      union
      select child.id from ${categories} as child
      join subtree on child.parent_id = subtree.id
    )
    select id from subtree
  )`;
  return inArray(products.categoryId, subtree);
}

/**
 * One page of the public products of a category, or `null` for: a malformed
 * slug (rejected before any query), an unknown slug, or a page past the last.
 * `page` is an integer >= 1 (see parsePageParam); it is not clamped here.
 */
export async function getPublicCategoryPage(
  slug: string,
  page: number,
): Promise<PublicCategoryPage | null> {
  if (!isWellFormedSlug(slug)) return null;
  const db = getDb();

  const [category] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (!category) return null;

  const [counted] = await db
    .select({ productCount: sql<number>`count(*)::int` })
    .from(products)
    .where(and(visibleProductWhere(), inSubtree(category.id)));
  const productCount = counted?.productCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(productCount / CATEGORY_PAGE_SIZE));
  if (page > pageCount) return null;

  const lowestPrice = sql<number>`min(${offers.priceCents})::int`;
  const rows = await db
    .select({
      slug: products.slug,
      title: products.title,
      brand: products.brand,
      lowestPriceCents: lowestPrice,
      offerCount: sql<number>`count(*)::int`,
    })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .innerJoin(feeds, eq(offers.feedId, feeds.id))
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(and(visibleProductWhere(), visibleOfferWhere(), inSubtree(category.id)))
    .groupBy(products.id)
    .orderBy(asc(lowestPrice), asc(products.id))
    .limit(CATEGORY_PAGE_SIZE)
    .offset((page - 1) * CATEGORY_PAGE_SIZE);

  return {
    slug: category.slug,
    name: category.name,
    page,
    pageCount,
    productCount,
    products: rows,
  };
}
