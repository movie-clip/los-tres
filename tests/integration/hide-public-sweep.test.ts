import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';
import { setOfferHidden, setProductHidden } from '@/server/admin/products';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { brandSlug } from '@/server/catalogue/category-query';
import { getPublicCategoryTree, getPublicSubcategories } from '@/server/catalogue/category-tree';
import { isMissingPublicPage } from '@/server/catalogue/missing-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { getSitemapCategorySlugs } from '@/server/catalogue/sitemap';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';

import {
  insertCategory,
  insertFeed,
  insertFitment,
  insertOffer,
  insertProduct,
  insertShop,
  setOfferRemoved,
  vehicleIdBySlug,
} from '../support/catalogue';
import { sitemapProducts } from '../support/categories';
import { resetDatabase } from '../support/db';
import { allClicks, callGo } from '../support/go';
import { allRows, withoutHiddenFlags } from '../support/hide';

// S2.4 (T2.4.3), ACs 32 to 44: a hide made through the real writers (setProductHidden, setOfferHidden)
// takes the item off every public surface from the next read, with no import and no other step, and an
// unhide returns exactly what the item would have had and no more. The public readers already have
// tests that set a flag by hand; this file sets it the way the admin does and asserts the whole set once.

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

const TERM = 'pelicano';
const CAR = VEHICLE_CATALOGUE[0];

type World = {
  vehicleId: number;
  a: { id: number; slug: string; offerNear: number; offerFar: number; feedNear: number };
  b: { id: number; slug: string; offerId: number };
};

/**
 * Product A (the one that gets hidden) sits alone in `cat-a` with two real offers, 10,00 and 20,00 EUR;
 * product B is the control in `cat-b`. Both fit the car and both are in `raiz`'s subtree, with brands of
 * their own. A's title holds a word that only A matches.
 */
async function world(): Promise<World> {
  const root = await insertCategory({ slug: 'raiz', name: 'Raíz' });
  const catA = await insertCategory({ slug: 'cat-a', name: 'Cat A', parentId: root.id });
  const catB = await insertCategory({ slug: 'cat-b', name: 'Cat B', parentId: root.id });

  const feedNear = await insertFeed((await insertShop({ name: 'Tienda cerca' })).id);
  const feedFar = await insertFeed((await insertShop({ name: 'Tienda lejos' })).id);
  const feedB = await insertFeed((await insertShop({ name: 'Tienda control' })).id);

  const a = await insertProduct({
    slug: 'producto-a',
    title: `Filtro ${TERM} alfa`,
    brand: 'Alfa',
    brandNormalised: 'ALFA',
    categoryId: catA.id,
  });
  const offerNear = await insertOffer({ productId: a.id, feedId: feedNear, priceCents: 1000 });
  const offerFar = await insertOffer({ productId: a.id, feedId: feedFar, priceCents: 2000 });

  const b = await insertProduct({
    slug: 'producto-b',
    title: 'Filtro control beta',
    brand: 'Beta',
    brandNormalised: 'BETA',
    categoryId: catB.id,
  });
  const offerB = await insertOffer({ productId: b.id, feedId: feedB, priceCents: 3000 });

  const vehicleId = await vehicleIdBySlug(CAR.slug);
  await insertFitment(a.id, vehicleId, feedNear);
  await insertFitment(b.id, vehicleId, feedB);

  return {
    vehicleId,
    a: { id: a.id, slug: a.slug, offerNear, offerFar, feedNear },
    b: { id: b.id, slug: b.slug, offerId: offerB },
  };
}

const at = (path: string) => new URL(`http://127.0.0.1:3010${path}`);

