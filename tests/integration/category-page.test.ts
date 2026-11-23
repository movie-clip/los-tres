import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { categories, feeds, offers, products } from '@/db/schema';
import { selectedVehicleId, type CarContext } from '@/server/car/state';
import { CATEGORY_PAGE_SIZE, getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertFeed,
  insertFitment,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
  insertVehicle,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';
import { startRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(resetDatabase);
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const slugsOf = (page: Awaited<ReturnType<typeof getPublicCategoryPage>>) =>
  page?.products.map((card) => card.slug);

describe('getPublicCategoryPage shape (C-3)', () => {
  it('returns the category, the page numbers and one card per public product', async () => {
    const category = await insertCategory({ slug: 'filtros', name: 'Filtros' });
    await insertListedProduct({
      slug: 'filtro-a',
      title: 'Filtro A',
      brand: 'MarcaX',
      prices: [1299, 1149],
      categoryId: category.id,
    });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');

    expect(page).toEqual({
      slug: 'filtros',
      name: 'Filtros',
      page: 1,
      pageCount: 1,
      productCount: 1,
      categoryProductCount: 1,
      state: 'results',
      fit: null,
      products: [
        {
          slug: 'filtro-a',
          title: 'Filtro A',
          brand: 'MarcaX',
          lowestPriceCents: 1149,
          offerCount: 2,
          categorySlug: 'filtros',
          partNumber: null,
          fitGroup: null,
        },
      ],
      // The fixture sets no brand_normalised, so the product has no chip.
      brands: [],
      ancestors: [],
      selectedBrand: null,
      sort: 'price-asc',
      demoOnly: false,
      indexable: true,
    });
  });

  it('returns numbers, not strings, for the aggregates (Postgres count is a bigint)', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'filtro-a', prices: [500, 700, 900], categoryId: category.id });
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(typeof page?.productCount).toBe('number');
    expect(typeof page?.products[0].offerCount).toBe('number');
    expect(typeof page?.products[0].lowestPriceCents).toBe('number');
    expect(page?.products[0]).toMatchObject({ lowestPriceCents: 500, offerCount: 3 });
  });

  it('returns brand null as null, not an empty string', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'sin-marca', prices: [100], brand: null, categoryId: category.id });
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.products[0].brand).toBeNull();
  });
});

describe('the lowest price and the shop count (AC 17, AC 18)', () => {
  it('reads one shop as offerCount 1 with its own price', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'un-solo-shop', prices: [4990], categoryId: category.id });
    const [card] = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.products ?? [];
    expect(card).toMatchObject({ lowestPriceCents: 4990, offerCount: 1 });
  });

  it('equals the first offer and the offer count of the same product page', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'a', prices: [1299, 1149, 2000], categoryId: category.id });
    await insertListedProduct({ slug: 'b', prices: [350], categoryId: category.id });

    const listing = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(listing?.products).toHaveLength(2);
    for (const card of listing?.products ?? []) {
      const product = await getPublicProductBySlug(card.slug);
      expect(card.lowestPriceCents).toBe(product?.offers[0].priceCents);
      expect(card.offerCount).toBe(product?.offers.length);
    }
  });

  it('ignores a cheaper offer that is not visible, in both the price and the count', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const product = await insertListedProduct({
      slug: 'con-oculta',
      prices: [100, 200, 300, 400],
      categoryId: category.id,
    });
    const [hidden, inReview, unapprovedFeed] = product.offerIds;
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, hidden));
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, inReview));
    const [row] = await getDb().select().from(offers).where(eq(offers.id, unapprovedFeed));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, row.feedId));

    const [card] = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.products ?? [];
    expect(card).toMatchObject({ lowestPriceCents: 400, offerCount: 1 });
    const page = await getPublicProductBySlug('con-oculta');
    expect(page?.offers.map((offer) => offer.priceCents)).toEqual([400]);
  });

  it('counts two offers from the same shop as two (D-5, same number as the product page)', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const shop = await insertShop();
    const feedA = await insertFeed(shop.id);
    const feedB = await insertFeed(shop.id);
    const first = await insertListedProduct({ slug: 'mismo-shop', prices: [900], categoryId: category.id, feedId: feedA });
    await getDb().insert(offers).values({
      productId: first.id,
      feedId: feedB,
      externalId: 'otra',
      priceCents: 800,
      url: 'https://affiliate.example/otra',
      priceUpdatedAt: new Date('2026-10-01T10:00:00Z'),
    });
    const [card] = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.products ?? [];
    expect(card.offerCount).toBe((await getPublicProductBySlug('mismo-shop'))?.offers.length);
    expect(card).toMatchObject({ lowestPriceCents: 800, offerCount: 2 });
  });
});

describe('which products are listed (guardrail 1, AC 1, AC 4, AC 10)', () => {
  it('lists none of: unmapped, hidden, unapproved-feed, in-queue, offerless, or another category', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const other = await insertCategory({ slug: 'otra' });
    await insertListedProduct({ slug: 'publico', prices: [100], categoryId: category.id });
    await insertListedProduct({ slug: 'sin-categoria', prices: [100], categoryId: null });
    await insertListedProduct({ slug: 'oculto', prices: [100], categoryId: category.id, isHidden: true });
    const unapproved = await insertListedProduct({ slug: 'feed-apagado', prices: [100], categoryId: category.id });
    const queued = await insertListedProduct({ slug: 'en-cola', prices: [100], categoryId: category.id });
    await insertListedProduct({ slug: 'sin-ofertas', prices: [], categoryId: category.id });
    await insertListedProduct({ slug: 'de-otra', prices: [100], categoryId: other.id });
    const [offer] = await getDb().select().from(offers).where(eq(offers.id, unapproved.offerIds[0]));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, offer.feedId));
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, queued.offerIds[0]));

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');

    expect(slugsOf(page)).toEqual(['publico']);
    expect(page?.productCount).toBe(1);
  });

  it('lists a product once it is mapped, and not before', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const product = await insertListedProduct({ slug: 'se-mapea', prices: [100], categoryId: null });
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.productCount).toBe(0);

    await getDb().update(products).set({ categoryId: category.id }).where(eq(products.id, product.id));

    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'))).toEqual(['se-mapea']);
  });

  it('drops a product again when an admin hides it', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const product = await insertListedProduct({ slug: 'a', prices: [100], categoryId: category.id });
    await insertListedProduct({ slug: 'b', prices: [200], categoryId: category.id });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'))).toEqual(['b']);
  });
});

describe('the subtree (OD-A, AC 9)', () => {
  async function tree() {
    const root = await insertCategory({ slug: 'raiz', name: 'Raíz' });
    const child = await insertCategory({ slug: 'hija', parentId: root.id });
    const grandchild = await insertCategory({ slug: 'nieta', parentId: child.id });
    const sibling = await insertCategory({ slug: 'hermana', parentId: root.id });
    return { root, child, grandchild, sibling };
  }

  it('includes products of a child and a grandchild in the root, with a root-only count', async () => {
    const { root, child, grandchild } = await tree();
    await insertListedProduct({ slug: 'en-raiz', prices: [100], categoryId: root.id });
    await insertListedProduct({ slug: 'en-hija', prices: [200], categoryId: child.id });
    await insertListedProduct({ slug: 'en-nieta', prices: [300], categoryId: grandchild.id });

    const page = await getPublicCategoryPage('raiz', 1, null, 'price-asc');

    expect(slugsOf(page)).toEqual(['en-raiz', 'en-hija', 'en-nieta']);
    expect(page?.productCount).toBe(3);
  });

  it('lists a product of a root that has none of its own, only through a child', async () => {
    const { child } = await tree();
    await insertListedProduct({ slug: 'solo-hija', prices: [100], categoryId: child.id });
    expect(slugsOf(await getPublicCategoryPage('raiz', 1, null, 'price-asc'))).toEqual(['solo-hija']);
  });

  it('does not include a parent or a sibling in a child page', async () => {
    const { root, child, sibling } = await tree();
    await insertListedProduct({ slug: 'en-raiz', prices: [100], categoryId: root.id });
    await insertListedProduct({ slug: 'en-hermana', prices: [100], categoryId: sibling.id });
    await insertListedProduct({ slug: 'en-hija', prices: [100], categoryId: child.id });
    expect(slugsOf(await getPublicCategoryPage('hija', 1, null, 'price-asc'))).toEqual(['en-hija']);
  });

  it('lists a product with offers in several shops once, not once per offer or path', async () => {
    const { root, child } = await tree();
    await insertListedProduct({ slug: 'multi', prices: [100, 200, 300], categoryId: child.id });
    await insertListedProduct({ slug: 'otra', prices: [400], categoryId: root.id });
    const page = await getPublicCategoryPage('raiz', 1, null, 'price-asc');
    expect(slugsOf(page)?.filter((slug) => slug === 'multi')).toHaveLength(1);
    expect(page?.productCount).toBe(2);
    expect(page?.products).toHaveLength(2);
  });

  it('terminates on a malformed parent cycle and still lists the products', async () => {
    const a = await insertCategory({ slug: 'ciclo-a' });
    const b = await insertCategory({ slug: 'ciclo-b', parentId: a.id });
    await getDb().update(categories).set({ parentId: b.id }).where(eq(categories.id, a.id));
    await insertListedProduct({ slug: 'en-a', prices: [100], categoryId: a.id });
    await insertListedProduct({ slug: 'en-b', prices: [200], categoryId: b.id });

    const page = await getPublicCategoryPage('ciclo-a', 1, null, 'price-asc');

    expect(slugsOf(page)).toEqual(['en-a', 'en-b']);
    expect(page?.productCount).toBe(2);
  });
});

