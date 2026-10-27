import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { categories, feeds, offers, products } from '@/db/schema';
import { CATEGORY_PAGE_SIZE, getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertFeed,
  insertListedProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';

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

    const page = await getPublicCategoryPage('filtros', 1);

    expect(page).toEqual({
      slug: 'filtros',
      name: 'Filtros',
      page: 1,
      pageCount: 1,
      productCount: 1,
      products: [
        {
          slug: 'filtro-a',
          title: 'Filtro A',
          brand: 'MarcaX',
          lowestPriceCents: 1149,
          offerCount: 2,
          categorySlug: 'filtros',
        },
      ],
      demoOnly: false,
      indexable: true,
    });
  });

  it('returns numbers, not strings, for the aggregates (Postgres count is a bigint)', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'filtro-a', prices: [500, 700, 900], categoryId: category.id });
    const page = await getPublicCategoryPage('filtros', 1);
    expect(typeof page?.productCount).toBe('number');
    expect(typeof page?.products[0].offerCount).toBe('number');
    expect(typeof page?.products[0].lowestPriceCents).toBe('number');
    expect(page?.products[0]).toMatchObject({ lowestPriceCents: 500, offerCount: 3 });
  });

  it('returns brand null as null, not an empty string', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'sin-marca', prices: [100], brand: null, categoryId: category.id });
    expect((await getPublicCategoryPage('filtros', 1))?.products[0].brand).toBeNull();
  });
});