/** What every public reader says about product A and the control right now. */
async function view(w: World) {
  const page = await getPublicProductBySlug(w.a.slug);
  const root = await getPublicCategoryPage('raiz', 1, null, 'price-asc');
  const catA = await getPublicCategoryPage('cat-a', 1, null, 'price-asc');
  const tree = await getPublicCategoryTree();
  const search = await getPublicSearchPage(parseSearchTerm(TERM), 1);
  const carRoot = await getPublicCategoryPage('raiz', 1, null, 'price-asc', w.vehicleId);
  const carSearch = await getPublicSearchPage(parseSearchTerm(TERM), 1, w.vehicleId);
  const rootGroup = tree.find((group) => group.slug === 'raiz');
  const card = root?.products.find((candidate) => candidate.slug === w.a.slug) ?? null;
  const found = search?.state === 'results' ? search.products.find((c) => c.slug === w.a.slug) ?? null : null;

  return {
    productPage: page !== null,
    pagePrices: page?.offers.map((offer) => offer.priceCents) ?? [],
    jsonLd: page === null ? null : buildProductJsonLd(page),
    missingProduct: await isMissingPublicPage(at(`/producto/${w.a.slug}`)),
    rootCount: root?.productCount ?? null,
    rootCards: (root?.products.map((c) => c.slug) ?? []).sort(),
    rootBrands: root?.brands.map((brand) => ({ slug: brand.slug, count: brand.productCount })) ?? [],
    catACount: catA?.productCount ?? null,
    catAState: catA?.state ?? null,
    card: card === null ? null : { lowestPriceCents: card.lowestPriceCents, offerCount: card.offerCount },
    homeRoot: rootGroup?.productCount ?? 0,
    homeChildren: rootGroup?.children.map((child) => child.slug) ?? [],
    // #313: the links of the root category page, the same rule as the home tiles.
    rootSubcategories: (await getPublicSubcategories('raiz')).map((child) => child.slug),
    searchState: search?.state ?? null,
    searchCount: search?.state === 'results' ? search.productCount : 0,
    searchCard: found === null ? null : { lowestPriceCents: found.lowestPriceCents, offerCount: found.offerCount },
    sitemapProduct: (await sitemapProducts()).includes(w.a.slug),
    sitemapCategories: (await getSitemapCategorySlugs()).sort(),
    carFits: carRoot?.fit?.fitsCount ?? null,
    carCards: (carRoot?.products.map((c) => c.slug) ?? []).sort(),
    carSearchCount: carSearch?.state === 'results' ? carSearch.productCount : 0,
    carSearchState: carSearch?.state ?? null,
  };
}

const PUBLIC_A = {
  productPage: true,
  pagePrices: [1000, 2000],
  missingProduct: false,
  rootCount: 2,
  rootCards: ['producto-a', 'producto-b'],
  rootBrands: [
    { slug: brandSlug('ALFA'), count: 1 },
    { slug: brandSlug('BETA'), count: 1 },
  ],
  catACount: 1,
  card: { lowestPriceCents: 1000, offerCount: 2 },
  homeRoot: 2,
  homeChildren: ['cat-a', 'cat-b'],
  rootSubcategories: ['cat-a', 'cat-b'],
  searchState: 'results',
  searchCount: 1,
  searchCard: { lowestPriceCents: 1000, offerCount: 2 },
  sitemapProduct: true,
  sitemapCategories: ['cat-a', 'cat-b', 'raiz'],
  carFits: 2,
  carCards: ['producto-a', 'producto-b'],
  carSearchCount: 1,
} as const;

/** AC 32 to 38 in one place: product A is on none of the public surfaces, the control still is. */
const ABSENT_A = {
  productPage: false,
  pagePrices: [],
  jsonLd: null,
  missingProduct: true,
  rootCount: 1,
  rootCards: ['producto-b'],
  rootBrands: [{ slug: brandSlug('BETA'), count: 1 }],
  catACount: 0,
  catAState: 'empty-category',
  card: null,
  homeRoot: 1,
  homeChildren: ['cat-b'],
  rootSubcategories: ['cat-b'],
  searchState: 'no-results',
  searchCount: 0,
  searchCard: null,
  sitemapProduct: false,
  sitemapCategories: ['cat-b', 'raiz'],
  carFits: 1,
  carCards: ['producto-b'],
  carSearchCount: 0,
  carSearchState: 'no-results',
} as const;