describe('order (OD-B, AC 11)', () => {
  it('orders by lowest visible price ascending, then by product id', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'caro', prices: [3000], categoryId: category.id });
    await insertListedProduct({ slug: 'empate-1', prices: [1000], categoryId: category.id });
    await insertListedProduct({ slug: 'barato', prices: [500, 9000], categoryId: category.id });
    await insertListedProduct({ slug: 'empate-2', prices: [1000], categoryId: category.id });

    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'))).toEqual([
      'barato',
      'empate-1',
      'empate-2',
      'caro',
    ]);
  });

  it('orders by the lowest price, not the first offer: a product with a dear and a cheap offer ranks by the cheap one', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'medio', prices: [800], categoryId: category.id });
    await insertListedProduct({ slug: 'dos-ofertas', prices: [5000, 700], categoryId: category.id });
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'))).toEqual(['dos-ofertas', 'medio']);
  });

  it('returns the same order on every request for the same data', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (let index = 0; index < 8; index += 1) {
      await insertListedProduct({ slug: `igual-${index}`, prices: [1000], categoryId: category.id });
    }
    const first = slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'));
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc'))).toEqual(first);
    }
  });
});

describe('pagination (OD-C, OD-E, AC 12, AC 13)', () => {
  async function seed(count: number) {
    const category = await insertCategory({ slug: 'filtros' });
    const feedId = await insertFeed((await insertShop()).id);
    for (let index = 0; index < count; index += 1) {
      // Distinct prices keep the expected order obvious: p-00 is the cheapest.
      await insertListedProduct({
        slug: `p-${String(index).padStart(2, '0')}`,
        prices: [1000 + index],
        categoryId: category.id,
        feedId,
      });
    }
  }

  it('uses a page size of 24', () => {
    expect(CATEGORY_PAGE_SIZE).toBe(24);
  });

  it('puts exactly one page of 24 products on a single page', async () => {
    await seed(24);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page).toMatchObject({ page: 1, pageCount: 1, productCount: 24 });
    expect(page?.products).toHaveLength(24);
    expect(await getPublicCategoryPage('filtros', 2, null, 'price-asc')).toBeNull();
  });

  it('splits 26 products into 24 and 2 with no overlap and no gap', async () => {
    await seed(26);
    const first = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    const second = await getPublicCategoryPage('filtros', 2, null, 'price-asc');

    expect(first).toMatchObject({ page: 1, pageCount: 2, productCount: 26 });
    expect(second).toMatchObject({ page: 2, pageCount: 2, productCount: 26 });
    expect(first?.products).toHaveLength(24);
    expect(second?.products).toHaveLength(2);
    const all = [...(slugsOf(first) ?? []), ...(slugsOf(second) ?? [])];
    expect(new Set(all).size).toBe(26);
    expect(all).toEqual(Array.from({ length: 26 }, (_, index) => `p-${String(index).padStart(2, '0')}`));
  });

  it('opens 25 products as two pages, the second with one product', async () => {
    await seed(25);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.pageCount).toBe(2);
    expect((await getPublicCategoryPage('filtros', 2, null, 'price-asc'))?.products).toHaveLength(1);
  });

  it('returns null past the last page and for an absurdly large page', async () => {
    await seed(26);
    expect(await getPublicCategoryPage('filtros', 3, null, 'price-asc')).toBeNull();
    expect(await getPublicCategoryPage('filtros', Number.MAX_SAFE_INTEGER, null, 'price-asc')).toBeNull();
  });
});

describe('empty category (AC 14)', () => {
  it('returns one empty page for a category with no products at all', async () => {
    await insertCategory({ slug: 'vacia', name: 'Vacía' });
    expect(await getPublicCategoryPage('vacia', 1, null, 'price-asc')).toEqual({
      slug: 'vacia',
      name: 'Vacía',
      page: 1,
      pageCount: 1,
      productCount: 0,
      categoryProductCount: 0,
      state: 'empty-category',
      fit: null,
      products: [],
      brands: [],
      ancestors: [],
      selectedBrand: null,
      sort: 'price-asc',
      demoOnly: false,
      indexable: false,
    });
  });

  it('returns null for page 2 of an empty category: it has exactly one page', async () => {
    await insertCategory({ slug: 'vacia' });
    expect(await getPublicCategoryPage('vacia', 2, null, 'price-asc')).toBeNull();
  });

  it('is empty, not missing, when every product in it is hidden, without offers, or lives unmapped', async () => {
    const category = await insertCategory({ slug: 'vacia' });
    await insertListedProduct({ slug: 'oculto', prices: [100], categoryId: category.id, isHidden: true });
    await insertListedProduct({ slug: 'sin-ofertas', prices: [], categoryId: category.id });
    await insertListedProduct({ slug: 'sin-mapa', prices: [100], categoryId: null });
    expect(await getPublicCategoryPage('vacia', 1, null, 'price-asc')).toMatchObject({ productCount: 0, products: [], pageCount: 1 });
  });
});

describe('unknown and malformed slugs (AC 15)', () => {
  it('returns null for an unknown slug', async () => {
    await insertCategory({ slug: 'existe' });
    expect(await getPublicCategoryPage('no-existe', 1, null, 'price-asc')).toBeNull();
  });

  it('returns null for each malformed slug even while the database is unreachable', async () => {
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const malformed = ['', 'Bad_Slug', 'UPPER', 'a b', 'a--b', '-lead', 'trail-', 'a/b', "x'; --", 'ñandú', 'a'.repeat(121)];
    for (const slug of malformed) {
      expect(await getPublicCategoryPage(slug, 1, null, 'price-asc'), JSON.stringify(slug)).toBeNull();
    }
    // Control: a well-formed slug does query, and so fails on the dead database.
    await expect(getPublicCategoryPage('well-formed', 1, null, 'price-asc')).rejects.toBeDefined();

    vi.unstubAllEnvs();
    await closeDb();
  });
});

// Hoisted by vitest: generateMetadata of the category page looks its copy up
// through next-intl/server, which needs a request. The canonical tests below
// only read the SEO fields.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
// The same metadata reads the selected car (S5.7) from the request headers the
// proxy sets; `startRequest` below gives it a request.
vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

// ---------------------------------------------------------------------------
// S11.4: sort, brand filter, brand list and the three listing states.
// ---------------------------------------------------------------------------

/** A listed product with a brand pair set the way the importer would (brand_normalised is upper case). */
async function listBranded(o: {
  slug: string;
  categoryId: number | null;
  brand: string | null;
  brandNormalised?: string | null;
  prices?: number[];
  title?: string;
  partNumber?: string | null;
  feedId?: number;
}) {
  const product = await insertListedProduct({
    slug: o.slug,
    prices: o.prices ?? [1000],
    categoryId: o.categoryId,
    brand: o.brand,
    feedId: o.feedId,
    ...(o.title === undefined ? {} : { title: o.title }),
  });
  await getDb()
    .update(products)
    .set({
      brandNormalised:
        o.brandNormalised === undefined ? (o.brand?.toUpperCase() ?? null) : o.brandNormalised,
      ...(o.partNumber === undefined ? {} : { partNumber: o.partNumber }),
    })
    .where(eq(products.id, product.id));
  return product;
}

const brandSlugs = (page: Awaited<ReturnType<typeof getPublicCategoryPage>>) =>
  page?.brands.map((brand) => brand.slug);

