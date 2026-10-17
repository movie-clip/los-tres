import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';

import { assertTestDatabase } from './db';

// Direct-insert fixtures for integration tests. Every helper checks it is on a
// `_test` database first. The defaults describe a fully VISIBLE state (shop and
// feed approved, nothing hidden, not in review): a test that is about hiding
// something sets exactly that one flag and asserts on the difference.
// Feeds are `shop_upload`, so no network row is needed.

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

export async function insertProduct(
  o: Partial<typeof products.$inferInsert> = {},
): Promise<{ id: number; slug: string }> {
  await assertTestDatabase();
  const slug = o.slug ?? `producto-${next()}`;
  const [row] = await getDb()
    .insert(products)
    .values({ title: `Producto ${slug}`, ...o, slug })
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
  o: { slug?: string; priceCents?: number; shopName?: string } = {},
) {
  const shop = await insertShop({ name: o.shopName });
  const feedId = await insertFeed(shop.id);
  const product = await insertProduct({ slug: o.slug });
  const offerId = await insertOffer({
    productId: product.id,
    feedId,
    priceCents: o.priceCents ?? 1000,
  });
  return { shop, feedId, product, offerId };
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