describe('the baseline is public everywhere (non-vacuity)', () => {
  it('shows product A on every surface the sweep checks, so an absence below means something', async () => {
    const w = await world();
    expect(await view(w)).toMatchObject(PUBLIC_A);
    expect((await callGo(w.a.offerNear)).status).toBe(302);
    expect((await callGo(w.a.offerFar)).status).toBe(302);
  });
});

describe('a hidden product is on no public surface (AC 32 to 38)', () => {
  it('AC 32: the page answers null and the 404 rewrite agrees, both from the next read', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);

    expect(await getPublicProductBySlug(w.a.slug)).toBeNull();
    expect(await isMissingPublicPage(at(`/producto/${w.a.slug}`))).toBe(true);
    // The control is not caught by the same answer.
    expect(await isMissingPublicPage(at(`/producto/${w.b.slug}`))).toBe(false);
  });

  it('AC 33: no category page lists, counts or brand-groups it', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);
    const v = await view(w);

    expect(v).toMatchObject({
      rootCount: ABSENT_A.rootCount,
      rootCards: ABSENT_A.rootCards,
      rootBrands: ABSENT_A.rootBrands,
      catACount: 0,
      catAState: 'empty-category',
    });
    const root = await getPublicCategoryPage('raiz', 1, null, 'price-asc');
    expect(root?.categoryProductCount).toBe(1);
    // The brand filter on its own brand finds nothing either.
    expect((await getPublicCategoryPage('raiz', 1, brandSlug('ALFA'), 'price-asc'))?.products ?? []).toEqual([]);
  });

  it('AC 34: the home category counts leave it out', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);
    const v = await view(w);
    expect(v).toMatchObject({ homeRoot: 1, homeChildren: ['cat-b'] });
    // #313: the root category page's links leave the child it alone held out too, the home tiles' set.
    expect(v.rootSubcategories).toEqual(v.homeChildren);
  });

  it('AC 35: search does not return or count it, and a term only it matches is the ordinary no-results', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);

    expect(await getPublicSearchPage(parseSearchTerm(TERM), 1)).toEqual({ state: 'no-results', term: TERM });
    // A term the control matches still finds it, and not A.
    const control = await getPublicSearchPage(parseSearchTerm('control'), 1);
    expect(control?.state === 'results' ? control.products.map((card) => card.slug) : []).toEqual([w.b.slug]);
  });

  it('AC 36: no product sitemap file lists it, and a category it alone held is gone from the category file', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);

    expect(await sitemapProducts()).toEqual([w.b.slug]);
    expect((await getSitemapCategorySlugs()).sort()).toEqual(['cat-b', 'raiz']);
  });

  it('AC 37: /go for each of its offers answers 404 and writes no click; the control still redirects', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);

    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect((await callGo(w.a.offerFar)).status).toBe(404);
    expect(await allClicks()).toHaveLength(0);
    expect((await callGo(w.b.offerId)).status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });

  it('AC 38: the car filter lists no hidden product, in a category or in a search', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);
    const v = await view(w);

    expect(v).toMatchObject({
      carFits: ABSENT_A.carFits,
      carCards: ABSENT_A.carCards,
      carSearchCount: 0,
      carSearchState: 'no-results',
    });
    const own = await getPublicCategoryPage('cat-a', 1, null, 'price-asc', w.vehicleId);
    expect(own?.productCount).toBe(0);
    expect(own?.fit).toMatchObject({ fitsCount: 0, unknownCount: 0 });
  });

  it('holds on every surface at once, from the next read, with no import', async () => {
    const w = await world();
    await setProductHidden(w.a.id, true);
    expect(await view(w)).toMatchObject(ABSENT_A);
  });
});

