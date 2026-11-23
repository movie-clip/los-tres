import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as getIndex } from '@/app/(public)/sitemap.xml/route';
import { GET as getSitemapFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb } from '@/db/client';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { brandSlug } from '@/server/catalogue/category-query';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';
import { readProductFitState, readProductVehicles } from '@/server/catalogue/fit-state';
import { isMissingPublicPage } from '@/server/catalogue/missing-page';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { getSitemapCategorySlugs } from '@/server/catalogue/sitemap';
import { setOfferHidden, setProductHidden } from '@/server/admin/products';

import {
  insertCategory,
  insertCollectedFeed,
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
import { BACKSTOP_MODES, stubLocalFlag, type LocalFlagMode } from '../support/local-flag';

// S12.2 (decision 0017), ACs 13, 15 to 19, 20 to 27, 30, 32 and 37: the public sweep for marked rows. A
// marked offer is an offer of a collected feed, a marked product one created from a collected row. The
// model is hide-public-sweep.test.ts: one world, every public reader asked in one call (`view`), the
// expected state written once per flag mode, and a non-vacuity block that shows the sweep SEES a marked
// row when the flag is on beside a loopback SITE_URL. Everything is invented. Every test sets BOTH
// LOCAL_COLLECTED_DATA and SITE_URL itself (`stubLocalFlag`), so none depends on the developer's .env.

vi.setConfig({ testTimeout: 30_000 });

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const TERM_U = 'pelicano';
const TERM_M = 'colibri';
const EAN_M = '2000000000046';
const [CAR, CAR_TWO] = VEHICLE_CATALOGUE;

type World = {
  carId: number;
  carTwoId: number;
  c: { id: number; slug: string; offerId: number };
  /** Unmarked product with an unmarked offer (2000) and a marked offer (1000). */
  u: { id: number; slug: string; offerUnmarked: number; offerMarked: number };
  /** Marked product, one marked offer (500). */
  m: { id: number; slug: string; offerId: number };
};

/**
 * Control C: unmarked, unmarked feed, 30,00. U: unmarked product, its unmarked offer 20,00 and a marked
 * offer 10,00 (cheaper, so a shown marked offer changes the lowest price and the count). M: a marked
 * product (is_collected) with one marked offer 5,00, carrying a brand, part number and EAN. Each of the
 * three sits in a category of its own under `raiz`. C and U fit CAR through their unmarked feeds; M fits
 * CAR through its collected feed, and U also fits CAR_TWO through the collected feed: a collected feed's
 * fitment never counts (AC 32), so neither fit may show anywhere.
 */
async function world(): Promise<World> {
  const root = await insertCategory({ slug: 'raiz', name: 'Raíz' });
  const catC = await insertCategory({ slug: 'cat-c', name: 'Cat C', parentId: root.id });
  const catU = await insertCategory({ slug: 'cat-u', name: 'Cat U', parentId: root.id });
  const catM = await insertCategory({ slug: 'cat-m', name: 'Cat M', parentId: root.id });

  const feedC = await insertFeed((await insertShop({ name: 'Tienda control' })).id);
  const feedU = await insertFeed((await insertShop({ name: 'Tienda escrita a mano' })).id);
  const collected = await insertCollectedFeed();

  const c = await insertProduct({
    slug: 'producto-c',
    title: 'Filtro control gamma',
    brand: 'Gamma',
    brandNormalised: 'GAMMA',
    categoryId: catC.id,
  });
  const offerC = await insertOffer({ productId: c.id, feedId: feedC, priceCents: 3000 });

  const u = await insertProduct({
    slug: 'producto-u',
    title: `Filtro ${TERM_U} ultra`,
    brand: 'Ultra',
    brandNormalised: 'ULTRA',
    categoryId: catU.id,
  });
  const offerUnmarked = await insertOffer({ productId: u.id, feedId: feedU, priceCents: 2000 });
  const offerMarked = await insertOffer({ productId: u.id, feedId: collected.feedId, priceCents: 1000 });

  const m = await insertProduct({
    slug: 'producto-m',
    title: `Filtro ${TERM_M} mono`,
    brand: 'Mono',
    brandNormalised: 'MONO',
    partNumber: 'MP-77',
    partNumberNormalised: 'MP77',
    ean: EAN_M,
    eanNormalised: EAN_M,
    categoryId: catM.id,
    isCollected: true,
  });
  const offerM = await insertOffer({ productId: m.id, feedId: collected.feedId, priceCents: 500 });

  const carId = await vehicleIdBySlug(CAR.slug);
  const carTwoId = await vehicleIdBySlug(CAR_TWO.slug);
  await insertFitment(c.id, carId, feedC);
  await insertFitment(u.id, carId, feedU);
  await insertFitment(u.id, carTwoId, collected.feedId);
  await insertFitment(m.id, carId, collected.feedId);

  return {
    carId,
    carTwoId,
    c: { id: c.id, slug: c.slug, offerId: offerC },
    u: { id: u.id, slug: u.slug, offerUnmarked, offerMarked },
    m: { id: m.id, slug: m.slug, offerId: offerM },
  };
}

const at = (path: string) => new URL(`http://127.0.0.1:3010${path}`);

async function searchSlugs(term: string, vehicleId?: number): Promise<string[]> {
  const page = await getPublicSearchPage(parseSearchTerm(term), 1, vehicleId);
  return page?.state === 'results' ? page.products.map((card) => card.slug).sort() : [];
}

/** What every public reader says about the marked product M and the marked offer of U right now. */
async function view(w: World) {
  const mPage = await getPublicProductBySlug(w.m.slug);
  const uPage = await getPublicProductBySlug(w.u.slug);
  const root = await getPublicCategoryPage('raiz', 1, null, 'price-asc');
  const catM = await getPublicCategoryPage('cat-m', 1, null, 'price-asc');
  const catU = await getPublicCategoryPage('cat-u', 1, null, 'price-asc');
  const tree = await getPublicCategoryTree();
  const rootGroup = tree.find((group) => group.slug === 'raiz');
  const carRoot = await getPublicCategoryPage('raiz', 1, null, 'price-asc', w.carId);
  const carCatM = await getPublicCategoryPage('cat-m', 1, null, 'price-asc', w.carId);
  const uCard = root?.products.find((card) => card.slug === w.u.slug) ?? null;
  const uFound = await getPublicSearchPage(parseSearchTerm(TERM_U), 1);
  const uSearchCard = uFound?.state === 'results' ? (uFound.products.find((card) => card.slug === w.u.slug) ?? null) : null;

  return {
    // M, the marked product
    mProductPage: mPage !== null,
    mPagePrices: mPage?.offers.map((offer) => offer.priceCents) ?? [],
    mMissing: await isMissingPublicPage(at(`/producto/${w.m.slug}`)),
    mMissingWithCar: await isMissingPublicPage(at(`/producto/${w.m.slug}?coche=${CAR.slug}`)),
    mRootCard: root?.products.some((card) => card.slug === w.m.slug) ?? false,
    mCategoryState: catM?.state ?? null,
    mCategoryCount: catM?.productCount ?? null,
    mBrandChip: root?.brands.some((brand) => brand.slug === brandSlug('MONO')) ?? false,
    mBrandFilter: (await getPublicCategoryPage('raiz', 1, brandSlug('MONO'), 'price-asc'))?.products.map((c) => c.slug) ?? [],
    mHome: rootGroup?.children.some((child) => child.slug === 'cat-m') ?? false,
    mSearchByTitle: await searchSlugs(TERM_M),
    mSearchByBrand: await searchSlugs('Mono'),
    mSearchByPartNumber: await searchSlugs('MP-77'),
    mSearchByEan: await searchSlugs(EAN_M),
    mCarSearch: await searchSlugs(TERM_M, w.carId),
    mCarCategoryCount: carCatM?.productCount ?? null,
    mSitemap: (await sitemapProducts()).includes(w.m.slug),
    // U, the unmarked product that carries a marked offer
    uPagePrices: uPage?.offers.map((offer) => offer.priceCents) ?? [],
    uJsonLd: uPage === null ? null : buildProductJsonLd(uPage),
    uCard: uCard === null ? null : { lowestPriceCents: uCard.lowestPriceCents, offerCount: uCard.offerCount },
    uSearchCard: uSearchCard === null ? null : { lowestPriceCents: uSearchCard.lowestPriceCents, offerCount: uSearchCard.offerCount },
    uSitemap: (await sitemapProducts()).includes(w.u.slug),
    // the listings as a whole
    rootCount: root?.productCount ?? null,
    rootCards: (root?.products.map((card) => card.slug) ?? []).sort(),
    rootBrands: (root?.brands.map((brand) => brand.slug) ?? []).sort(),
    catUCount: catU?.productCount ?? null,
    homeRoot: rootGroup?.productCount ?? 0,
    homeChildren: (rootGroup?.children.map((child) => child.slug) ?? []).sort(),
    carFit: carRoot?.fit === null || carRoot === null ? null : { fits: carRoot.fit.fitsCount, unknown: carRoot.fit.unknownCount },
    carCards: (carRoot?.products.map((card) => card.slug) ?? []).sort(),
    sitemapCategories: (await getSitemapCategorySlugs()).sort(),
    // fitment: a collected feed's fitment never counts
    mVehicles: await readProductVehicles(w.m.slug),
    uVehicles: (await readProductVehicles(w.u.slug)).map((vehicle) => vehicle.slug),
    mFit: await readProductFitState(w.m.slug, w.carId),
    uFitCar: await readProductFitState(w.u.slug, w.carId),
    uFitCarTwo: await readProductFitState(w.u.slug, w.carTwoId),
  };
}

/** What is the same in every mode: nothing about the marked rows changes these (AC 23, 32). */
const ALWAYS = {
  mSitemap: false,
  uSitemap: true,
  sitemapCategories: ['cat-c', 'cat-u', 'raiz'],
  mVehicles: [],
  uVehicles: [CAR.slug],
  mFit: 'unknown',
  uFitCar: 'fits',
  uFitCarTwo: 'no-fit',
} as const;

/** AC 15 to 19: with the flag off, or on beside a non-loopback origin, M and the marked offer of U are nowhere. */
const HIDDEN = {
  mProductPage: false,
  mPagePrices: [],
  mMissing: true,
  mMissingWithCar: true,
  mRootCard: false,
  mCategoryState: 'empty-category',
  mCategoryCount: 0,
  mBrandChip: false,
  mBrandFilter: [],
  mHome: false,
  mSearchByTitle: [],
  mSearchByBrand: [],
  mSearchByPartNumber: [],
  mSearchByEan: [],
  mCarSearch: [],
  mCarCategoryCount: 0,
  uPagePrices: [2000],
  uCard: { lowestPriceCents: 2000, offerCount: 1 },
  uSearchCard: { lowestPriceCents: 2000, offerCount: 1 },
  rootCount: 2,
  rootCards: ['producto-c', 'producto-u'],
  rootBrands: [brandSlug('GAMMA'), brandSlug('ULTRA')].sort(),
  catUCount: 1,
  homeRoot: 2,
  homeChildren: ['cat-c', 'cat-u'],
  carFit: { fits: 2, unknown: 0 },
  carCards: ['producto-c', 'producto-u'],
} as const;

/** AC 26: with the flag on beside a loopback origin the same rows show as any row does. */
const SHOWN = {
  mProductPage: true,
  mPagePrices: [500],
  mMissing: false,
  mMissingWithCar: false,
  mRootCard: true,
  mCategoryState: 'results',
  mCategoryCount: 1,
  mBrandChip: true,
  mBrandFilter: ['producto-m'],
  mHome: true,
  mSearchByTitle: ['producto-m'],
  mSearchByBrand: ['producto-m'],
  mSearchByPartNumber: ['producto-m'],
  mSearchByEan: ['producto-m'],
  mCarSearch: ['producto-m'],
  mCarCategoryCount: 1,
  uPagePrices: [1000, 2000],
  uCard: { lowestPriceCents: 1000, offerCount: 2 },
  uSearchCard: { lowestPriceCents: 1000, offerCount: 2 },
  rootCount: 3,
  rootCards: ['producto-c', 'producto-m', 'producto-u'],
  rootBrands: [brandSlug('GAMMA'), brandSlug('MONO'), brandSlug('ULTRA')].sort(),
  catUCount: 1,
  homeRoot: 3,
  homeChildren: ['cat-c', 'cat-m', 'cat-u'],
  // M is public with no counted fitment, so it is "unknown" for the selected car, never "fits".
  carFit: { fits: 2, unknown: 1 },
  carCards: ['producto-c', 'producto-m', 'producto-u'],
} as const;

describe('the baseline is public everywhere (non-vacuity)', () => {
  it('the unmarked control and the unmarked offer of U are on every surface in every mode', async () => {
    for (const mode of ['off', 'on', ...BACKSTOP_MODES] as LocalFlagMode[]) {
      stubLocalFlag(mode);
      const w = await world();
      expect(await getPublicProductBySlug(w.c.slug), mode).not.toBeNull();
      expect((await getPublicProductBySlug(w.u.slug))?.offers.map((o) => o.offerId), mode).toContain(w.u.offerUnmarked);
      expect(await sitemapProducts(), mode).toEqual([w.c.slug, w.u.slug].sort());
      await resetDatabase();
    }
  });
});

describe.each(['off', ...BACKSTOP_MODES] as LocalFlagMode[])('flag mode %s: marked rows are on no public surface (ACs 15 to 19, 37)', (mode) => {
  it('sweeps every public reader and finds none of M and none of the marked offer of U', async () => {
    stubLocalFlag(mode);
    const w = await world();

    const seen = await view(w);

    expect(seen).toMatchObject(HIDDEN);
    expect(seen).toMatchObject(ALWAYS);
  });

  it('AC 16: the page of M is not found, and the rewrite and a car-filtered address agree', async () => {
    stubLocalFlag(mode);
    const w = await world();

    expect(await getPublicProductBySlug(w.m.slug)).toBeNull();
    expect(await isMissingPublicPage(at(`/producto/${w.m.slug}`))).toBe(true);
    expect(await isMissingPublicPage(at(`/producto/${w.m.slug}?coche=${CAR.slug}`))).toBe(true);
    // The control is not caught by the same answer.
    expect(await isMissingPublicPage(at(`/producto/${w.c.slug}`))).toBe(false);
  });

  it('AC 19: /go for a marked offer answers as for an unknown one and writes no click, while an unmarked offer redirects', async () => {
    stubLocalFlag(mode);
    const w = await world();

    const missing = await callGo(2_000_000_000);
    for (const marked of [w.m.offerId, w.u.offerMarked]) {
      const response = await callGo(marked);
      expect(response.status, String(marked)).toBe(404);
      expect(response.status).toBe(missing.status);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toBe(await missing.clone().text());
    }
    expect(await allClicks()).toHaveLength(0);

    expect((await callGo(w.u.offerUnmarked)).status).toBe(302);
    expect((await callGo(w.c.offerId)).status).toBe(302);
    expect(await allClicks()).toHaveLength(2);
  });

  it('AC 17: the product page, its structured data and its shop count leave the marked offer out', async () => {
    stubLocalFlag(mode);
    const w = await world();
    const page = await getPublicProductBySlug(w.u.slug);

    expect(page?.offers.map((offer) => offer.offerId)).toEqual([w.u.offerUnmarked]);
    expect(page === null ? null : buildProductJsonLd(page)).toMatchObject({
      offers: { lowPrice: '20.00', highPrice: '20.00', offerCount: 1 },
    });
  });

  it('AC 15: a category whose only product is marked lists nothing, counts nothing and has no brand chip', async () => {
    stubLocalFlag(mode);
    await world();
    const catM = await getPublicCategoryPage('cat-m', 1, null, 'price-asc');

    expect(catM).toMatchObject({ state: 'empty-category', productCount: 0, products: [] });
    expect(catM?.brands ?? []).toEqual([]);
  });

  it('AC 30: a marked product that holds an unmarked, otherwise visible offer is still not public, and that offer is not served', async () => {
    stubLocalFlag(mode);
    const w = await world();
    const feed = await insertFeed((await insertShop()).id);
    const written = await insertOffer({ productId: w.m.id, feedId: feed, priceCents: 400 });

    expect(await getPublicProductBySlug(w.m.slug)).toBeNull();
    expect(await isMissingPublicPage(at(`/producto/${w.m.slug}`))).toBe(true);
    expect(await sitemapProducts()).not.toContain(w.m.slug);
    expect((await getPublicCategoryPage('cat-m', 1, null, 'price-asc'))?.productCount).toBe(0);
    expect((await callGo(written)).status).toBe(404);
    expect(await allClicks()).toHaveLength(0);
  });

  it('AC 32: a collected feed fitment counts for no product and no vehicle', async () => {
    stubLocalFlag(mode);
    const w = await world();

    expect(await readProductVehicles(w.m.slug)).toEqual([]);
    expect((await readProductVehicles(w.u.slug)).map((vehicle) => vehicle.slug)).toEqual([CAR.slug]);
    expect(await readProductFitState(w.u.slug, w.carTwoId)).toBe('no-fit');
  });
});

describe('flag on beside a loopback SITE_URL: marked rows show as any row, and nothing else is lifted (ACs 13, 26, 27)', () => {
  it('AC 26: sweeps every public reader and finds M and the marked offer of U as any row', async () => {
    stubLocalFlag('on');
    const w = await world();

    const seen = await view(w);

    expect(seen).toMatchObject(SHOWN);
    expect(seen).toMatchObject(ALWAYS);
  });

  it('non-vacuity: every surface that holds M or the marked offer differs between flag off and flag on', async () => {
    stubLocalFlag('off');
    const w = await world();
    const off = await view(w);
    stubLocalFlag('on');
    const on = await view(w);

    const surfaces = Object.keys(HIDDEN) as (keyof typeof HIDDEN)[];
    // `catUCount` and nothing else is the same: cat-u holds U either way.
    const same = surfaces.filter((key) => JSON.stringify(off[key]) === JSON.stringify(on[key]));
    expect(same).toEqual(['catUCount']);
    expect(Object.keys(SHOWN).sort()).toEqual(Object.keys(HIDDEN).sort());
  });

  it('AC 26: there is no sign that a row is marked on a page read (no field named for it)', async () => {
    stubLocalFlag('on');
    const w = await world();
    const page = await getPublicProductBySlug(w.m.slug);
    const root = await getPublicCategoryPage('raiz', 1, null, 'price-asc');

    for (const text of [JSON.stringify(page), JSON.stringify(root)]) {
      expect(text).not.toMatch(/collected|recopilad|marked|isCollected/i);
    }
  });

  it('a marked offer is also served by /go, redirects to its own address and writes no click', async () => {
    stubLocalFlag('on');
    const w = await world();

    for (const marked of [w.m.offerId, w.u.offerMarked]) {
      const response = await callGo(marked);
      expect(response.status, String(marked)).toBe(302);
      expect(response.headers.get('location')).toBe('https://affiliate.example/never-public');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(await allClicks()).toHaveLength(0);
    // Non-vacuity: an unmarked offer on the same request is a counted click.
    expect((await callGo(w.u.offerUnmarked)).status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });

  it('a HEAD request and a crawler on a marked offer also write no click, and the answer is unchanged', async () => {
    stubLocalFlag('on');
    const w = await world();

    expect((await callGo(w.m.offerId, { method: 'HEAD' })).status).toBe(302);
    expect((await callGo(w.m.offerId, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } })).status).toBe(302);
    expect(await allClicks()).toHaveLength(0);
  });

  // One marked product, closed in exactly one way; the closed product and a control with nothing closed
  // are built together so every absence below is read beside a presence.
  type Closed = { productId: number; offerId: number };
  const NOT_PUBLIC: { name: string; build: () => Promise<Closed> }[] = [
    { name: 'its feed is not approved', build: () => closedProduct({ feed: { isApproved: false } }) },
    { name: 'its shop is not approved', build: () => closedProduct({ shop: { isApproved: false } }) },
    { name: 'its offer is in review', build: () => closedProduct({ offer: { inReview: true } }) },
    {
      name: 'its offer is hidden',
      build: async () => {
        const closed = await closedProduct({});
        await setOfferHidden(closed.offerId, true);
        return closed;
      },
    },
    {
      name: 'its offer is removed by an import',
      build: async () => {
        const closed = await closedProduct({});
        await setOfferRemoved(closed.offerId, true);
        return closed;
      },
    },
    {
      name: 'its product is hidden',
      build: async () => {
        const closed = await closedProduct({});
        await setProductHidden(closed.productId, true);
        return closed;
      },
    },
    { name: 'its product has no category', build: () => closedProduct({ unmapped: true }) },
  ];

  async function closedProduct(o: {
    feed?: { isApproved: boolean };
    shop?: { isApproved: boolean };
    offer?: { inReview: boolean };
    unmapped?: boolean;
  }): Promise<Closed> {
    const { feedId } = await insertCollectedFeed({ isApproved: o.feed?.isApproved, shopApproved: o.shop?.isApproved });
    const category = await insertCategory({ slug: 'cat-prueba' });
    const product = await insertProduct({
      slug: 'marcado-cerrado',
      title: `Filtro ${TERM_M} cerrado`,
      isCollected: true,
      categoryId: o.unmapped ? null : category.id,
    });
    const offerId = await insertOffer({ productId: product.id, feedId, ...o.offer });
    return { productId: product.id, offerId };
  }

  it.each(NOT_PUBLIC)('AC 27: a marked product is on no surface when $name, flag on, while an open marked control is', async ({ build }) => {
    stubLocalFlag('on');
    const closed = await build();
    const category = await insertCategory({ slug: 'cat-abierta' });
    const control = await insertProduct({ slug: 'marcado-abierto', title: `Filtro ${TERM_M} abierto`, isCollected: true, categoryId: category.id });
    const controlOffer = await insertOffer({ productId: control.id, feedId: (await insertCollectedFeed()).feedId });

    expect(await getPublicProductBySlug('marcado-cerrado')).toBeNull();
    expect(await isMissingPublicPage(at('/producto/marcado-cerrado'))).toBe(true);
    expect(await searchSlugs(TERM_M)).toEqual(['marcado-abierto']);
    expect((await getPublicCategoryPage('cat-prueba', 1, null, 'price-asc'))?.products ?? []).toEqual([]);
    expect(await sitemapProducts()).toEqual([]);
    expect((await callGo(closed.offerId)).status).toBe(404);
    // The control is public beside it: the sweep sees marked rows with the flag on.
    expect(await getPublicProductBySlug('marcado-abierto')).not.toBeNull();
    expect((await callGo(controlOffer)).status).toBe(302);
  });

  it('AC 30: a marked product that holds an unmarked visible offer shows with the flag on, and is still never indexed, listed or counted as a click', async () => {
    stubLocalFlag('on');
    const w = await world();
    const feed = await insertFeed((await insertShop()).id);
    const written = await insertOffer({ productId: w.m.id, feedId: feed, priceCents: 400 });

    const page = await getPublicProductBySlug(w.m.slug);
    expect(page?.offers.map((offer) => offer.offerId)).toContain(written);
    expect(page?.indexable).toBe(false);
    expect(await sitemapProducts()).not.toContain(w.m.slug);
    // The offer is served, but its product is marked, so the click is never counted (C-5: the row is marked
    // through its feed or through its product).
    expect((await callGo(written)).status).toBe(302);
    expect(await allClicks()).toHaveLength(0);
  });
});

describe.each(['off', 'on'] as LocalFlagMode[])('indexing and the sitemap, flag %s (ACs 20 to 25)', (mode) => {
  async function sitemapBodies(): Promise<{ index: string; pages: string; products: string | null }> {
    const request = (file: string) => getSitemapFile(new Request(`http://127.0.0.1:3000/sitemaps/${file}`), { params: Promise.resolve({ file }) });
    const first = await request('productos-1.xml');
    return {
      index: await (await getIndex()).text(),
      pages: await (await request('paginas.xml')).text(),
      products: first.status === 200 ? await first.text() : null,
    };
  }

  it('AC 20: a page whose only offers are demo or collected carries no index signal; the page of a real offer does', async () => {
    stubLocalFlag(mode);
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const collected = await insertCollectedFeed();
    const realFeed = await insertFeed((await insertShop()).id);

    const demoAndCollected = await insertProduct({ slug: 'demo-y-recopilado', categoryId: category.id });
    await insertOffer({ productId: demoAndCollected.id, feedId: demoFeed });
    await insertOffer({ productId: demoAndCollected.id, feedId: collected.feedId });
    const real = await insertProduct({ slug: 'con-oferta-real', categoryId: category.id });
    await insertOffer({ productId: real.id, feedId: realFeed });
    await insertOffer({ productId: real.id, feedId: collected.feedId });

    expect((await getPublicProductBySlug('demo-y-recopilado'))?.indexable).toBe(false);
    expect((await getPublicProductBySlug('con-oferta-real'))?.indexable).toBe(true);
  });

  it('AC 20: a marked product is never indexable, though a flag on makes it visible', async () => {
    stubLocalFlag(mode);
    const w = await world();
    const page = await getPublicProductBySlug(w.m.slug);

    // Off: no page at all. On: the page exists and still has no index signal.
    if (mode === 'on') {
      expect(page).not.toBeNull();
      expect(page?.indexable).toBe(false);
    } else {
      expect(page).toBeNull();
    }
  });

  it.each([
    ['hidden', { isHidden: true }, 'real'],
    ['removed by an import', { isRemoved: true }, 'real'],
    ['in review', { inReview: true }, 'real'],
    ['from an unapproved feed', {}, 'unapproved'],
  ] as const)('AC 21: a hand-written offer %s still makes the page indexable', async (_name, state, kind) => {
    stubLocalFlag(mode);
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const feed = await insertFeed((await insertShop()).id, { isApproved: kind === 'real' });
    // The demo offer keeps the page visible in either flag mode; the hand-written offer is the one in a state.
    const product = await insertProduct({ slug: 'con-oferta-en-estado', categoryId: category.id });
    await insertOffer({ productId: product.id, feedId: demoFeed });
    await insertOffer({ productId: product.id, feedId: feed, ...state });

    expect((await getPublicProductBySlug('con-oferta-en-estado'))?.indexable).toBe(true);
  });

  it('AC 21: a collected offer beside a demo one does not make the page indexable (non-vacuity for the rule above)', async () => {
    stubLocalFlag(mode);
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const product = await insertProduct({ slug: 'demo-y-recopilada', categoryId: category.id });
    await insertOffer({ productId: product.id, feedId: demoFeed });
    await insertOffer({ productId: product.id, feedId: (await insertCollectedFeed()).feedId });

    const page = await getPublicProductBySlug('demo-y-recopilada');
    expect(page?.indexable).toBe(false);
    // Off: the collected offer is not on the page. On: it is, and the page is still not indexable.
    expect(page?.offers).toHaveLength(mode === 'on' ? 2 : 1);
  });

  it('AC 22: a category is indexable only when its subtree holds a visible product with an offer that is neither demo nor collected', async () => {
    stubLocalFlag(mode);
    const root = await insertCategory({ slug: 'raiz' });
    const onlyMarked = await insertCategory({ slug: 'solo-marcados', parentId: root.id });
    const markedAndDemo = await insertCategory({ slug: 'marcado-y-demo', parentId: root.id });
    const markedAndReal = await insertCategory({ slug: 'marcado-y-real', parentId: root.id });
    const collected = await insertCollectedFeed();
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id);

    const a = await insertProduct({ slug: 'a', categoryId: onlyMarked.id, isCollected: true });
    await insertOffer({ productId: a.id, feedId: collected.feedId });
    const b = await insertProduct({ slug: 'b', categoryId: markedAndDemo.id, isCollected: true });
    await insertOffer({ productId: b.id, feedId: collected.feedId });
    const bDemo = await insertProduct({ slug: 'b-demo', categoryId: markedAndDemo.id });
    await insertOffer({ productId: bDemo.id, feedId: demoFeed });
    const c = await insertProduct({ slug: 'c', categoryId: markedAndReal.id, isCollected: true });
    await insertOffer({ productId: c.id, feedId: collected.feedId });
    const cReal = await insertProduct({ slug: 'c-real', categoryId: markedAndReal.id });
    await insertOffer({ productId: cReal.id, feedId: realFeed });

    const indexable = async (slug: string) => (await getPublicCategoryPage(slug, 1, null, 'price-asc'))?.indexable;
    expect(await indexable('solo-marcados')).toBe(false);
    expect(await indexable('marcado-y-demo')).toBe(false);
    expect(await indexable('marcado-y-real')).toBe(true);
    expect(await indexable('raiz')).toBe(true);
    // The marked products show only with the flag on; the answer above is the same either way.
    expect((await getPublicCategoryPage('solo-marcados', 1, null, 'price-asc'))?.productCount).toBe(mode === 'on' ? 1 : 0);
  });

  it('AC 23: no sitemap file lists a marked-only product or a category holding only marked products; a product with a real offer too is still listed', async () => {
    stubLocalFlag(mode);
    const w = await world();
    const realToo = await insertProduct({ slug: 'marcado-con-real', categoryId: (await insertCategory({ slug: 'cat-mixta' })).id });
    await insertOffer({ productId: realToo.id, feedId: (await insertCollectedFeed()).feedId });
    await insertOffer({ productId: realToo.id, feedId: await insertFeed((await insertShop()).id) });

    const bodies = await sitemapBodies();

    expect(bodies.products).not.toBeNull();
    expect(bodies.products).not.toContain(`/producto/${w.m.slug}<`);
    expect(bodies.products).toContain(`/producto/${w.u.slug}<`);
    expect(bodies.products).toContain('/producto/marcado-con-real<');
    expect(bodies.pages).not.toContain('/categoria/cat-m<');
    expect(bodies.pages).toContain('/categoria/cat-u<');
    expect(bodies.pages).toContain('/categoria/cat-mixta<');
    expect(bodies.index).toContain('/sitemaps/paginas.xml');
    expect(await sitemapProducts()).not.toContain(w.m.slug);
    expect(await getSitemapCategorySlugs()).not.toContain('cat-m');
  });

  it('AC 23: a sitemap holding only marked products has no product file and no category', async () => {
    stubLocalFlag(mode);
    const collected = await insertCollectedFeed();
    const category = await insertCategory({ slug: 'solo-marcada' });
    const product = await insertProduct({ slug: 'unica-marcada', categoryId: category.id, isCollected: true });
    await insertOffer({ productId: product.id, feedId: collected.feedId });

    const bodies = await sitemapBodies();

    expect(bodies.products).toBeNull();
    expect(bodies.index).not.toContain('productos-');
    expect(bodies.pages).not.toContain('/categoria/');
  });

  it('AC 25: demo data behaves as before: a demo-only product is listed nowhere and is noindex', async () => {
    stubLocalFlag(mode);
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const demo = await insertProduct({ slug: 'solo-demo', categoryId: category.id });
    await insertOffer({ productId: demo.id, feedId: demoFeed });

    expect(await sitemapProducts()).toEqual([]);
    expect(await getSitemapCategorySlugs()).toEqual([]);
    expect((await getPublicProductBySlug('solo-demo'))?.indexable).toBe(false);
    expect((await getPublicProductBySlug('solo-demo'))?.demoOnly).toBe(true);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.indexable).toBe(false);
  });
});
