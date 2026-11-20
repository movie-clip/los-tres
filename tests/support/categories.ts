import { and, asc, eq, sql } from 'drizzle-orm';

import { FIXED_CATEGORY_TREE } from '@/db/category-tree';
import { getDb } from '@/db/client';
import { categories, feedCategoryMappings, feeds, offers, products, shops } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import {
  countSitemapProductChunks,
  getSitemapCategorySlugs,
  getSitemapProductSlugs,
} from '@/server/catalogue/sitemap';

import { insertFeed, insertOffer, insertProduct, insertShop } from './catalogue';
import { assertTestDatabase } from './db';
import { callGo } from './go';

// Scaffolding for the S4.2 category-mapping tests. Fixed category ids are not
// constants (resetDatabase re-creates the tree), so every id is looked up by
// slug here and nobody types a slug or an id.

export const TARGET_SLUGS: string[] = FIXED_CATEGORY_TREE.children.map((child) => child.slug);
export const ROOT_SLUG: string = FIXED_CATEGORY_TREE.slug;

export type Target = { id: number; slug: string; name: string };

/** The five children of the fixed tree with their current ids, in tree order. */
export async function fiveTargets(): Promise<Target[]> {
  const rows = await getDb().select().from(categories).orderBy(asc(categories.position), asc(categories.id));
  return FIXED_CATEGORY_TREE.children.map((child) => {
    const row = rows.find((candidate) => candidate.slug === child.slug);
    if (!row) throw new Error(`fixed category ${child.slug} is missing`);
    return { id: row.id, slug: row.slug, name: row.name };
  });
}

/** The root, "Mantenimiento del coche". */
export async function rootCategory(): Promise<Target> {
  const [row] = await getDb().select().from(categories).where(eq(categories.slug, ROOT_SLUG));
  return { id: row.id, slug: row.slug, name: row.name };
}

/** FormData from a plain object. */
export function categoryForm(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value));
  return data;
}

/** One approved, non-demo feed of its own shop. */
export async function aFeed(o: { approved?: boolean; shopApproved?: boolean; demo?: boolean; url?: string } = {}) {
  const shop = await insertShop({ isApproved: o.shopApproved ?? true });
  const feedId = await insertFeed(shop.id, { isApproved: o.approved, isDemo: o.demo, url: o.url });
  return { shop, feedId };
}

let serial = 0;

/**
 * A product with one offer in `feedId` carrying `feedCategory` (null: an empty
 * cell). `categoryId` undefined takes the shared test category, null is unmapped,
 * so a mapping test nearly always passes it. Hidden and the like go in `product`.
 */
export async function productIn(
  feedId: number,
  feedCategory: string | null,
  o: { slug?: string; categoryId?: number | null; product?: Partial<typeof products.$inferInsert>; offer?: Partial<typeof offers.$inferInsert> } = {},
) {
  serial += 1;
  const product = await insertProduct({
    slug: o.slug ?? `mapeo-${serial}`,
    categoryId: o.categoryId === undefined ? null : o.categoryId,
    ...o.product,
  });
  const offerId = await insertOffer({ productId: product.id, feedId, feedCategory, ...o.offer });
  return { ...product, offerId };
}

/** One more offer of an existing product in another (or the same) feed category. */
export async function offerOf(productId: number, feedId: number, feedCategory: string | null): Promise<number> {
  return insertOffer({ productId, feedId, feedCategory });
}

export async function recordsOf(feedId: number) {
  return getDb()
    .select({ feedCategory: feedCategoryMappings.feedCategory, categoryId: feedCategoryMappings.categoryId })
    .from(feedCategoryMappings)
    .where(eq(feedCategoryMappings.feedId, feedId))
    .orderBy(asc(feedCategoryMappings.feedCategory));
}