describe('a hidden offer is on no public surface (AC 39 to 42)', () => {
  it('AC 39: the page lists the other offer only, and its price, shop count and structured data follow', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerNear, true);
    const page = await getPublicProductBySlug(w.a.slug);

    expect(page?.offers.map((offer) => offer.offerId)).toEqual([w.a.offerFar]);
    expect(page?.offers.map((offer) => offer.priceCents)).toEqual([2000]);
    expect(page === null ? null : buildProductJsonLd(page)).toMatchObject({
      offers: { lowPrice: '20.00', highPrice: '20.00', offerCount: 1 },
    });
  });

  it('AC 40: a category card and a search card count their price and their shops without it', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerNear, true);
    const v = await view(w);

    expect(v.card).toEqual({ lowestPriceCents: 2000, offerCount: 1 });
    expect(v.searchCard).toEqual({ lowestPriceCents: 2000, offerCount: 1 });
    // The product itself is still listed, counted and found.
    expect(v).toMatchObject({ rootCount: 2, searchCount: 1, carSearchCount: 1 });
  });

  it('AC 41: /go for the hidden offer answers 404 with no click, while the other offer redirects', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerNear, true);

    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect(await allClicks()).toHaveLength(0);

    const other = await callGo(w.a.offerFar);
    expect(other.status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });

  it('AC 42: when it was the last visible offer the product is on none of the surfaces of AC 32 to 38', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerNear, true);
    expect(await view(w)).toMatchObject({ productPage: true, sitemapProduct: true });

    await setOfferHidden(w.a.offerFar, true);
    expect(await view(w)).toMatchObject(ABSENT_A);
    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect((await callGo(w.a.offerFar)).status).toBe(404);
  });

  it('AC 42: with another visible offer the product stays public and is priced from what remains', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerFar, true);
    const v = await view(w);

    expect(v).toMatchObject({
      productPage: true,
      pagePrices: [1000],
      missingProduct: false,
      rootCards: ['producto-a', 'producto-b'],
      card: { lowestPriceCents: 1000, offerCount: 1 },
      sitemapProduct: true,
      sitemapCategories: ['cat-a', 'cat-b', 'raiz'],
      homeChildren: ['cat-a', 'cat-b'],
    });
  });
});