describe('ancestors (S11.6)', () => {
  async function chain() {
    const root = await insertCategory({ slug: 'raiz', name: 'Raíz' });
    const child = await insertCategory({ slug: 'hija', name: 'Hija', parentId: root.id });
    const grandchild = await insertCategory({ slug: 'nieta', name: 'Nieta', parentId: child.id });
    return { root, child, grandchild };
  }

  it('is empty for a root category', async () => {
    await chain();
    expect((await getPublicCategoryPage('raiz', 1, null, 'price-asc'))?.ancestors).toEqual([]);
  });

  it('holds the root alone for a leaf one level down, as slug and name', async () => {
    await chain();
    expect((await getPublicCategoryPage('hija', 1, null, 'price-asc'))?.ancestors).toEqual([
      { slug: 'raiz', name: 'Raíz' },
    ]);
  });

  it('lists the ancestors root first and leaves the category itself out on a three-level tree', async () => {
    await chain();
    const page = await getPublicCategoryPage('nieta', 1, null, 'price-asc');
    expect(page?.ancestors).toEqual([
      { slug: 'raiz', name: 'Raíz' },
      { slug: 'hija', name: 'Hija' },
    ]);
    expect(page?.slug).toBe('nieta');
  });

  it('does not list a sibling or a child as an ancestor', async () => {
    const { root } = await chain();
    await insertCategory({ slug: 'hermana', name: 'Hermana', parentId: root.id });
    const page = await getPublicCategoryPage('hija', 1, null, 'price-asc');
    expect(page?.ancestors.map((crumb) => crumb.slug)).toEqual(['raiz']);
  });

  it('is the same in every state: results, no-match and empty-category', async () => {
    const { child } = await chain();
    const expected = [{ slug: 'raiz', name: 'Raíz' }];
    // empty-category
    expect((await getPublicCategoryPage('hija', 1, null, 'price-asc'))?.state).toBe('empty-category');
    expect((await getPublicCategoryPage('hija', 1, null, 'price-asc'))?.ancestors).toEqual(expected);
    // results
    await listBranded({ slug: 'a', categoryId: child.id, brand: 'Bosch' });
    const results = await getPublicCategoryPage('hija', 1, null, 'price-asc');
    expect(results?.state).toBe('results');
    expect(results?.ancestors).toEqual(expected);
    // no-match
    const noMatch = await getPublicCategoryPage('hija', 1, 'no-existe', 'price-asc');
    expect(noMatch?.state).toBe('no-match');
    expect(noMatch?.ancestors).toEqual(expected);
  });

  it('is the same on every page, brand and sort', async () => {
    const { child } = await chain();
    for (let n = 0; n < 26; n += 1) {
      await listBranded({ slug: `p-${n}`, categoryId: child.id, brand: n % 2 ? 'Bosch' : 'Mahle', prices: [100 + n] });
    }
    const expected = [{ slug: 'raiz', name: 'Raíz' }];
    for (const [page, brand, sort] of [
      [1, null, 'price-asc'],
      [2, null, 'price-asc'],
      [1, 'bosch', 'price-desc'],
      [1, 'mahle', 'name'],
    ] as const) {
      const read = await getPublicCategoryPage('hija', page, brand, sort);
      expect(read?.ancestors, `${page} ${brand} ${sort}`).toEqual(expected);
    }
  });

  it('is empty for a root even when its subtree holds products', async () => {
    const { child } = await chain();
    await listBranded({ slug: 'a', categoryId: child.id, brand: 'Bosch' });
    const page = await getPublicCategoryPage('raiz', 1, null, 'price-asc');
    expect(page?.productCount).toBe(1);
    expect(page?.ancestors).toEqual([]);
  });

  it('answers null for an unknown slug and for a page past the last, so no trail is produced', async () => {
    await chain();
    expect(await getPublicCategoryPage('no-existe', 1, null, 'price-asc')).toBeNull();
    expect(await getPublicCategoryPage('hija', 9, null, 'price-asc')).toBeNull();
  });

  it('terminates on a parent cycle and still answers', async () => {
    const a = await insertCategory({ slug: 'ciclo-a', name: 'A' });
    const b = await insertCategory({ slug: 'ciclo-b', name: 'B', parentId: a.id });
    await getDb().update(categories).set({ parentId: b.id }).where(eq(categories.id, a.id));
    const page = await getPublicCategoryPage('ciclo-b', 1, null, 'price-asc');
    expect(page).not.toBeNull();
    expect(Array.isArray(page?.ancestors)).toBe(true);
  });
});

describe('sort (S11.4)', () => {
  it('echoes the sort it applied', async () => {
    await insertCategory({ slug: 'filtros' });
    for (const sort of ['price-asc', 'price-desc', 'name'] as const) {
      expect((await getPublicCategoryPage('filtros', 1, null, sort))?.sort).toBe(sort);
    }
  });

  it('orders by lowest price descending, then by product id ascending', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'barato', prices: [500, 9000], categoryId: category.id });
    await insertListedProduct({ slug: 'empate-1', prices: [1000], categoryId: category.id });
    await insertListedProduct({ slug: 'caro', prices: [3000], categoryId: category.id });
    await insertListedProduct({ slug: 'empate-2', prices: [1000], categoryId: category.id });

    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-desc'))).toEqual([
      'caro',
      'empate-1',
      'empate-2',
      'barato',
    ]);
  });

  it('ranks by the lowest visible offer under price-desc: a hidden cheap offer does not count', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'medio', prices: [800], categoryId: category.id });
    const dual = await insertListedProduct({ slug: 'doble', prices: [100, 5000], categoryId: category.id });
    // With the 100 offer visible, doble ranks by 100 and comes last under price-desc.
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-desc'))).toEqual(['medio', 'doble']);
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, dual.offerIds[0]));
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-desc'))).toEqual(['doble', 'medio']);
  });

  it('orders by name ignoring accents and case: Ábaco, abeto, Bosch, nada, zeta', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    // Inserted scrambled, so neither insertion order nor byte order can give the expected one.
    const titles: [string, string][] = [
      ['t-zeta', 'zeta'],
      ['t-bosch', 'Bosch X'],
      ['t-abaco', 'Ábaco'],
      ['t-nada', 'nada'],
      ['t-abeto', 'abeto'],
    ];
    for (const [slug, title] of titles) {
      await insertListedProduct({ slug, title, prices: [1000], categoryId: category.id });
    }
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'name'))).toEqual([
      't-abaco',
      't-abeto',
      't-bosch',
      't-nada',
      't-zeta',
    ]);
  });

  it('sorts a title that starts with an upper-case accented letter among its base letter', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (const [slug, title] of [
      ['o-zorro', 'Zorro'],
      ['o-oleo', 'Óleo'],
      ['o-ocaso', 'ocaso'],
      ['o-pino', 'Pino'],
    ]) {
      await insertListedProduct({ slug, title, prices: [1000], categoryId: category.id });
    }
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'name'))).toEqual([
      'o-ocaso',
      'o-oleo',
      'o-pino',
      'o-zorro',
    ]);
  });

  describe.each(['price-asc', 'price-desc', 'name'] as const)('the id tiebreak under %s', (sort) => {
    it('splits 30 equal products into 24 and 6 with no repeat, no gap, in id order', async () => {
      const category = await insertCategory({ slug: 'filtros' });
      const feedId = await insertFeed((await insertShop()).id);
      const ids: string[] = [];
      for (let index = 0; index < 30; index += 1) {
        const slug = `igual-${String(index).padStart(2, '0')}`;
        ids.push(slug);
        // Same title and same price: only products.id can order them.
        await insertListedProduct({ slug, title: 'Igual', prices: [1000], categoryId: category.id, feedId });
      }
      const first = await getPublicCategoryPage('filtros', 1, null, sort);
      const second = await getPublicCategoryPage('filtros', 2, null, sort);
      expect(first?.products).toHaveLength(24);
      expect(second?.products).toHaveLength(6);
      expect([...(slugsOf(first) ?? []), ...(slugsOf(second) ?? [])]).toEqual(ids);
    });
  });

  it('keeps every product exactly once across pages for each sort on a mixed set', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const feedId = await insertFeed((await insertShop()).id);
    for (let index = 0; index < 26; index += 1) {
      await insertListedProduct({
        slug: `m-${String(index).padStart(2, '0')}`,
        title: `Título ${index % 4}`,
        prices: [1000 + (index % 3)],
        categoryId: category.id,
        feedId,
      });
    }
    for (const sort of ['price-asc', 'price-desc', 'name'] as const) {
      const all = [
        ...(slugsOf(await getPublicCategoryPage('filtros', 1, null, sort)) ?? []),
        ...(slugsOf(await getPublicCategoryPage('filtros', 2, null, sort)) ?? []),
      ];
      expect(new Set(all).size, sort).toBe(26);
    }
  });

  it('does not change the counts, the brand list or the state', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch', prices: [100] });
    await listBranded({ slug: 'b', categoryId: category.id, brand: 'Mahle', prices: [200] });
    const asc = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    const name = await getPublicCategoryPage('filtros', 1, null, 'name');
    expect(name).toMatchObject({
      productCount: asc?.productCount,
      categoryProductCount: asc?.categoryProductCount,
      state: asc?.state,
      pageCount: asc?.pageCount,
    });
    expect(name?.brands).toEqual(asc?.brands);
  });
});

