import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  categories,
  feedCategoryMappings,
  feeds,
  fitments,
  offers,
  products,
  shops,
  vehicles,
} from '@/db/schema';

import { assertTestDatabase } from './db';

// Direct-insert fixtures for integration tests. Every helper checks it is on a
// `_test` database first. The defaults describe a fully VISIBLE state (shop and
// feed approved, nothing hidden, not in review): a test that is about hiding
// something sets exactly that one flag and asserts on the difference.
// Feeds are `shop_upload`, so no network row is needed.
// A product is public only when mapped to a category (S5.1), so `insertProduct`
// defaults `categoryId` to a shared test category; pass `categoryId: null` to
// build the unmapped state.

let counter = 0;
const next = (): number => {
  counter += 1;
  return counter;
};

export async function insertShop(
  o: { slug?: string; name?: string; isApproved?: boolean } = {},
): Promise<{ id: number; slug: string; name: string }> {
  await assertTestDatabase();
  const n = next();
  const slug = o.slug ?? `tienda-${n}`;
  const name = o.name ?? `Tienda ${n}`;
  const [row] = await getDb()
    .insert(shops)
    .values({ slug, name, isApproved: o.isApproved ?? true })
    .returning({ id: shops.id });
  return { id: row.id, slug, name };
}

export async function insertFeed(
  shopId: number,
  o: { url?: string; isApproved?: boolean; isDemo?: boolean } = {},
): Promise<number> {
  await assertTestDatabase();
  const [row] = await getDb()
    .insert(feeds)
    .values({
      shopId,
      sourceType: 'shop_upload',
      url: o.url ?? `feed-${next()}.csv`,
      isApproved: o.isApproved ?? true,
      isDemo: o.isDemo ?? false,
    })
    .returning({ id: feeds.id });
  return row.id;
}

const DEFAULT_CATEGORY_SLUG = 'categoria-de-prueba';

export async function insertCategory(
  o: { slug?: string; name?: string; parentId?: number | null; position?: number } = {},
): Promise<{ id: number; slug: string; name: string }> {
  await assertTestDatabase();
  const n = next();
  const slug = o.slug ?? `categoria-${n}`;
  const name = o.name ?? `Categoría ${n}`;
  const [row] = await getDb()
    .insert(categories)
    .values({ slug, name, parentId: o.parentId ?? null, position: o.position ?? 0 })
    .returning({ id: categories.id });
  return { id: row.id, slug, name };
}

/** The category `insertProduct` assigns by default; created on first use, found by slug after. */
export async function defaultCategoryId(): Promise<number> {
  await assertTestDatabase();
  const [found] = await getDb()
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, DEFAULT_CATEGORY_SLUG));
  if (found) return found.id;
  return (await insertCategory({ slug: DEFAULT_CATEGORY_SLUG, name: 'Categoría de prueba' })).id;
}

export async function insertCategoryMapping(
  feedId: number,
  feedCategory: string,
  categoryId: number,
): Promise<void> {
  await assertTestDatabase();
  await getDb().insert(feedCategoryMappings).values({ feedId, feedCategory, categoryId });
}

export async function insertProduct(
  o: Partial<typeof products.$inferInsert> = {},
): Promise<{ id: number; slug: string }> {
  await assertTestDatabase();
  const slug = o.slug ?? `producto-${next()}`;
  const categoryId = o.categoryId === undefined ? await defaultCategoryId() : o.categoryId;
  const [row] = await getDb()
    .insert(products)
    .values({ title: `Producto ${slug}`, ...o, slug, categoryId })
    .returning({ id: products.id });
  return { id: row.id, slug };
}

export async function insertOffer(
  o: { productId: number; feedId: number } & Partial<typeof offers.$inferInsert>,
): Promise<number> {
  await assertTestDatabase();
  const [row] = await getDb()
    .insert(offers)
    .values({
      externalId: `ext-${next()}`,
      priceCents: 1000,
      url: 'https://affiliate.example/never-public',
      priceUpdatedAt: new Date('2026-10-01T10:00:00Z'),
      ...o,
    })
    .returning({ id: offers.id });
  return row.id;
}