export async function recordOf(feedId: number, feedCategory: string) {
  const [row] = await getDb()
    .select()
    .from(feedCategoryMappings)
    .where(and(eq(feedCategoryMappings.feedId, feedId), eq(feedCategoryMappings.feedCategory, feedCategory)));
  return row;
}

export async function allRecords() {
  return getDb().select().from(feedCategoryMappings).orderBy(asc(feedCategoryMappings.id));
}

/** Product slug to category id, for a whole-table "who sits where" check. */
export async function categoryBySlug(): Promise<Record<string, number | null>> {
  const rows = await getDb().select({ slug: products.slug, categoryId: products.categoryId }).from(products);
  return Object.fromEntries(rows.map((row) => [row.slug, row.categoryId]));
}

/**
 * Every row of the tables a mapping must not change, with the one column a
 * mapping may change (`products.category_id`) removed, for a before/after
 * equality (AC 38).
 */
export async function rowsApartFromCategory() {
  const db = getDb();
  const withoutCategory = (rows: (typeof products.$inferSelect)[]) =>
    rows.map((row) => ({ ...row, categoryId: null }));
  return {
    products: withoutCategory(await db.select().from(products).orderBy(asc(products.id))),
    offers: await db.select().from(offers).orderBy(asc(offers.id)),
    feeds: await db.select().from(feeds).orderBy(asc(feeds.id)),
    shops: await db.select().from(shops).orderBy(asc(shops.id)),
  };
}

/** Slugs the sitemap lists as products. */
export async function sitemapProducts(): Promise<string[]> {
  const chunks = await countSitemapProductChunks();
  const all: string[] = [];
  for (let chunk = 1; chunk <= chunks; chunk += 1) all.push(...((await getSitemapProductSlugs(chunk)) ?? []));
  return all.sort();
}

export type PublicView = {
  categoryCount: number | null;
  productPage: boolean;
  sitemapProduct: boolean;
  sitemapCategory: boolean;
  go: number;
};

/**
 * What the public readers say about one product and one category right now: the
 * category page count, the product page, the sitemap (product and category) and
 * the status of `/go/<offer>`. Nothing is cached between two calls (AC 31).
 */
export async function publicView(o: { productSlug: string; offerId: number; categorySlug: string }): Promise<PublicView> {
  const listing = await getPublicCategoryPage(o.categorySlug, 1, null, 'price-asc');
  return {
    categoryCount: listing ? listing.productCount : null,
    productPage: (await getPublicProductBySlug(o.productSlug)) !== null,
    sitemapProduct: (await sitemapProducts()).includes(o.productSlug),
    sitemapCategory: (await getSitemapCategorySlugs()).includes(o.categorySlug),
    go: (await callGo(o.offerId)).status,
  };
}

/** A view of a product that is public in its category. */
export const PUBLIC_VIEW: PublicView = {
  categoryCount: 1,
  productPage: true,
  sitemapProduct: true,
  sitemapCategory: true,
  go: 302,
};

/** A view of a product that is absent from every public reader. */
export const ABSENT_VIEW: PublicView = {
  categoryCount: 0,
  productPage: false,
  sitemapProduct: false,
  sitemapCategory: false,
  go: 404,
};

/**
 * Runs `run` while every update of a product row fails with SQLSTATE P0001 and a
 * message that carries every feed address, so a leak of the failure text shows up
 * in a log or a state. The trigger is dropped in `finally`.
 */
export async function withFailingProductUpdates<T>(run: () => Promise<T>): Promise<T> {
  await assertTestDatabase();
  const db = getDb();
  await db.execute(
    sql.raw(
      "create function fail_product_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', (select string_agg(url, ',') from feeds) using errcode = 'P0001'; end $$",
    ),
  );
  await db.execute(sql.raw('create trigger fail_product_write before update on products for each row execute function fail_product_write()'));
  try {
    return await run();
  } finally {
    await db.execute(sql.raw('drop trigger if exists fail_product_write on products'));
    await db.execute(sql.raw('drop function if exists fail_product_write()'));
  }
}