describe('brand list (S11.4)', () => {
  it('lists each brand once with its public product count, most products first', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'b1', categoryId: category.id, brand: 'Bosch' });
    await listBranded({ slug: 'm1', categoryId: category.id, brand: 'Mahle' });
    await listBranded({ slug: 'm2', categoryId: category.id, brand: 'Mahle' });
    await listBranded({ slug: 'm3', categoryId: category.id, brand: 'Mahle' });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');

    expect(page?.brands).toEqual([
      { slug: 'mahle', label: 'Mahle', productCount: 3 },
      { slug: 'bosch', label: 'Bosch', productCount: 1 },
    ]);
  });

  it('breaks a count tie by label, then slug, accents and case aside', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (const [index, brand] of ['Zeta', 'ábaco', 'Mann', 'Abeto'].entries()) {
      await listBranded({ slug: `t-${index}`, categoryId: category.id, brand });
    }
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands.map((b) => b.label)).toEqual([
      'ábaco',
      'Abeto',
      'Mann',
      'Zeta',
    ]);
  });

  it('counts the whole subtree, children included', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    const child = await insertCategory({ slug: 'hija', parentId: root.id });
    await listBranded({ slug: 'en-raiz', categoryId: root.id, brand: 'Bosch' });
    await listBranded({ slug: 'en-hija', categoryId: child.id, brand: 'Bosch' });
    expect((await getPublicCategoryPage('raiz', 1, null, 'price-asc'))?.brands).toEqual([
      { slug: 'bosch', label: 'Bosch', productCount: 2 },
    ]);
    expect((await getPublicCategoryPage('hija', 1, null, 'price-asc'))?.brands).toEqual([
      { slug: 'bosch', label: 'Bosch', productCount: 1 },
    ]);
  });

  it('is independent of the selected brand and of the sort', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'b1', categoryId: category.id, brand: 'Bosch', prices: [300] });
    await listBranded({ slug: 'm1', categoryId: category.id, brand: 'Mahle', prices: [200] });
    await listBranded({ slug: 'm2', categoryId: category.id, brand: 'Mahle', prices: [100] });

    const reference = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands;
    expect(reference).toHaveLength(2);
    for (const brand of [null, 'bosch', 'mahle', 'no-existe']) {
      for (const sort of ['price-asc', 'price-desc', 'name'] as const) {
        expect((await getPublicCategoryPage('filtros', 1, brand, sort))?.brands, `${brand} ${sort}`).toEqual(
          reference,
        );
      }
    }
  });

  it('merges brands that share a slug into one chip with the counts summed', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'x1', categoryId: category.id, brand: 'A B', brandNormalised: 'A B' });
    await listBranded({ slug: 'x2', categoryId: category.id, brand: 'A-B', brandNormalised: 'A-B' });
    await listBranded({ slug: 'x3', categoryId: category.id, brand: 'a.b', brandNormalised: 'A.B' });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');

    expect(page?.brands).toHaveLength(1);
    expect(page?.brands[0]).toMatchObject({ slug: 'a-b', productCount: 3 });
    // The chip filters all three spellings, not only the one that named it.
    const filtered = await getPublicCategoryPage('filtros', 1, 'a-b', 'price-asc');
    expect(filtered).toMatchObject({ productCount: 3, state: 'results' });
    expect(filtered?.products).toHaveLength(3);
  });

  it('labels a merged chip with the spelling of its larger group', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'y1', categoryId: category.id, brand: 'Mann Filter', brandNormalised: 'MANN FILTER' });
    await listBranded({ slug: 'y2', categoryId: category.id, brand: 'Mann-Filter', brandNormalised: 'MANN-FILTER' });
    await listBranded({ slug: 'y3', categoryId: category.id, brand: 'Mann-Filter', brandNormalised: 'MANN-FILTER' });
    const [brand] = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands ?? [];
    expect(brand).toEqual({ slug: 'mann-filter', label: 'Mann-Filter', productCount: 3 });
  });

  it('labels a brand with its most frequent raw spelling', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (const [index, raw] of ['Bosch', 'Bosch', 'Bosch', 'BOSCH'].entries()) {
      await listBranded({ slug: `z${index}`, categoryId: category.id, brand: raw, brandNormalised: 'BOSCH' });
    }
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands).toEqual([
      { slug: 'bosch', label: 'Bosch', productCount: 4 },
    ]);
  });

  it('gives no chip to a product with a null or blank brand, which stays in the whole-category count', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'sin-marca', categoryId: category.id, brand: null });
    await listBranded({ slug: 'marca-vacia', categoryId: category.id, brand: '', brandNormalised: null });
    await listBranded({ slug: 'con-marca', categoryId: category.id, brand: 'Bosch' });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');

    expect(page?.brands).toEqual([{ slug: 'bosch', label: 'Bosch', productCount: 1 }]);
    expect(page).toMatchObject({ categoryProductCount: 3, productCount: 3 });
  });

  it('gives no chip to a brand whose slug is empty, and keeps the product listed', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'signos', categoryId: category.id, brand: '!!!', brandNormalised: '!!!' });
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.brands).toEqual([]);
    expect(slugsOf(page)).toEqual(['signos']);
    expect(page?.categoryProductCount).toBe(1);
  });

  it('gives every chip a slug in the public format, unique in the list', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (const [index, brand] of ['Mann-Filter', 'Citroën', 'A  B', 'x'.repeat(100)].entries()) {
      await listBranded({ slug: `f${index}`, categoryId: category.id, brand });
    }
    const slugs = brandSlugs(await getPublicCategoryPage('filtros', 1, null, 'price-asc')) ?? [];
    expect(slugs).toHaveLength(4);
    expect(new Set(slugs).size).toBe(4);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(64);
    }
  });

  it('is empty for an empty category and for one with no branded product', async () => {
    await insertCategory({ slug: 'vacia' });
    expect((await getPublicCategoryPage('vacia', 1, null, 'price-asc'))?.brands).toEqual([]);
  });
});

describe('brand list and filter hide what the public must not see (guardrail 1, S11.4)', () => {
  async function scene() {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'visible-1', categoryId: category.id, brand: 'Bosch' });
    const hidden = await listBranded({ slug: 'oculto', categoryId: category.id, brand: 'Bosch' });
    const unapproved = await listBranded({ slug: 'feed-apagado', categoryId: category.id, brand: 'Bosch' });
    const queued = await listBranded({ slug: 'en-cola', categoryId: category.id, brand: 'Bosch' });
    await listBranded({ slug: 'sin-ofertas', categoryId: category.id, brand: 'Bosch', prices: [] });
    await listBranded({ slug: 'sin-mapa', categoryId: null, brand: 'Bosch' });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, hidden.id));
    const [offer] = await getDb().select().from(offers).where(eq(offers.id, unapproved.offerIds[0]));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, offer.feedId));
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, queued.offerIds[0]));
    return category;
  }

  it('counts only the one public Bosch product in the chip and in the whole-category count', async () => {
    await scene();
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.brands).toEqual([{ slug: 'bosch', label: 'Bosch', productCount: 1 }]);
    expect(page?.categoryProductCount).toBe(1);
  });

  it('lists only that product when the brand is selected', async () => {
    await scene();
    const page = await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc');
    expect(slugsOf(page)).toEqual(['visible-1']);
    expect(page?.productCount).toBe(1);
  });

  it('drops a brand chip altogether when its last public product is hidden, and then the filter matches nothing', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'solo', categoryId: category.id, brand: 'Bosch' });
    await listBranded({ slug: 'otro', categoryId: category.id, brand: 'Mahle' });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.slug, 'solo'));

    const page = await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc');

    expect(brandSlugs(page)).toEqual(['mahle']);
    expect(page).toMatchObject({ state: 'no-match', selectedBrand: null, productCount: 0 });
    expect(page?.products).toEqual([]);
  });

  it('follows an admin hiding a product between two reads', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const a = await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });
    await listBranded({ slug: 'b', categoryId: category.id, brand: 'Bosch' });
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands[0].productCount).toBe(2);
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, a.id));
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.brands[0].productCount).toBe(1);
  });
});