/** One approved shop, one approved feed, one product, one visible offer. */
export async function insertVisibleOffer(
  o: { slug?: string; priceCents?: number; shopName?: string; categoryId?: number | null } = {},
) {
  const shop = await insertShop({ name: o.shopName });
  const feedId = await insertFeed(shop.id);
  const product = await insertProduct({ slug: o.slug, categoryId: o.categoryId });
  const offerId = await insertOffer({
    productId: product.id,
    feedId,
    priceCents: o.priceCents ?? 1000,
  });
  return { shop, feedId, product, offerId };
}

/**
 * A product with one visible offer per entry of `prices` (cents). Each offer
 * gets its own approved shop and feed unless `feedId` is given, in which case
 * every offer uses that one feed (the feed must hold unique external ids, which
 * the helper's offers do). `categoryId: undefined` takes the default category,
 * `null` builds the unmapped state.
 */
export async function insertListedProduct(o: {
  slug: string;
  prices: number[];
  categoryId?: number | null;
  title?: string;
  brand?: string | null;
  feedId?: number;
  isHidden?: boolean;
  /** Any other product column, for example partNumber, partNumberNormalised, eanNormalised (S5.4 search). */
  extra?: Partial<typeof products.$inferInsert>;
}): Promise<{ id: number; slug: string; offerIds: number[] }> {
  const product = await insertProduct({
    slug: o.slug,
    categoryId: o.categoryId,
    ...(o.title === undefined ? {} : { title: o.title }),
    ...(o.brand === undefined ? {} : { brand: o.brand }),
    ...(o.isHidden === undefined ? {} : { isHidden: o.isHidden }),
    ...o.extra,
  });
  const offerIds: number[] = [];
  for (const priceCents of o.prices) {
    const feedId = o.feedId ?? (await insertFeed((await insertShop()).id));
    offerIds.push(await insertOffer({ productId: product.id, feedId, priceCents }));
  }
  return { ...product, offerIds };
}

/** A registered fixture-served feed: a shop and a feed whose url is a fixture file name. */
export async function insertFixtureFeed(
  fixtureName: string,
  o: { shopName?: string; isApproved?: boolean } = {},
): Promise<{ shopId: number; feedId: number }> {
  const shop = await insertShop({ name: o.shopName });
  const feedId = await insertFeed(shop.id, { url: fixtureName, isApproved: o.isApproved });
  return { shopId: shop.id, feedId };
}

/** The id of a vehicle of the migrated list, by slug (ids restart at the reset, so never hard-code one). */
export async function vehicleIdBySlug(slug: string): Promise<number> {
  const [row] = await getDb().select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.slug, slug));
  if (!row) throw new Error(`no vehicle with slug ${slug}`);
  return row.id;
}

/**
 * An extra vehicle outside the list, active by default. Position starts at
 * 10000, above the list. The next `runMigrations` or `resetDatabase` retires or
 * truncates it, so use it in one test only.
 */
export async function insertVehicle(
  o: Partial<typeof vehicles.$inferInsert> = {},
): Promise<{ id: number; slug: string }> {
  await assertTestDatabase();
  const n = next();
  const slug = o.slug ?? `vehiculo-de-prueba-${n}`;
  const [row] = await getDb()
    .insert(vehicles)
    .values({
      make: 'Marca',
      makeSlug: 'marca',
      model: 'Modelo',
      modelSlug: 'marca-modelo-i',
      generation: 'I',
      yearFrom: 2010,
      yearTo: null,
      engine: '1.0',
      engineCode: null,
      fuel: 'gasolina',
      powerKw: 50,
      powerCv: 68,
      position: 10000 + n,
      ...o,
      slug,
    })
    .returning({ id: vehicles.id });
  return { id: row.id, slug };
}

/** One fitment row: product P fits vehicle V, said by feed F. */
export async function insertFitment(productId: number, vehicleId: number, feedId: number): Promise<number> {
  await assertTestDatabase();
  const [row] = await getDb()
    .insert(fitments)
    .values({ productId, vehicleId, feedId })
    .returning({ id: fitments.id });
  return row.id;
}

export async function productBySlug(slug: string) {
  const [row] = await getDb().select().from(products).where(eq(products.slug, slug));
  return row;
}

export async function allProducts() {
  return getDb().select().from(products).orderBy(products.id);
}

export async function allOffers() {
  return getDb().select().from(offers).orderBy(offers.id);
}