describe('an unhide returns the item to where it would have been, and no further (AC 43)', () => {
  it('a hidden then unhidden product is on every surface again, as before', async () => {
    const w = await world();
    const before = await view(w);

    await setProductHidden(w.a.id, true);
    expect(await view(w)).toMatchObject(ABSENT_A);
    await setProductHidden(w.a.id, false);

    expect(await view(w)).toEqual(before);
  });

  it('a hidden then unhidden offer is back on the page, in the price and on /go', async () => {
    const w = await world();
    const before = await view(w);

    await setOfferHidden(w.a.offerNear, true);
    await setOfferHidden(w.a.offerNear, false);

    expect(await view(w)).toEqual(before);
    expect((await callGo(w.a.offerNear)).status).toBe(302);
  });

  type Case = {
    name: string;
    feed?: { isApproved: boolean };
    shop?: { isApproved: boolean };
    categoryId?: null;
    offer?: { inReview: boolean };
  };
  const NOT_PUBLIC: Case[] = [
    { name: 'its feed is not approved', feed: { isApproved: false } },
    { name: 'its shop is not approved', shop: { isApproved: false } },
    { name: 'it has no category', categoryId: null },
    { name: 'its only offer is in review', offer: { inReview: true } },
  ];

  it.each(NOT_PUBLIC)('a product stays non-public after an unhide when $name', async (setup) => {
    const shop = await insertShop(setup.shop);
    const feedId = await insertFeed(shop.id, setup.feed);
    const product = await insertProduct({ slug: 'no-publico', categoryId: setup.categoryId });
    const offerId = await insertOffer({ productId: product.id, feedId, ...setup.offer });
    // A visible control so the sitemap and /go are not trivially empty.
    const control = await insertProduct({ slug: 'control-visible' });
    const controlOffer = await insertOffer({
      productId: control.id,
      feedId: await insertFeed((await insertShop()).id),
    });

    await setProductHidden(product.id, true);
    await setProductHidden(product.id, false);

    expect(await getPublicProductBySlug('no-publico')).toBeNull();
    expect(await isMissingPublicPage(at('/producto/no-publico'))).toBe(true);
    expect(await sitemapProducts()).toEqual(['control-visible']);
    expect((await callGo(offerId)).status).toBe(404);
    expect((await callGo(controlOffer)).status).toBe(302);
  });

  it.each(NOT_PUBLIC.filter((setup) => setup.categoryId === undefined))(
    'an offer stays non-public after an unhide when $name',
    async (setup) => {
      const shop = await insertShop(setup.shop);
      const feedId = await insertFeed(shop.id, setup.feed);
      const product = await insertProduct({ slug: 'con-oferta-no-publica' });
      const offerId = await insertOffer({ productId: product.id, feedId, ...setup.offer });
      const visible = await insertOffer({
        productId: product.id,
        feedId: await insertFeed((await insertShop()).id),
        priceCents: 5000,
      });

      await setOfferHidden(offerId, true);
      await setOfferHidden(offerId, false);

      expect((await callGo(offerId)).status).toBe(404);
      expect((await callGo(visible)).status).toBe(302);
      const page = await getPublicProductBySlug('con-oferta-no-publica');
      expect(page?.offers.map((offer) => offer.offerId)).toEqual([visible]);
    },
  );
});

describe('a hide or an unhide changes no other column of any row (AC 44)', () => {
  it('compares every table before, hidden and after, apart from the flags', async () => {
    const w = await world();
    const before = await allRows();

    await setProductHidden(w.a.id, true);
    await setOfferHidden(w.b.offerId, true);
    const hidden = await allRows();
    expect(withoutHiddenFlags(hidden)).toEqual(withoutHiddenFlags(before));
    expect(hidden.products.filter((row) => row.isHidden).map((row) => row.slug)).toEqual([w.a.slug]);
    expect(hidden.offers.filter((row) => row.isHidden).map((row) => row.id)).toEqual([w.b.offerId]);

    await setProductHidden(w.a.id, false);
    await setOfferHidden(w.b.offerId, false);
    expect(await allRows()).toEqual(before);
  });
});