describe('brand filter (S11.4)', () => {
  async function twoBrands() {
    const category = await insertCategory({ slug: 'filtros' });
    for (let index = 0; index < 3; index += 1) {
      await listBranded({
        slug: `bosch-${index}`,
        categoryId: category.id,
        brand: 'Bosch',
        prices: [1000 + index],
        partNumber: `B-${index}`,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      await listBranded({ slug: `mahle-${index}`, categoryId: category.id, brand: 'Mahle', prices: [500 + index] });
    }
    return category;
  }

  it('lists only the brand, with a count equal to the number of cards and to the chip', async () => {
    await twoBrands();
    const page = await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc');
    expect(slugsOf(page)).toEqual(['bosch-0', 'bosch-1', 'bosch-2']);
    expect(page?.productCount).toBe(page?.products.length);
    expect(page?.productCount).toBe(page?.brands.find((b) => b.slug === 'bosch')?.productCount);
    expect(page?.state).toBe('results');
  });

  it('keeps the whole-category count unfiltered and names the selected brand', async () => {
    await twoBrands();
    const page = await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc');
    expect(page).toMatchObject({ productCount: 2, categoryProductCount: 5 });
    expect(page?.selectedBrand).toEqual({ slug: 'mahle', label: 'Mahle', productCount: 2 });
  });

  it('applies the sort inside the brand', async () => {
    await twoBrands();
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, 'bosch', 'price-desc'))).toEqual([
      'bosch-2',
      'bosch-1',
      'bosch-0',
    ]);
  });

  it('has no selected brand when none is asked for', async () => {
    await twoBrands();
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.selectedBrand).toBeNull();
  });

  it('computes the page count from the filtered set', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const feedId = await insertFeed((await insertShop()).id);
    for (let index = 0; index < 26; index += 1) {
      await listBranded({ slug: `b-${String(index).padStart(2, '0')}`, categoryId: category.id, brand: 'Bosch', prices: [1000 + index], feedId });
    }
    for (let index = 0; index < 10; index += 1) {
      await listBranded({ slug: `m-${index}`, categoryId: category.id, brand: 'Mahle', prices: [100 + index], feedId });
    }
    expect(await getPublicCategoryPage('filtros', 1, null, 'price-asc')).toMatchObject({ pageCount: 2, productCount: 36 });
    expect(await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc')).toMatchObject({ pageCount: 1, productCount: 10 });
    expect(await getPublicCategoryPage('filtros', 2, 'mahle', 'price-asc')).toBeNull();
    const second = await getPublicCategoryPage('filtros', 2, 'bosch', 'price-asc');
    expect(second).toMatchObject({ page: 2, pageCount: 2, productCount: 26 });
    expect(second?.products).toHaveLength(2);
  });

  it('carries a part number trimmed, and null when it is null or blank', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'p-con', categoryId: category.id, brand: 'A', partNumber: '  OC-1234  ', prices: [100] });
    await listBranded({ slug: 'p-blanco', categoryId: category.id, brand: 'A', partNumber: '   ', prices: [200] });
    await listBranded({ slug: 'p-nulo', categoryId: category.id, brand: 'A', partNumber: null, prices: [300] });
    const cards = (await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.products ?? [];
    expect(cards.map((card) => card.partNumber)).toEqual(['OC-1234', null, null]);
  });
});

describe('the three listing states (S11.4)', () => {
  it('is empty-category when the whole subtree has no public product, whatever the brand', async () => {
    await insertCategory({ slug: 'vacia' });
    for (const brand of [null, 'bosch']) {
      const page = await getPublicCategoryPage('vacia', 1, brand, 'price-asc');
      expect(page).toMatchObject({ state: 'empty-category', categoryProductCount: 0, productCount: 0, pageCount: 1 });
      expect(page?.products).toEqual([]);
    }
  });

  it('is results when the category has products and no brand is asked for', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });
    expect(await getPublicCategoryPage('filtros', 1, null, 'price-asc')).toMatchObject({
      state: 'results',
      categoryProductCount: 1,
    });
  });

  it('is no-match, not empty-category and not null, for a well-formed brand the category lacks', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });

    const page = await getPublicCategoryPage('filtros', 1, 'no-existe', 'price-asc');

    expect(page).toMatchObject({
      state: 'no-match',
      productCount: 0,
      categoryProductCount: 1,
      pageCount: 1,
      page: 1,
      selectedBrand: null,
    });
    expect(page?.products).toEqual([]);
    expect(page?.demoOnly).toBe(false);
    // The panel still has its chips to leave through.
    expect(brandSlugs(page)).toEqual(['bosch']);
  });

  it('is no-match for a brand that only another category has', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const other = await insertCategory({ slug: 'otra' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });
    await listBranded({ slug: 'b', categoryId: other.id, brand: 'Mahle' });
    expect((await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc'))?.state).toBe('no-match');
  });

  it('answers null for page 2 of a no-match, which has exactly one page', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });
    expect(await getPublicCategoryPage('filtros', 2, 'no-existe', 'price-asc')).toBeNull();
  });

  it('answers null for an unknown category whatever the brand and the sort', async () => {
    expect(await getPublicCategoryPage('no-existe', 1, 'bosch', 'name')).toBeNull();
  });

  it('keeps the invariant between state, counts and cards', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertCategory({ slug: 'vacia' });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch' });
    for (const [slug, brand] of [['filtros', null], ['filtros', 'bosch'], ['filtros', 'x'], ['vacia', null]] as const) {
      const page = await getPublicCategoryPage(slug, 1, brand, 'price-asc');
      expect(page).not.toBeNull();
      if (page === null) continue;
      expect(page.state === 'empty-category').toBe(page.categoryProductCount === 0);
      expect(page.state === 'no-match').toBe(page.categoryProductCount > 0 && page.productCount === 0);
      expect(page.products.length === 0).toBe(page.state !== 'results');
    }
  });
});

describe('demoOnly and indexable under a filter (D-10, D-7, S11.4)', () => {
  async function mixed() {
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id, { isDemo: false });
    await listBranded({ slug: 'demo-a', categoryId: category.id, brand: 'Bosch', feedId: demoFeed });
    await listBranded({ slug: 'real-b', categoryId: category.id, brand: 'Mahle', feedId: realFeed });
    return category;
  }

  it('reads demoOnly from the listed cards: demo brand true, real brand false, both false together', async () => {
    await mixed();
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.demoOnly).toBe(false);
    expect((await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc'))?.demoOnly).toBe(true);
    expect((await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc'))?.demoOnly).toBe(false);
  });

  it('keeps indexable for the whole category: the same under every brand, even a demo-only brand or no match', async () => {
    await mixed();
    for (const brand of [null, 'bosch', 'mahle', 'no-existe']) {
      expect((await getPublicCategoryPage('filtros', 1, brand, 'price-asc'))?.indexable, String(brand)).toBe(true);
    }
  });

  it('is not indexable when the whole category is demo, under any brand', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch', feedId: demoFeed });
    for (const brand of [null, 'bosch', 'no-existe']) {
      const page = await getPublicCategoryPage('filtros', 1, brand, 'price-asc');
      expect(page?.indexable, String(brand)).toBe(false);
    }
  });

  it('has demoOnly false for a no-match: nothing is listed', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch', feedId: demoFeed });
    expect((await getPublicCategoryPage('filtros', 1, 'no-existe', 'price-asc'))?.demoOnly).toBe(false);
  });
});

describe('canonical and robots on a filtered or sorted URL (D-7, S11.4)', () => {
  type Metadata = { alternates?: { canonical?: string }; robots?: unknown };
  async function metadataFor(
    slug: string,
    searchParams: Record<string, string | string[] | undefined>,
    requestHeaders: Record<string, string> = {},
  ): Promise<Metadata> {
    startRequest(requestHeaders);
    const mod = await import('../../src/app/(public)/categoria/[slug]/page');
    return (await mod.generateMetadata({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve(searchParams),
    })) as Metadata;
  }

  async function realCategory() {
    const category = await insertCategory({ slug: 'filtros' });
    const feedId = await insertFeed((await insertShop()).id, { isDemo: false });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch', feedId });
    await listBranded({ slug: 'b', categoryId: category.id, brand: 'Mahle', feedId });
  }

  const origin = process.env.SITE_URL?.replace(/\/$/, '') ?? '';

  it('points the canonical of an indexable category at the bare path for ?marca, ?orden and both', async () => {
    await realCategory();
    expect(origin).not.toBe('');
    for (const searchParams of [{}, { marca: 'bosch' }, { orden: 'precio-desc' }, { marca: 'bosch', orden: 'nombre' }, { marca: 'no-existe' }]) {
      const metadata = await metadataFor('filtros', searchParams);
      expect(metadata.alternates?.canonical, JSON.stringify(searchParams)).toBe(`${origin}/categoria/filtros`);
    }
  });

  it('keeps only ?pagina in the canonical when marca and orden ride along', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const feedId = await insertFeed((await insertShop()).id, { isDemo: false });
    for (let index = 0; index < 26; index += 1) {
      await listBranded({ slug: `b-${String(index).padStart(2, '0')}`, categoryId: category.id, brand: 'Bosch', prices: [1000 + index], feedId });
    }
    const metadata = await metadataFor('filtros', { marca: 'bosch', orden: 'nombre', pagina: '2' });
    expect(metadata.alternates?.canonical).toBe(`${origin}/categoria/filtros?pagina=2`);
  });

  it('ignores a malformed marca and orden: the same canonical, no error', async () => {
    await realCategory();
    for (const searchParams of [{ marca: '!!' }, { orden: 'zzz' }, { marca: ['bosch', 'mahle'] }]) {
      const metadata = await metadataFor('filtros', searchParams);
      expect(metadata.alternates?.canonical, JSON.stringify(searchParams)).toBe(`${origin}/categoria/filtros`);
    }
  });

  it('is noindex with no canonical for a demo-only category, with or without a filter', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    await listBranded({ slug: 'a', categoryId: category.id, brand: 'Bosch', feedId: demoFeed });
    for (const searchParams of [{}, { marca: 'bosch' }, { marca: 'no-existe' }]) {
      const metadata = await metadataFor('filtros', searchParams);
      expect(metadata.alternates, JSON.stringify(searchParams)).toBeUndefined();
      expect(metadata.robots, JSON.stringify(searchParams)).toEqual({ index: false });
    }
  });

  it('is noindex with no canonical when opened with a coche, in every car state (S5.7, AC 51)', async () => {
    await realCategory();
    const { slug } = await insertVehicle();
    const cases: Record<string, string> = {
      selected: slug,
      'a retired or unknown slug': 'no-existe-este-coche',
      'a malformed or repeated coche': '-',
    };
    for (const [label, forwarded] of Object.entries(cases)) {
      const metadata = await metadataFor('filtros', {}, { 'x-car-slug': forwarded });
      expect(metadata.robots, label).toEqual({ index: false });
      expect(metadata.alternates, label).toBeUndefined();
    }
  });

  it('stays indexable with its bare canonical when no car header is present (S5.7)', async () => {
    await realCategory();
    const metadata = await metadataFor('filtros', {}, { 'x-car-path': '/categoria/filtros' });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe(`${origin}/categoria/filtros`);
  });

  it('does not change the title or the description under a filter', async () => {
    await realCategory();
    const plain = (await metadataFor('filtros', {})) as Metadata & { title?: unknown; description?: unknown };
    const filtered = (await metadataFor('filtros', { marca: 'bosch', orden: 'nombre' })) as Metadata & {
      title?: unknown;
      description?: unknown;
    };
    expect(filtered.title).toEqual(plain.title);
    expect(filtered.description).toEqual(plain.description);
  });
});