describe('the lowest price and the shop count (AC 17, AC 18)', () => {
  it('reads one shop as offerCount 1 with its own price', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'un-solo-shop', prices: [4990], categoryId: category.id });
    const [card] = (await getPublicCategoryPage('filtros', 1))?.products ?? [];
    expect(card).toMatchObject({ lowestPriceCents: 4990, offerCount: 1 });
  });

  it('equals the first offer and the offer count of the same product page', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'a', prices: [1299, 1149, 2000], categoryId: category.id });
    await insertListedProduct({ slug: 'b', prices: [350], categoryId: category.id });

    const listing = await getPublicCategoryPage('filtros', 1);
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

    const [card] = (await getPublicCategoryPage('filtros', 1))?.products ?? [];
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
    const [card] = (await getPublicCategoryPage('filtros', 1))?.products ?? [];
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

    const page = await getPublicCategoryPage('filtros', 1);

    expect(slugsOf(page)).toEqual(['publico']);
    expect(page?.productCount).toBe(1);
  });

  it('lists a product once it is mapped, and not before', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const product = await insertListedProduct({ slug: 'se-mapea', prices: [100], categoryId: null });
    expect((await getPublicCategoryPage('filtros', 1))?.productCount).toBe(0);

    await getDb().update(products).set({ categoryId: category.id }).where(eq(products.id, product.id));

    expect(slugsOf(await getPublicCategoryPage('filtros', 1))).toEqual(['se-mapea']);
  });

  it('drops a product again when an admin hides it', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const product = await insertListedProduct({ slug: 'a', prices: [100], categoryId: category.id });
    await insertListedProduct({ slug: 'b', prices: [200], categoryId: category.id });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect(slugsOf(await getPublicCategoryPage('filtros', 1))).toEqual(['b']);
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

    const page = await getPublicCategoryPage('raiz', 1);

    expect(slugsOf(page)).toEqual(['en-raiz', 'en-hija', 'en-nieta']);
    expect(page?.productCount).toBe(3);
  });

  it('lists a product of a root that has none of its own, only through a child', async () => {
    const { child } = await tree();
    await insertListedProduct({ slug: 'solo-hija', prices: [100], categoryId: child.id });
    expect(slugsOf(await getPublicCategoryPage('raiz', 1))).toEqual(['solo-hija']);
  });

  it('does not include a parent or a sibling in a child page', async () => {
    const { root, child, sibling } = await tree();
    await insertListedProduct({ slug: 'en-raiz', prices: [100], categoryId: root.id });
    await insertListedProduct({ slug: 'en-hermana', prices: [100], categoryId: sibling.id });
    await insertListedProduct({ slug: 'en-hija', prices: [100], categoryId: child.id });
    expect(slugsOf(await getPublicCategoryPage('hija', 1))).toEqual(['en-hija']);
  });

  it('lists a product with offers in several shops once, not once per offer or path', async () => {
    const { root, child } = await tree();
    await insertListedProduct({ slug: 'multi', prices: [100, 200, 300], categoryId: child.id });
    await insertListedProduct({ slug: 'otra', prices: [400], categoryId: root.id });
    const page = await getPublicCategoryPage('raiz', 1);
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

    const page = await getPublicCategoryPage('ciclo-a', 1);

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

    expect(slugsOf(await getPublicCategoryPage('filtros', 1))).toEqual([
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
    expect(slugsOf(await getPublicCategoryPage('filtros', 1))).toEqual(['dos-ofertas', 'medio']);
  });

  it('returns the same order on every request for the same data', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (let index = 0; index < 8; index += 1) {
      await insertListedProduct({ slug: `igual-${index}`, prices: [1000], categoryId: category.id });
    }
    const first = slugsOf(await getPublicCategoryPage('filtros', 1));
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect(slugsOf(await getPublicCategoryPage('filtros', 1))).toEqual(first);
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
    const page = await getPublicCategoryPage('filtros', 1);
    expect(page).toMatchObject({ page: 1, pageCount: 1, productCount: 24 });
    expect(page?.products).toHaveLength(24);
    expect(await getPublicCategoryPage('filtros', 2)).toBeNull();
  });

  it('splits 26 products into 24 and 2 with no overlap and no gap', async () => {
    await seed(26);
    const first = await getPublicCategoryPage('filtros', 1);
    const second = await getPublicCategoryPage('filtros', 2);

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
    expect((await getPublicCategoryPage('filtros', 1))?.pageCount).toBe(2);
    expect((await getPublicCategoryPage('filtros', 2))?.products).toHaveLength(1);
  });

  it('returns null past the last page and for an absurdly large page', async () => {
    await seed(26);
    expect(await getPublicCategoryPage('filtros', 3)).toBeNull();
    expect(await getPublicCategoryPage('filtros', Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe('empty category (AC 14)', () => {
  it('returns one empty page for a category with no products at all', async () => {
    await insertCategory({ slug: 'vacia', name: 'Vacía' });
    expect(await getPublicCategoryPage('vacia', 1)).toEqual({
      slug: 'vacia',
      name: 'Vacía',
      page: 1,
      pageCount: 1,
      productCount: 0,
      products: [],
      demoOnly: false,
      indexable: false,
    });
  });

  it('returns null for page 2 of an empty category: it has exactly one page', async () => {
    await insertCategory({ slug: 'vacia' });
    expect(await getPublicCategoryPage('vacia', 2)).toBeNull();
  });

  it('is empty, not missing, when every product in it is hidden, without offers, or lives unmapped', async () => {
    const category = await insertCategory({ slug: 'vacia' });
    await insertListedProduct({ slug: 'oculto', prices: [100], categoryId: category.id, isHidden: true });
    await insertListedProduct({ slug: 'sin-ofertas', prices: [], categoryId: category.id });
    await insertListedProduct({ slug: 'sin-mapa', prices: [100], categoryId: null });
    expect(await getPublicCategoryPage('vacia', 1)).toMatchObject({ productCount: 0, products: [], pageCount: 1 });
  });
});

describe('unknown and malformed slugs (AC 15)', () => {
  it('returns null for an unknown slug', async () => {
    await insertCategory({ slug: 'existe' });
    expect(await getPublicCategoryPage('no-existe', 1)).toBeNull();
  });

  it('returns null for each malformed slug even while the database is unreachable', async () => {
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const malformed = ['', 'Bad_Slug', 'UPPER', 'a b', 'a--b', '-lead', 'trail-', 'a/b', "x'; --", 'ñandú', 'a'.repeat(121)];
    for (const slug of malformed) {
      expect(await getPublicCategoryPage(slug, 1), JSON.stringify(slug)).toBeNull();
    }
    // Control: a well-formed slug does query, and so fails on the dead database.
    await expect(getPublicCategoryPage('well-formed', 1)).rejects.toBeDefined();

    vi.unstubAllEnvs();
    await closeDb();
  });
});