// S3.3 (T3.3.2), AC 2: an offer the importer flagged removed leaves the same public surfaces a hidden
// offer does, by the same shared scope and with no step of its own. The flag is set by hand here
// (`setOfferRemoved`); importer-removal.test.ts proves the importer sets and clears it. A removed offer
// is not hidden: the admin writers are never called below.
describe('a removed offer is on no public surface (S3.3, AC 2)', () => {
  it('lists the other offer only on the page, and the price, shop count and structured data follow', async () => {
    const w = await world();
    await setOfferRemoved(w.a.offerNear, true);
    const page = await getPublicProductBySlug(w.a.slug);

    expect(page?.offers.map((offer) => offer.offerId)).toEqual([w.a.offerFar]);
    expect(page?.offers.map((offer) => offer.priceCents)).toEqual([2000]);
    expect(page === null ? null : buildProductJsonLd(page)).toMatchObject({
      offers: { lowPrice: '20.00', highPrice: '20.00', offerCount: 1 },
    });
  });

  it('prices a category card and a search card from what remains, and still lists, counts and finds the product', async () => {
    const w = await world();
    await setOfferRemoved(w.a.offerNear, true);
    const v = await view(w);

    expect(v.card).toEqual({ lowestPriceCents: 2000, offerCount: 1 });
    expect(v.searchCard).toEqual({ lowestPriceCents: 2000, offerCount: 1 });
    expect(v).toMatchObject({ rootCount: 2, searchCount: 1, carSearchCount: 1, productPage: true, sitemapProduct: true });
  });

  it('answers /go for the removed offer as for a hidden one: 404 and no click, while the other offer redirects', async () => {
    const w = await world();
    await setOfferRemoved(w.a.offerNear, true);

    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect(await allClicks()).toHaveLength(0);
    expect((await callGo(w.a.offerFar)).status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });

  it('takes the product off every surface when its last visible offer is removed, and /go answers 404 for both', async () => {
    const w = await world();
    await setOfferRemoved(w.a.offerNear, true);
    expect(await view(w)).toMatchObject({ productPage: true, sitemapProduct: true });

    await setOfferRemoved(w.a.offerFar, true);
    expect(await view(w)).toMatchObject(ABSENT_A);
    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect((await callGo(w.a.offerFar)).status).toBe(404);
    expect(await allClicks()).toHaveLength(0);
  });

  it('keeps the product public, priced from the remaining offer, while another offer is visible', async () => {
    const w = await world();
    await setOfferRemoved(w.a.offerFar, true);

    expect(await view(w)).toMatchObject({
      productPage: true,
      pagePrices: [1000],
      missingProduct: false,
      rootCards: ['producto-a', 'producto-b'],
      card: { lowestPriceCents: 1000, offerCount: 1 },
      sitemapProduct: true,
      sitemapCategories: ['cat-a', 'cat-b', 'raiz'],
      homeChildren: ['cat-a', 'cat-b'],
    });
  });

  it('returns the product to every surface, as before, when the flag is cleared', async () => {
    const w = await world();
    const before = await view(w);

    await setOfferRemoved(w.a.offerNear, true);
    await setOfferRemoved(w.a.offerFar, true);
    expect(await view(w)).toMatchObject(ABSENT_A);
    await setOfferRemoved(w.a.offerNear, false);
    await setOfferRemoved(w.a.offerFar, false);

    expect(await view(w)).toEqual(before);
    expect((await callGo(w.a.offerNear)).status).toBe(302);
  });

  it('does not touch the product: a product left with no visible offer keeps its hidden flag and its category', async () => {
    const w = await world();
    const before = await allRows();
    await setOfferRemoved(w.a.offerNear, true);
    await setOfferRemoved(w.a.offerFar, true);
    const after = await allRows();

    expect(after.products).toEqual(before.products);
    expect(after.products.find((row) => row.id === w.a.id)).toMatchObject({ isHidden: false });
    expect(after.products.find((row) => row.id === w.a.id)?.categoryId).not.toBeNull();
  });

  it('is independent of the hide flag: unhiding a removed offer publishes nothing', async () => {
    const w = await world();
    await setOfferHidden(w.a.offerNear, true);
    await setOfferRemoved(w.a.offerNear, true);
    await setOfferHidden(w.a.offerNear, false);

    expect((await callGo(w.a.offerNear)).status).toBe(404);
    expect((await getPublicProductBySlug(w.a.slug))?.offers.map((offer) => offer.offerId)).toEqual([w.a.offerFar]);
  });

  it('D-9: a removed real offer still marks the product as not demo-only for the sitemap, as a hidden one does', async () => {
    const root = await insertCategory({ slug: 'solo-demo' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id);
    const product = await insertProduct({ slug: 'demo-y-real', categoryId: root.id });
    await insertOffer({ productId: product.id, feedId: demoFeed });
    const real = await insertOffer({ productId: product.id, feedId: realFeed });
    expect(await sitemapProducts()).toEqual(['demo-y-real']);

    await setOfferRemoved(real, true);

    expect(await getPublicProductBySlug('demo-y-real')).not.toBeNull();
    expect(await sitemapProducts()).toEqual(['demo-y-real']);
  });
});