// ---------------------------------------------------------------------------
// S5.8 (#275): the category listing with a selected car. Under a car the page
// lists the products that fit first, then the ones with no data, leaves the
// no-fit ones out and counts all three; no car, an unrecognised car and an
// unavailable car list as before.
// ---------------------------------------------------------------------------

type CarPage = NonNullable<Awaited<ReturnType<typeof getPublicCategoryPage>>>;

/** One selected car, one other vehicle and one approved feed that says the fitments. */
async function carWorld() {
  const car = await insertVehicle();
  const other = await insertVehicle();
  const fitFeed = await insertFeed((await insertShop()).id);
  const category = await insertCategory({ slug: 'filtros' });
  return { carId: car.id, otherId: other.id, fitFeed, category };
}

type World = Awaited<ReturnType<typeof carWorld>>;

/** A listed, branded product in the world's category with the fit state asked for. */
async function carProduct(
  world: World,
  o: {
    slug: string;
    fit: 'fits' | 'no-fit' | 'unknown';
    prices?: number[];
    brand?: string | null;
    title?: string;
    categoryId?: number;
    isHidden?: boolean;
  },
) {
  const product = await listBranded({
    slug: o.slug,
    categoryId: o.categoryId ?? world.category.id,
    brand: o.brand === undefined ? null : o.brand,
    prices: o.prices,
    title: o.title,
  });
  if (o.isHidden) await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
  if (o.fit === 'fits') await insertFitment(product.id, world.carId, world.fitFeed);
  if (o.fit === 'no-fit') await insertFitment(product.id, world.otherId, world.fitFeed);
  return product;
}

const sumOf = (page: CarPage) => (page.fit ? page.fit.fitsCount + page.fit.unknownCount + page.fit.leftOutCount : NaN);

describe('with a selected car: the two groups, in order (S5.8, AC 1, AC 13)', () => {
  it('lists the fits group, then the no-data group, and leaves the no-fit one out', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'no-data', fit: 'unknown', prices: [100] });
    await carProduct(world, { slug: 'compatible', fit: 'fits', prices: [500] });
    await carProduct(world, { slug: 'no-compatible', fit: 'no-fit', prices: [50] });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);

    expect(slugsOf(page)).toEqual(['compatible', 'no-data']);
    expect(page?.products.map((card) => card.fitGroup)).toEqual(['fits', 'unknown']);
    expect(page?.fit).toEqual({ fitsCount: 1, unknownCount: 1, leftOutCount: 1 });
    expect(page).toMatchObject({ productCount: 2, pageCount: 1, categoryProductCount: 3, state: 'results' });
  });

  it('puts every fitting product before every no-data one whatever the sort, and keeps the sort inside a group', async () => {
    const world = await carWorld();
    // The no-data ones are the cheapest and the first by name, so only the group can put them last.
    await carProduct(world, { slug: 'u-1', fit: 'unknown', prices: [100], title: 'Aaa' });
    await carProduct(world, { slug: 'u-2', fit: 'unknown', prices: [200], title: 'Aab' });
    await carProduct(world, { slug: 'f-1', fit: 'fits', prices: [900], title: 'Zzb' });
    await carProduct(world, { slug: 'f-2', fit: 'fits', prices: [800], title: 'Zza' });

    const bySort = {
      'price-asc': ['f-2', 'f-1', 'u-1', 'u-2'],
      'price-desc': ['f-1', 'f-2', 'u-2', 'u-1'],
      name: ['f-2', 'f-1', 'u-1', 'u-2'],
    } as const;
    for (const [sort, expected] of Object.entries(bySort)) {
      const page = await getPublicCategoryPage('filtros', 1, null, sort as keyof typeof bySort, world.carId);
      expect(slugsOf(page), sort).toEqual(expected);
    }
  });

  it('breaks a tie inside a group by id, as without a car', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'a', fit: 'fits', prices: [700] });
    await carProduct(world, { slug: 'b', fit: 'fits', prices: [700] });
    await carProduct(world, { slug: 'c', fit: 'unknown', prices: [700] });
    expect(slugsOf(await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))).toEqual(['a', 'b', 'c']);
  });

  it('counts the fits of the whole subtree and lists a child category product under its parent', async () => {
    const world = await carWorld();
    const child = await insertCategory({ slug: 'hija', parentId: world.category.id });
    await carProduct(world, { slug: 'en-raiz', fit: 'unknown', prices: [100] });
    await carProduct(world, { slug: 'en-hija', fit: 'fits', prices: [900], categoryId: child.id });
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    expect(slugsOf(page)).toEqual(['en-hija', 'en-raiz']);
    expect(page?.fit).toEqual({ fitsCount: 1, unknownCount: 1, leftOutCount: 0 });
  });
});

describe('with a selected car: what makes a product fit, unknown or left out (S5.8, AC 2, AC 3)', () => {
  it('leaves a product out only when its counted fitments name other vehicles', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'solo-otro', fit: 'no-fit' });
    const both = await carProduct(world, { slug: 'ambos', fit: 'fits' });
    await insertFitment(both.id, world.otherId, world.fitFeed);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    expect(slugsOf(page)).toEqual(['ambos']);
    expect(page?.fit).toEqual({ fitsCount: 1, unknownCount: 0, leftOutCount: 1 });
  });

  it('lists a product whose only fitments do not count as no-data, not as left out (feed, shop, retired vehicle)', async () => {
    const world = await carWorld();
    const unapprovedFeed = await insertFeed((await insertShop()).id, { isApproved: false });
    const unapprovedShopFeed = await insertFeed((await insertShop({ isApproved: false })).id);
    const retired = await insertVehicle({ isRetired: true });

    const fromUnapprovedFeed = await carProduct(world, { slug: 'feed-sin-aprobar', fit: 'unknown' });
    await insertFitment(fromUnapprovedFeed.id, world.carId, unapprovedFeed);
    const noFitUnapprovedFeed = await carProduct(world, { slug: 'feed-sin-aprobar-otro', fit: 'unknown' });
    await insertFitment(noFitUnapprovedFeed.id, world.otherId, unapprovedFeed);
    const fromUnapprovedShop = await carProduct(world, { slug: 'tienda-sin-aprobar', fit: 'unknown' });
    await insertFitment(fromUnapprovedShop.id, world.carId, unapprovedShopFeed);
    const toRetired = await carProduct(world, { slug: 'vehiculo-retirado', fit: 'unknown' });
    await insertFitment(toRetired.id, retired.id, world.fitFeed);

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);

    expect(new Set(slugsOf(page))).toEqual(
      new Set(['feed-sin-aprobar', 'feed-sin-aprobar-otro', 'tienda-sin-aprobar', 'vehiculo-retirado']),
    );
    expect(page?.products.every((card) => card.fitGroup === 'unknown')).toBe(true);
    expect(page?.fit).toEqual({ fitsCount: 0, unknownCount: 4, leftOutCount: 0 });
  });

  it('keeps a fitment to the car from an approved feed counting when another feed that says the same is not approved', async () => {
    const world = await carWorld();
    const unapprovedFeed = await insertFeed((await insertShop()).id, { isApproved: false });
    const product = await carProduct(world, { slug: 'doble', fit: 'fits' });
    await insertFitment(product.id, world.carId, unapprovedFeed);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.products[0]).toMatchObject({
      slug: 'doble',
      fitGroup: 'fits',
    });
  });
});

