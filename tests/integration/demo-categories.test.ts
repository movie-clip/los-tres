import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { FIXED_CATEGORY_TREE } from '@/db/category-tree';
import { categories, offers } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { importFeeds } from '@/server/importer';
import { seedDemoData } from '@/server/seed';

import {
  DEMO_CATEGORY_COUNTS,
  DEMO_COUNTS,
  DEMO_DRILL,
  DEMO_FOUR_OFFERS,
  DEMO_ILLUSTRATED,
  DEMO_CHEAPEST,
  DEMO_LONG_TITLE,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_UNMAPPED_CATEGORY,
  DEMO_UNMAPPED_EMPTY,
  DEMO_WRENCHES,
} from '../fixtures/demo';
import { allProducts } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { callGo } from '../support/go';
import { stubNetworkOff } from '../support/network-off';

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
  await seedDemoData(getDb());
  await importFeeds(getDb());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

const ROOT = FIXED_CATEGORY_TREE.slug;

// AC 23, 24: the shipped demo data after `seed` then `import-feeds`.
describe('demo data categories (AC 23, AC 24)', () => {
  it('imports every demo product and offer', async () => {
    expect(await allProducts()).toHaveLength(DEMO_COUNTS.products);
    expect(await getDb().select().from(offers)).toHaveLength(DEMO_COUNTS.offers);
  });

  it.each(Object.entries(DEMO_CATEGORY_COUNTS))(
    'category %s holds %d public products across its subtree',
    async (slug, count) => {
      const page = await getPublicCategoryPage(slug, 1, null, 'price-asc');
      expect(page?.productCount).toBe(count);
    },
  );

  it('shows products in the root only through its children', async () => {
    const rootPage = await getPublicCategoryPage(ROOT, 1, null, 'price-asc');
    let childTotal = 0;
    for (const child of FIXED_CATEGORY_TREE.children) {
      childTotal += (await getPublicCategoryPage(child.slug, 1, null, 'price-asc'))?.productCount ?? 0;
    }
    expect(rootPage?.productCount).toBe(childTotal);
    // No product is assigned to the root itself.
    const rows = await allProducts();
    const [root] = await getDb().select().from(categories).where(eq(categories.slug, ROOT));
    expect(rows.some((row) => row.categoryId === root.id)).toBe(false);
  });

  it('pages the root: 24 per page, the rest on the last, cheapest first', async () => {
    const pageCount = Math.ceil(DEMO_CATEGORY_COUNTS[ROOT] / 24);
    const pages = [];
    for (let number = 1; number <= pageCount; number += 1) pages.push(await getPublicCategoryPage(ROOT, number, null, 'price-asc'));
    const [first] = pages;
    expect(first).toMatchObject({ pageCount, productCount: DEMO_CATEGORY_COUNTS[ROOT] });
    expect(pages.map((page) => page?.products.length)).toEqual(
      pages.map((_page, index) => Math.min(24, DEMO_CATEGORY_COUNTS[ROOT] - index * 24)),
    );
    expect(await getPublicCategoryPage(ROOT, pageCount + 1, null, 'price-asc')).toBeNull();
    expect(first?.products[0]).toMatchObject({
      slug: DEMO_CHEAPEST.slug,
      title: DEMO_CHEAPEST.title,
      lowestPriceCents: DEMO_CHEAPEST.priceCents,
      offerCount: DEMO_CHEAPEST.offerCount,
    });
    const prices = pages.flatMap((page) => page?.products ?? []).map((card) => card.lowestPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('stamps each root card with the slug of its own leaf category (cards from several leaves)', async () => {
    const leaves = new Map<string, string>();
    for (const [leaf, productSlug] of Object.entries(DEMO_ILLUSTRATED)) leaves.set(productSlug, leaf);
    const cards = [
      ...((await getPublicCategoryPage(ROOT, 1, null, 'price-asc'))?.products ?? []),
      ...((await getPublicCategoryPage(ROOT, 2, null, 'price-asc'))?.products ?? []),
    ];
    expect(new Set(cards.map((card) => card.categorySlug)).size).toBeGreaterThanOrEqual(2);
    for (const [productSlug, leaf] of leaves) {
      expect(cards.find((card) => card.slug === productSlug)?.categorySlug).toBe(leaf);
    }
    const leafSlugs: string[] = FIXED_CATEGORY_TREE.children.map((child) => child.slug);
    expect(cards.every((card) => leafSlugs.includes(card.categorySlug))).toBe(true);
  });

  it('gives a leaf page cards that carry that leaf slug', async () => {
    for (const leaf of Object.keys(DEMO_ILLUSTRATED)) {
      const cards = (await getPublicCategoryPage(leaf, 1, null, 'price-asc'))?.products ?? [];
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.categorySlug === leaf)).toBe(true);
    }
  });

  it('puts the product own leaf slug on the product page', async () => {
    expect((await getPublicProductBySlug(DEMO_SHARED.slug))?.categorySlug).toBe('filtros-de-aceite');
    expect((await getPublicProductBySlug(DEMO_NO_BRAND.slug))?.categorySlug).toBe(DEMO_NO_BRAND.categorySlug);
    for (const [leaf, productSlug] of Object.entries(DEMO_ILLUSTRATED)) {
      expect((await getPublicProductBySlug(productSlug))?.categorySlug).toBe(leaf);
    }
  });

  it('lists the four-shop product with all four offers, cheapest first', async () => {
    const page = await getPublicProductBySlug(DEMO_FOUR_OFFERS.slug);
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual(
      DEMO_FOUR_OFFERS.offers.map((offer) => [offer.shopName, offer.priceCents]),
    );
    expect(page?.categorySlug).toBe(DEMO_FOUR_OFFERS.categorySlug);
  });

  it('shows the shared filter with its cheaper shop price and two shops', async () => {
    const page = await getPublicCategoryPage('filtros-de-aceite', 1, null, 'price-asc');
    const card = page?.products.find((c) => c.slug === DEMO_SHARED.slug);
    expect(card).toMatchObject({
      lowestPriceCents: DEMO_SHARED.offers[0].priceCents,
      offerCount: DEMO_SHARED.offers.length,
    });
  });

  it('carries the product without a brand and the 100-character title', async () => {
    const oil = (await getPublicCategoryPage(DEMO_NO_BRAND.categorySlug, 1, null, 'price-asc'))?.products.find(
      (card) => card.slug === DEMO_NO_BRAND.slug,
    );
    expect(oil).toMatchObject({ slug: DEMO_NO_BRAND.slug, brand: null, lowestPriceCents: DEMO_NO_BRAND.priceCents });
    const all = [
      ...((await getPublicCategoryPage(ROOT, 1, null, 'price-asc'))?.products ?? []),
      ...((await getPublicCategoryPage(ROOT, 2, null, 'price-asc'))?.products ?? []),
    ];
    const long = all.find((card) => card.title === DEMO_LONG_TITLE.title);
    expect(long?.title).toHaveLength(100);
    expect(long?.lowestPriceCents).toBe(DEMO_LONG_TITLE.priceCents);
  });

  it('keeps the fuel filter category empty and the page answerable', async () => {
    expect(await getPublicCategoryPage('filtros-de-combustible', 1, null, 'price-asc')).toMatchObject({
      productCount: 0,
      pageCount: 1,
      products: [],
    });
    expect(await getPublicCategoryPage('filtros-de-combustible', 2, null, 'price-asc')).toBeNull();
  });

  it.each([DEMO_UNMAPPED_CATEGORY, DEMO_UNMAPPED_EMPTY, DEMO_DRILL, DEMO_WRENCHES])(
    'imports $title but shows it on no page: unmapped (AC 1, AC 3, AC 24)',
    async ({ slug }) => {
      const rows = await allProducts();
      const row = rows.find((product) => product.slug === slug);
      expect(row).toBeDefined();
      expect(row?.categoryId).toBeNull();
      expect(await getPublicProductBySlug(slug)).toBeNull();
      for (const category of Object.keys(DEMO_CATEGORY_COUNTS)) {
        for (const page of [1, 2, 3]) {
          const listing = await getPublicCategoryPage(category, page, null, 'price-asc');
          expect(listing?.products.map((card) => card.slug) ?? []).not.toContain(slug);
        }
      }
    },
  );

  it('counts exactly the mapped products as public', async () => {
    const mapped = (await allProducts()).filter((row) => row.categoryId !== null);
    expect(mapped).toHaveLength(DEMO_COUNTS.publicProducts);
  });

  it('answers /go with 404 for the offer of an unmapped demo product and 302 for a mapped one', async () => {
    const [unmappedOffer] = await getDb().select().from(offers).where(eq(offers.externalId, 'DOS-102'));
    const [mappedOffer] = await getDb().select().from(offers).where(eq(offers.externalId, 'UNO-001'));
    const refused = await callGo(unmappedOffer.id);
    expect(refused.status).toBe(404);
    expect(refused.headers.get('location')).toBeNull();
    expect((await callGo(mappedOffer.id)).status).toBe(302);
  });
});
