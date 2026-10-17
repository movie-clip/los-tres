import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertFeed,
  insertOffer,
  insertProduct,
  insertShop,
  insertVisibleOffer,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';

beforeEach(resetDatabase);
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

// Guardrail 1: an offer is visible iff its feed is approved, its shop is
// approved, it is not hidden and it is not waiting in the matching queue; a
// product is public iff it is not hidden and has at least one visible offer.
// Every state below is set by one direct update on an otherwise visible row.

type Ids = { shopId: number; feedId: number; productId: number; offerId: number };

const states: [string, (ids: Ids) => Promise<unknown>][] = [
  ['the feed is not approved', (ids) => getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, ids.feedId))],
  ['the shop is not approved', (ids) => getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, ids.shopId))],
  ['the offer is hidden', (ids) => getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, ids.offerId))],
  ['the offer is in the matching queue', (ids) => getDb().update(offers).set({ inReview: true }).where(eq(offers.id, ids.offerId))],
];

describe('getPublicProductBySlug visibility (guardrail 1)', () => {
  it('returns the offer of a fully visible product (baseline)', async () => {
    const { product, offerId } = await insertVisibleOffer({ slug: 'baseline' });
    const page = await getPublicProductBySlug(product.slug);
    expect(page?.offers.map((offer) => offer.offerId)).toEqual([offerId]);
  });

  describe.each(states)('when %s', (_label, mutate) => {
    it('returns null for a product whose only offer is in that state', async () => {
      const { shop, feedId, product, offerId } = await insertVisibleOffer({ slug: 'solo' });
      await mutate({ shopId: shop.id, feedId, productId: product.id, offerId });
      expect(await getPublicProductBySlug('solo')).toBeNull();
    });

    it('removes that offer alone and keeps the product that has another visible offer', async () => {
      const keep = await insertVisibleOffer({ slug: 'dos-ofertas', priceCents: 2000 });
      const otherShop = await insertShop();
      const otherFeed = await insertFeed(otherShop.id);
      const otherOffer = await insertOffer({
        productId: keep.product.id,
        feedId: otherFeed,
        priceCents: 1500,
      });
      expect((await getPublicProductBySlug('dos-ofertas'))?.offers).toHaveLength(2);

      await mutate({
        shopId: otherShop.id,
        feedId: otherFeed,
        productId: keep.product.id,
        offerId: otherOffer,
      });

      const page = await getPublicProductBySlug('dos-ofertas');
      expect(page?.offers.map((offer) => offer.offerId)).toEqual([keep.offerId]);
    });
  });

  it('returns null when every offer of the product is removed', async () => {
    const a = await insertVisibleOffer({ slug: 'todas' });
    const shopB = await insertShop({ isApproved: false });
    const feedB = await insertFeed(shopB.id);
    await insertOffer({ productId: a.product.id, feedId: feedB });
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, a.offerId));
    expect(await getPublicProductBySlug('todas')).toBeNull();
  });

  it('returns null for a hidden product even though its offers are visible', async () => {
    const { product } = await insertVisibleOffer({ slug: 'oculto' });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect(await getPublicProductBySlug('oculto')).toBeNull();
  });

  it('returns null for a product with no offer at all', async () => {
    await insertProduct({ slug: 'sin-ofertas' });
    expect(await getPublicProductBySlug('sin-ofertas')).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    await insertVisibleOffer({ slug: 'existe' });
    expect(await getPublicProductBySlug('no-existe')).toBeNull();
  });

  it('serves the second feed of an approved shop when only the first feed is disabled', async () => {
    const shop = await insertShop();
    const disabled = await insertFeed(shop.id, { isApproved: false });
    const enabled = await insertFeed(shop.id, { isApproved: true });
    const product = await insertProduct({ slug: 'dos-feeds' });
    await insertOffer({ productId: product.id, feedId: disabled, priceCents: 500 });
    const kept = await insertOffer({ productId: product.id, feedId: enabled, priceCents: 900 });
    const page = await getPublicProductBySlug('dos-feeds');
    expect(page?.offers.map((offer) => offer.offerId)).toEqual([kept]);
  });
});

describe('malformed slugs never reach the database', () => {
  it('returns null for each malformed slug even while the database is unreachable', async () => {
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const malformed = [
      '',
      'Bad_Slug',
      'UPPER',
      'a b',
      'a--b',
      '-lead',
      'trail-',
      'a/b',
      'a%20b',
      "x'; drop table products; --",
      'ñandú',
      'a'.repeat(121),
    ];
    for (const slug of malformed) {
      expect(await getPublicProductBySlug(slug), JSON.stringify(slug)).toBeNull();
    }

    // Control: a well-formed slug does query, and so fails on the dead database.
    await expect(getPublicProductBySlug('well-formed')).rejects.toBeDefined();

    vi.unstubAllEnvs();
    await closeDb();
  });

  it('accepts a slug of exactly 120 characters as well-formed (it queries and finds nothing)', async () => {
    await insertVisibleOffer({ slug: 'existe' });
    expect(await getPublicProductBySlug('a'.repeat(120))).toBeNull();
  });
});