describe('with a selected car: hidden and unapproved never listed or counted (guardrail 1, S5.8, AC 4)', () => {
  it('lists and counts no hidden product, whatever its fit', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'visible', fit: 'unknown' });
    for (const fit of ['fits', 'unknown', 'no-fit'] as const) {
      await carProduct(world, { slug: `oculto-${fit}`, fit, isHidden: true });
    }
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    expect(slugsOf(page)).toEqual(['visible']);
    expect(page?.fit).toEqual({ fitsCount: 0, unknownCount: 1, leftOutCount: 0 });
    expect(page).toMatchObject({ productCount: 1, categoryProductCount: 1 });
  });

  it('lists and counts no product without a public offer: hidden offer, unapproved feed, in review, no offer at all', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'visible', fit: 'fits' });
    const unapproved = await insertFeed((await insertShop()).id, { isApproved: false });

    const noPublicOffer: { slug: string; make: (productId: number) => Promise<unknown> }[] = [
      { slug: 'oferta-oculta', make: (productId) => insertOffer({ productId, feedId: world.fitFeed, isHidden: true }) },
      { slug: 'oferta-en-revision', make: (productId) => insertOffer({ productId, feedId: world.fitFeed, inReview: true }) },
      { slug: 'feed-sin-aprobar-oferta', make: (productId) => insertOffer({ productId, feedId: unapproved }) },
      { slug: 'sin-ofertas', make: async () => undefined },
    ];
    for (const { slug, make } of noPublicOffer) {
      for (const fit of ['fits', 'unknown', 'no-fit'] as const) {
        const product = await insertProduct({ slug: `${slug}-${fit}`, categoryId: world.category.id });
        await make(product.id);
        if (fit === 'fits') await insertFitment(product.id, world.carId, world.fitFeed);
        if (fit === 'no-fit') await insertFitment(product.id, world.otherId, world.fitFeed);
      }
    }

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    expect(slugsOf(page)).toEqual(['visible']);
    expect(page?.fit).toEqual({ fitsCount: 1, unknownCount: 0, leftOutCount: 0 });
    expect(page?.categoryProductCount).toBe(1);
  });

  it('lists and counts no product that is unmapped to a category', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'visible', fit: 'fits' });
    const unmapped = await insertListedProduct({ slug: 'sin-categoria', prices: [100], categoryId: null });
    await insertFitment(unmapped.id, world.carId, world.fitFeed);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.fit).toEqual({
      fitsCount: 1,
      unknownCount: 0,
      leftOutCount: 0,
    });
  });

  it('shows a card the offers it has publicly: a hidden cheaper offer changes neither price nor count under a car', async () => {
    const world = await carWorld();
    const product = await carProduct(world, { slug: 'con-oculta', fit: 'fits', prices: [100, 300] });
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, product.offerIds[0]));
    const [card] = (await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.products ?? [];
    expect(card).toMatchObject({ slug: 'con-oculta', lowestPriceCents: 300, offerCount: 1 });
  });
});

describe('with a selected car: each number counts a product once (S5.8, AC 10)', () => {
  it('counts a product with several offers, shops, feeds and fitments once', async () => {
    const world = await carWorld();
    const secondFitFeed = await insertFeed((await insertShop()).id);
    const rich = await carProduct(world, { slug: 'rico', fit: 'fits', prices: [100, 200, 300] });
    await insertFitment(rich.id, world.carId, secondFitFeed);
    await insertFitment(rich.id, world.otherId, world.fitFeed);
    const lost = await carProduct(world, { slug: 'perdido', fit: 'no-fit', prices: [100, 200, 300] });
    await insertFitment(lost.id, world.otherId, secondFitFeed);
    await carProduct(world, { slug: 'sin-datos', fit: 'unknown', prices: [100, 200] });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);

    expect(page?.fit).toEqual({ fitsCount: 1, unknownCount: 1, leftOutCount: 1 });
    expect(page?.products.filter((card) => card.slug === 'rico')).toHaveLength(1);
    expect(page?.products.find((card) => card.slug === 'rico')).toMatchObject({ offerCount: 3, lowestPriceCents: 100 });
  });
});

describe('with a selected car: the three numbers add up to the no-car count (S5.8, AC 11, AC 12)', () => {
  async function mixed() {
    const world = await carWorld();
    const child = await insertCategory({ slug: 'hija', parentId: world.category.id });
    let n = 0;
    for (const brand of ['Bosch', 'Mahle', null]) {
      for (const fit of ['fits', 'unknown', 'no-fit'] as const) {
        for (let k = 0; k <= n % 3; k += 1) {
          n += 1;
          await carProduct(world, {
            slug: `p-${n}`,
            fit,
            brand,
            prices: [100 + n, 200 + n],
            categoryId: n % 2 === 0 ? child.id : world.category.id,
          });
        }
      }
    }
    return world;
  }

  it('holds without a brand, in the category and in its child', async () => {
    const world = await mixed();
    for (const slug of ['filtros', 'hija']) {
      const noCar = await getPublicCategoryPage(slug, 1, null, 'price-asc');
      const withCar = await getPublicCategoryPage(slug, 1, null, 'price-asc', world.carId);
      expect(sumOf(withCar as CarPage), slug).toBe(noCar?.productCount);
      expect((withCar?.fit?.fitsCount ?? 0) + (withCar?.fit?.unknownCount ?? 0), slug).toBe(withCar?.productCount);
    }
  });

  it('holds with each brand selected, and the numbers count that brand only', async () => {
    const world = await mixed();
    for (const brand of ['bosch', 'mahle']) {
      const noCar = await getPublicCategoryPage('filtros', 1, brand, 'price-asc');
      const withCar = await getPublicCategoryPage('filtros', 1, brand, 'price-asc', world.carId);
      expect(sumOf(withCar as CarPage), brand).toBe(noCar?.productCount);
      expect(withCar?.fit?.fitsCount, brand).toBeGreaterThan(0);
      expect(withCar?.products.every((card) => card.brand?.toLowerCase() === brand), brand).toBe(true);
    }
  });

  it('is the same under every sort and page, so the numbers are of the listing and not of the page', async () => {
    const world = await mixed();
    const first = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    for (const sort of ['price-desc', 'name'] as const) {
      expect((await getPublicCategoryPage('filtros', 1, null, sort, world.carId))?.fit, sort).toEqual(first?.fit);
    }
  });
});

describe('with a selected car: the brand filter and the chip counts (S5.8, AC 14, AC 15)', () => {
  it('counts a chip as fits plus no-data, never the left out, whatever the brand selected and the sort', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'b-f', fit: 'fits', brand: 'Bosch' });
    await carProduct(world, { slug: 'b-u', fit: 'unknown', brand: 'Bosch' });
    await carProduct(world, { slug: 'b-n', fit: 'no-fit', brand: 'Bosch' });
    await carProduct(world, { slug: 'm-f', fit: 'fits', brand: 'Mahle' });
    await carProduct(world, { slug: 'm-n1', fit: 'no-fit', brand: 'Mahle' });
    await carProduct(world, { slug: 'm-n2', fit: 'no-fit', brand: 'Mahle' });

    const expected = [
      { slug: 'bosch', label: 'Bosch', productCount: 2 },
      { slug: 'mahle', label: 'Mahle', productCount: 1 },
    ];
    for (const brand of [null, 'bosch', 'mahle', 'no-existe']) {
      for (const sort of ['price-asc', 'name'] as const) {
        const page = await getPublicCategoryPage('filtros', 1, brand, sort, world.carId);
        expect(page?.brands, `${brand} ${sort}`).toEqual(expected);
      }
    }
  });

  it('shows a brand with products in one group only that group', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'b-f', fit: 'fits', brand: 'Bosch' });
    await carProduct(world, { slug: 'm-u', fit: 'unknown', brand: 'Mahle' });
    const bosch = await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc', world.carId);
    expect(bosch?.products.map((card) => card.fitGroup)).toEqual(['fits']);
    expect(bosch?.fit).toEqual({ fitsCount: 1, unknownCount: 0, leftOutCount: 0 });
    const mahle = await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc', world.carId);
    expect(mahle?.products.map((card) => card.fitGroup)).toEqual(['unknown']);
  });

  it('keeps a brand whose products are all left out in the list at 0, and answers it all-left-out, not no-match', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'b-f', fit: 'fits', brand: 'Bosch' });
    await carProduct(world, { slug: 'm-n1', fit: 'no-fit', brand: 'Mahle' });
    await carProduct(world, { slug: 'm-n2', fit: 'no-fit', brand: 'Mahle' });

    const page = await getPublicCategoryPage('filtros', 1, 'mahle', 'price-asc', world.carId);

    expect(page?.brands).toEqual([
      { slug: 'bosch', label: 'Bosch', productCount: 1 },
      { slug: 'mahle', label: 'Mahle', productCount: 0 },
    ]);
    expect(page?.selectedBrand).toEqual({ slug: 'mahle', label: 'Mahle', productCount: 0 });
    expect(page).toMatchObject({
      state: 'all-left-out',
      products: [],
      productCount: 0,
      pageCount: 1,
      categoryProductCount: 3,
      fit: { fitsCount: 0, unknownCount: 0, leftOutCount: 2 },
    });
  });

  it('answers a brand with no products at all no-match, with a car as without one', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'b-f', fit: 'fits', brand: 'Bosch' });
    const page = await getPublicCategoryPage('filtros', 1, 'no-existe', 'price-asc', world.carId);
    expect(page).toMatchObject({ state: 'no-match', products: [], selectedBrand: null });
    expect(page?.fit).toEqual({ fitsCount: 0, unknownCount: 0, leftOutCount: 0 });
  });

  it('orders the chips by the listed count, then label', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'a-1', fit: 'fits', brand: 'Aaa' });
    await carProduct(world, { slug: 'z-1', fit: 'fits', brand: 'Zzz' });
    await carProduct(world, { slug: 'z-2', fit: 'unknown', brand: 'Zzz' });
    await carProduct(world, { slug: 'a-2', fit: 'no-fit', brand: 'Aaa' });
    await carProduct(world, { slug: 'a-3', fit: 'no-fit', brand: 'Aaa' });
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.brands.map((b) => b.label)).toEqual([
      'Zzz',
      'Aaa',
    ]);
  });
});

