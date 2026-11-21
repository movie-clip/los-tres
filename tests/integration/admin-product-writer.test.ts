import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import {
  categories,
  clicks,
  feedCategoryMappings,
  feeds,
  fitments,
  offers,
  products,
  shops,
} from '@/db/schema';
import { readProductForAdmin, setOfferHidden, setProductHidden } from '@/server/admin/products';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getRedirectTarget } from '@/server/clicks/offer-target';

import {
  insertFeed,
  insertFitment,
  insertOffer,
  insertProduct,
  insertShop,
  insertVehicle,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// S2.4 (T2.4.1), the two writers against the test database: ACs 4 (explicit state, idempotent), 26 to
// 29 (the flags set and cleared), 30 (independent flags), 43 (an unhide returns nothing but its own
// flag), 44 (no other column of any row changes). The public readers are the existing visibility
// scope; these tests drive them through the real writer where the writer is new (ACs 32 to 42 once).

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

async function world() {
  const shop = await insertShop();
  const feedId = await insertFeed(shop.id);
  const product = await insertProduct({ slug: 'p-uno', title: 'Producto uno', brand: 'Marca' });
  const near = await insertOffer({ productId: product.id, feedId, priceCents: 1000 });
  const far = await insertOffer({ productId: product.id, feedId, priceCents: 2000 });
  return { shop, feedId, product, near, far };
}

/** Every row of every table a hide must not change, whole. */
async function tables() {
  const db = getDb();
  return {
    products: await db.select().from(products).orderBy(asc(products.id)),
    offers: await db.select().from(offers).orderBy(asc(offers.id)),
    feeds: await db.select().from(feeds).orderBy(asc(feeds.id)),
    shops: await db.select().from(shops).orderBy(asc(shops.id)),
    categories: await db.select().from(categories).orderBy(asc(categories.id)),
    mappings: await db.select().from(feedCategoryMappings).orderBy(asc(feedCategoryMappings.id)),
    fitments: await db.select().from(fitments).orderBy(asc(fitments.id)),
    clicks: await db.select().from(clicks).orderBy(asc(clicks.id)),
  };
}

async function productRow(id: number) {
  const [found] = await getDb().select().from(products).where(eq(products.id, id));
  return found;
}

async function offerRow(id: number) {
  const [found] = await getDb().select().from(offers).where(eq(offers.id, id));
  return found;
}

describe('setProductHidden (AC 26, 27, 4)', () => {
  it('hides and unhides a product, returning the stored flag and whether the public page shows it now', async () => {
    const { product } = await world();

    expect(await setProductHidden(product.id, true)).toEqual({ id: product.id, hidden: true, publicNow: false });
    expect(await productRow(product.id)).toMatchObject({ isHidden: true });
    expect(await getPublicProductBySlug('p-uno')).toBeNull();

    expect(await setProductHidden(product.id, false)).toEqual({ id: product.id, hidden: false, publicNow: true });
    expect(await productRow(product.id)).toMatchObject({ isHidden: false });
    expect((await getPublicProductBySlug('p-uno'))?.slug).toBe('p-uno');
  });

  it('is idempotent: hiding a hidden product and unhiding a clear one change nothing and are no error (AC 4)', async () => {
    const { product } = await world();
    await setProductHidden(product.id, true);
    const hiddenOnce = await tables();

    expect(await setProductHidden(product.id, true)).toEqual({ id: product.id, hidden: true, publicNow: false });
    expect(await tables()).toEqual(hiddenOnce);

    await setProductHidden(product.id, false);
    const clearOnce = await tables();
    expect(await setProductHidden(product.id, false)).toEqual({ id: product.id, hidden: false, publicNow: true });
    expect(await tables()).toEqual(clearOnce);
  });

  it('returns null and writes nothing for an id with no product (AC 5)', async () => {
    const { product } = await world();
    const before = await tables();
    expect(await setProductHidden(product.id + 500, true)).toBeNull();
    expect(await setProductHidden(product.id + 500, false)).toBeNull();
    expect(await tables()).toEqual(before);
  });
});

describe('setOfferHidden (AC 28, 29, 4)', () => {
  it('hides and unhides an offer, so the public page and /go lose it and get it back', async () => {
    const { near, far, product } = await world();

    expect(await setOfferHidden(near, true)).toEqual({ id: near, hidden: true, publicNow: false });
    expect((await getPublicProductBySlug('p-uno'))?.offers.map((offer) => offer.priceCents)).toEqual([2000]);
    expect(await getRedirectTarget(near)).toBeNull();
    expect(await getRedirectTarget(far)).not.toBeNull();
    expect((await readProductForAdmin(product.id))?.offers.find((offer) => offer.id === near)).toMatchObject({
      hidden: true,
      publicNow: false,
    });

    expect(await setOfferHidden(near, false)).toEqual({ id: near, hidden: false, publicNow: true });
    expect((await getPublicProductBySlug('p-uno'))?.offers.map((offer) => offer.priceCents)).toEqual([1000, 2000]);
    expect(await getRedirectTarget(near)).not.toBeNull();
  });

  it('is idempotent, and returns null with nothing written for an id with no offer (AC 4, 5)', async () => {
    const { near } = await world();
    await setOfferHidden(near, true);
    const hiddenOnce = await tables();
    expect(await setOfferHidden(near, true)).toEqual({ id: near, hidden: true, publicNow: false });
    expect(await tables()).toEqual(hiddenOnce);
    expect(await setOfferHidden(near + 500, true)).toBeNull();
    expect(await tables()).toEqual(hiddenOnce);
  });

  it('takes the last visible offer off the site, and with it the product (AC 42)', async () => {
    const { near, far, product } = await world();
    await setOfferHidden(near, true);
    expect((await getPublicProductBySlug('p-uno'))?.offers).toHaveLength(1);
    expect(await setOfferHidden(far, true)).toEqual({ id: far, hidden: true, publicNow: false });
    expect(await getPublicProductBySlug('p-uno')).toBeNull();
    // The product's own flag is untouched, and the admin read says it is not public now.
    expect(await readProductForAdmin(product.id)).toMatchObject({ hidden: false, publicNow: false });
  });
});

describe('the two flags are independent (AC 30)', () => {
  it('hiding or unhiding a product changes no offer, and an offer hidden on its own stays hidden', async () => {
    const { product, near, far } = await world();
    await setOfferHidden(near, true);

    await setProductHidden(product.id, true);
    expect(await offerRow(near)).toMatchObject({ isHidden: true });
    expect(await offerRow(far)).toMatchObject({ isHidden: false });

    await setProductHidden(product.id, false);
    expect(await offerRow(near)).toMatchObject({ isHidden: true });
    expect(await offerRow(far)).toMatchObject({ isHidden: false });
    expect((await getPublicProductBySlug('p-uno'))?.offers.map((offer) => offer.priceCents)).toEqual([2000]);
  });

  it('hiding or unhiding an offer changes neither its product nor its other offers', async () => {
    const { product, near, far } = await world();
    const other = await insertProduct({ slug: 'p-dos' });
    const otherOffer = await insertOffer({ productId: other.id, feedId: (await offerRow(near)).feedId });
    await setProductHidden(other.id, true);

    await setOfferHidden(near, true);
    await setOfferHidden(near, false);
    await setOfferHidden(far, true);

    expect(await productRow(product.id)).toMatchObject({ isHidden: false });
    expect(await productRow(other.id)).toMatchObject({ isHidden: true });
    expect(await offerRow(otherOffer)).toMatchObject({ isHidden: false });
    expect(await offerRow(near)).toMatchObject({ isHidden: false });
  });
});

describe('an unhide returns an item to where it would be had it never been hidden, and no further (AC 43)', () => {
  it('leaves a product of an unapproved feed, an unapproved shop, with no category, or with an offer in review non-public', async () => {
    const live = await insertFeed((await insertShop()).id);
    const feedOff = await insertFeed((await insertShop()).id, { isApproved: false });
    const shopOff = await insertFeed((await insertShop({ isApproved: false })).id);
    const cases = {
      feedOff: await insertProduct({ slug: 'c-feed', isHidden: true }),
      shopOff: await insertProduct({ slug: 'c-tienda', isHidden: true }),
      unmapped: await insertProduct({ slug: 'c-categoria', isHidden: true, categoryId: null }),
      review: await insertProduct({ slug: 'c-revision', isHidden: true }),
    };
    await insertOffer({ productId: cases.feedOff.id, feedId: feedOff });
    await insertOffer({ productId: cases.shopOff.id, feedId: shopOff });
    await insertOffer({ productId: cases.unmapped.id, feedId: live });
    await insertOffer({ productId: cases.review.id, feedId: live, inReview: true });

    for (const { id, slug } of Object.values(cases)) {
      expect(await setProductHidden(id, false), slug).toEqual({ id, hidden: false, publicNow: false });
      expect(await getPublicProductBySlug(slug), slug).toBeNull();
    }
  });

  it('leaves an offer of an unapproved feed or shop and an offer in review non-public after its unhide', async () => {
    const live = await insertFeed((await insertShop()).id);
    const feedOff = await insertFeed((await insertShop()).id, { isApproved: false });
    const shopOff = await insertFeed((await insertShop({ isApproved: false })).id);
    const product = await insertProduct({ slug: 'p-mixto' });
    await insertOffer({ productId: product.id, feedId: live, priceCents: 5000 });
    const hiddenOffers = [
      await insertOffer({ productId: product.id, feedId: feedOff, isHidden: true }),
      await insertOffer({ productId: product.id, feedId: shopOff, isHidden: true }),
      await insertOffer({ productId: product.id, feedId: live, isHidden: true, inReview: true }),
    ];

    for (const id of hiddenOffers) {
      expect(await setOfferHidden(id, false), String(id)).toEqual({ id, hidden: false, publicNow: false });
      expect(await getRedirectTarget(id)).toBeNull();
    }
    expect((await getPublicProductBySlug('p-mixto'))?.offers.map((offer) => offer.priceCents)).toEqual([5000]);
  });

  it('says an offer is not public now while its product is hidden, though the offer itself is shown again', async () => {
    const { product, near } = await world();
    await setProductHidden(product.id, true);
    await setOfferHidden(near, true);
    expect(await setOfferHidden(near, false)).toEqual({ id: near, hidden: false, publicNow: false });
    expect(await getRedirectTarget(near)).toBeNull();
  });
});

describe('a hide or an unhide changes one flag of one row and nothing else (AC 44)', () => {
  it('leaves every other column of every row, and every other table, as it was', async () => {
    const { product, near, far, feedId } = await world();
    const vehicle = await insertVehicle();
    await insertFitment(product.id, vehicle.id, feedId);
    const before = await tables();
    expect(before.fitments).toHaveLength(1);

    await setProductHidden(product.id, true);
    const afterProduct = await tables();
    expect(afterProduct.products.map((p) => ({ ...p, isHidden: false }))).toEqual(
      before.products.map((p) => ({ ...p, isHidden: false })),
    );
    expect(afterProduct.products.find((p) => p.id === product.id)?.isHidden).toBe(true);
    expect({ ...afterProduct, products: null }).toEqual({ ...before, products: null });

    await setProductHidden(product.id, false);
    expect(await tables()).toEqual(before);

    await setOfferHidden(near, true);
    await setOfferHidden(far, true);
    const afterOffers = await tables();
    expect(afterOffers.offers.map((o) => ({ ...o, isHidden: false }))).toEqual(
      before.offers.map((o) => ({ ...o, isHidden: false })),
    );
    expect(afterOffers.offers.every((o) => o.isHidden)).toBe(true);
    expect({ ...afterOffers, offers: null }).toEqual({ ...before, offers: null });

    await setOfferHidden(near, false);
    await setOfferHidden(far, false);
    expect(await tables()).toEqual(before);
  });

  it('writes no click and keeps the click log empty while it hides and unhides', async () => {
    const { product, near } = await world();
    await setProductHidden(product.id, true);
    await setOfferHidden(near, true);
    await setOfferHidden(near, false);
    await setProductHidden(product.id, false);
    expect(await getDb().select().from(clicks)).toEqual([]);
  });
});
