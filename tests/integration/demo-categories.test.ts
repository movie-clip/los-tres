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
  DEMO_FILLER,
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
      const page = await getPublicCategoryPage(slug, 1);
      expect(page?.productCount).toBe(count);
    },
  );

  it('shows products in the root only through its children', async () => {
    const rootPage = await getPublicCategoryPage(ROOT, 1);
    let childTotal = 0;
    for (const child of FIXED_CATEGORY_TREE.children) {
      childTotal += (await getPublicCategoryPage(child.slug, 1))?.productCount ?? 0;
    }
    expect(rootPage?.productCount).toBe(childTotal);
    // No product is assigned to the root itself.
    const rows = await allProducts();
    const [root] = await getDb().select().from(categories).where(eq(categories.slug, ROOT));
    expect(rows.some((row) => row.categoryId === root.id)).toBe(false);
  });

  it('pages the root: 24 on page one, the rest on page two, cheapest first', async () => {
    const first = await getPublicCategoryPage(ROOT, 1);
    const second = await getPublicCategoryPage(ROOT, 2);
    expect(first).toMatchObject({ pageCount: 2, productCount: DEMO_CATEGORY_COUNTS[ROOT] });
    expect(first?.products).toHaveLength(24);
    expect(second?.products).toHaveLength(DEMO_CATEGORY_COUNTS[ROOT] - 24);
    expect(await getPublicCategoryPage(ROOT, 3)).toBeNull();
    expect(first?.products[0]).toMatchObject({
      title: DEMO_FILLER.firstTitle,
      lowestPriceCents: DEMO_FILLER.firstPriceCents,
      offerCount: 1,
    });
    const prices = [...(first?.products ?? []), ...(second?.products ?? [])].map((card) => card.lowestPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('shows the shared filter with its cheaper shop price and two shops', async () => {
    const page = await getPublicCategoryPage('filtros-de-aceite', 1);
    const card = page?.products.find((c) => c.slug === DEMO_SHARED.slug);
    expect(card).toMatchObject({
      lowestPriceCents: DEMO_SHARED.offers[0].priceCents,
      offerCount: DEMO_SHARED.offers.length,
    });
  });

  it('carries the product without a brand and the 100-character title', async () => {
    const oil = (await getPublicCategoryPage(DEMO_NO_BRAND.categorySlug, 1))?.products[0];
    expect(oil).toMatchObject({ slug: DEMO_NO_BRAND.slug, brand: null, lowestPriceCents: DEMO_NO_BRAND.priceCents });
    const all = [
      ...((await getPublicCategoryPage(ROOT, 1))?.products ?? []),
      ...((await getPublicCategoryPage(ROOT, 2))?.products ?? []),
    ];
    const long = all.find((card) => card.title === DEMO_LONG_TITLE.title);
    expect(long?.title).toHaveLength(100);
    expect(long?.lowestPriceCents).toBe(DEMO_LONG_TITLE.priceCents);
  });

  it('keeps the fuel filter category empty and the page answerable', async () => {
    expect(await getPublicCategoryPage('filtros-de-combustible', 1)).toMatchObject({
      productCount: 0,
      pageCount: 1,
      products: [],
    });
    expect(await getPublicCategoryPage('filtros-de-combustible', 2)).toBeNull();
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
        for (const page of [1, 2]) {
          const listing = await getPublicCategoryPage(category, page);
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