describe('with a selected car: pagination over the combined list (S5.8, AC 16, AC 18)', () => {
  it('runs a page across the group boundary and does not count the left out in the page count', async () => {
    const world = await carWorld();
    for (let n = 0; n < 20; n += 1) await carProduct(world, { slug: `f-${n}`, fit: 'fits', prices: [1000 + n] });
    for (let n = 0; n < 10; n += 1) await carProduct(world, { slug: `u-${n}`, fit: 'unknown', prices: [100 + n] });
    for (let n = 0; n < 40; n += 1) await carProduct(world, { slug: `n-${n}`, fit: 'no-fit', prices: [10 + n] });

    const first = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
    const second = await getPublicCategoryPage('filtros', 2, null, 'price-asc', world.carId);

    expect(first).toMatchObject({ page: 1, pageCount: 2, productCount: 30, categoryProductCount: 70 });
    expect(first?.products).toHaveLength(CATEGORY_PAGE_SIZE);
    expect(first?.products.map((card) => card.fitGroup)).toEqual([
      ...Array<string>(20).fill('fits'),
      ...Array<string>(4).fill('unknown'),
    ]);
    expect(second?.products.map((card) => card.fitGroup)).toEqual(Array<string>(6).fill('unknown'));
    expect(second?.fit).toEqual({ fitsCount: 20, unknownCount: 10, leftOutCount: 40 });

    const seen = [...(slugsOf(first) ?? []), ...(slugsOf(second) ?? [])];
    expect(new Set(seen).size).toBe(30);
    expect(seen.some((slug) => slug.startsWith('n-'))).toBe(false);
  });

  it('returns null for a page past the last of the combined list, though the no-car list has one more page', async () => {
    const world = await carWorld();
    for (let n = 0; n < CATEGORY_PAGE_SIZE; n += 1) await carProduct(world, { slug: `f-${n}`, fit: 'fits' });
    for (let n = 0; n < 5; n += 1) await carProduct(world, { slug: `n-${n}`, fit: 'no-fit' });

    expect(await getPublicCategoryPage('filtros', 2, null, 'price-asc')).not.toBeNull();
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.pageCount).toBe(1);
    expect(await getPublicCategoryPage('filtros', 2, null, 'price-asc', world.carId)).toBeNull();
  });

  it('never returns null for page 1 of an existing category, even when every product is left out', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'n-1', fit: 'no-fit' });
    await carProduct(world, { slug: 'n-2', fit: 'no-fit' });

    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);

    expect(page).toMatchObject({
      state: 'all-left-out',
      page: 1,
      pageCount: 1,
      productCount: 0,
      categoryProductCount: 2,
      products: [],
      fit: { fitsCount: 0, unknownCount: 0, leftOutCount: 2 },
    });
    expect(await getPublicCategoryPage('filtros', 2, null, 'price-asc', world.carId)).toBeNull();
  });

  it('keeps an empty category empty-category with a car, with zero counts and no fit wording to derive', async () => {
    const world = await carWorld();
    await insertCategory({ slug: 'vacia' });
    const page = await getPublicCategoryPage('vacia', 1, null, 'price-asc', world.carId);
    expect(page).toMatchObject({
      state: 'empty-category',
      productCount: 0,
      categoryProductCount: 0,
      pageCount: 1,
      products: [],
      fit: { fitsCount: 0, unknownCount: 0, leftOutCount: 0 },
    });
    expect(await getPublicCategoryPage('vacia', 2, null, 'price-asc', world.carId)).toBeNull();
  });

  it('is the empty-category state, not all-left-out, when the only products are hidden ones with no fit', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'oculto', fit: 'no-fit', isHidden: true });
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId))?.state).toBe('empty-category');
  });

  it('still answers an unknown or malformed category null with a car', async () => {
    const world = await carWorld();
    for (const slug of ['no-existe', 'Bad_Slug', 'a--b']) {
      expect(await getPublicCategoryPage(slug, 1, null, 'price-asc', world.carId), slug).toBeNull();
    }
  });
});

describe('with a selected car: the rest of the page is as without one (S5.8)', () => {
  it('keeps indexable, ancestors, sort and demoOnly independent of the car', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'n-1', fit: 'no-fit' });
    const noCar = await getPublicCategoryPage('filtros', 1, null, 'name');
    const withCar = await getPublicCategoryPage('filtros', 1, null, 'name', world.carId);
    expect(withCar).toMatchObject({
      indexable: noCar?.indexable,
      ancestors: noCar?.ancestors,
      sort: 'name',
      name: noCar?.name,
      categoryProductCount: noCar?.categoryProductCount,
    });
  });
});

describe('no car, an unrecognised car and an unavailable car list as before (S5.8, AC 24, AC 25)', () => {
  async function filled() {
    const world = await carWorld();
    await carProduct(world, { slug: 'f', fit: 'fits', brand: 'Bosch', prices: [900] });
    await carProduct(world, { slug: 'u', fit: 'unknown', brand: 'Mahle', prices: [100] });
    await carProduct(world, { slug: 'n', fit: 'no-fit', brand: 'Bosch', prices: [50] });
    return world;
  }

  it('lists a no-fit product and the cheapest first, with no group and no fit counts, when no car is passed', async () => {
    await filled();
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(slugsOf(page)).toEqual(['n', 'u', 'f']);
    expect(page?.fit).toBeNull();
    expect(page?.products.map((card) => card.fitGroup)).toEqual([null, null, null]);
    expect(page).toMatchObject({ productCount: 3, categoryProductCount: 3 });
  });

  it('is the same page for a null vehicle id as for none, which is what an unrecognised or unavailable car resolves to', async () => {
    await filled();
    const plain = await getPublicCategoryPage('filtros', 1, 'bosch', 'price-desc');
    for (const state of ['none', 'unrecognised', 'unavailable'] as const) {
      const car: CarContext =
        state === 'unrecognised' ? { state, raw: 'coche-que-no-existe', path: null } : { state, path: null };
      expect(selectedVehicleId(car), state).toBeNull();
      expect(await getPublicCategoryPage('filtros', 1, 'bosch', 'price-desc', selectedVehicleId(car)), state).toEqual(plain);
    }
  });

  it('leaves the brand chips as the public counts, with a car that is not a vehicle of the list', async () => {
    await filled();
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc', null);
    expect(page?.brands).toEqual([
      { slug: 'bosch', label: 'Bosch', productCount: 2 },
      { slug: 'mahle', label: 'Mahle', productCount: 1 },
    ]);
  });
});

describe('a failed fit read fails the listing and logs no car (S5.8, AC 26, AC 38)', () => {
  // 2^40 is outside the integer range of vehicle_id: Postgres rejects the bound parameter, the same way
  // an unreadable fit table would fail the one statement that carries the fit.
  const BAD_VEHICLE_ID = 2 ** 40;

  it('throws the fixed error and never returns the listing unfiltered', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'n', fit: 'no-fit' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(getPublicCategoryPage('filtros', 1, null, 'price-asc', BAD_VEHICLE_ID)).rejects.toThrow(/^category: failed$/);
    } finally {
      spy.mockRestore();
    }
  });

  it('logs one fixed-code line that names neither the vehicle nor the slug nor the brand', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'n', fit: 'no-fit', brand: 'Bosch' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await getPublicCategoryPage('filtros', 1, 'bosch', 'price-asc', BAD_VEHICLE_ID).catch(() => undefined);
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
      expect(line).toMatch(/^category: failed \([A-Za-z0-9_]+\)$/);
      for (const secret of [String(BAD_VEHICLE_ID), 'filtros', 'bosch']) expect(line).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it('logs nothing at all when the listing succeeds with a car', async () => {
    const world = await carWorld();
    await carProduct(world, { slug: 'f', fit: 'fits' });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      await getPublicCategoryPage('filtros', 1, null, 'price-asc', world.carId);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
