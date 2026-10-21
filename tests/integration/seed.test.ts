import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import {
  categories,
  feedCategoryMappings,
  feeds,
  networks,
  offers,
  products,
  shops,
} from '@/db/schema';
import { seedDemoData } from '@/server/seed';

import { DEMO_COUNTS, DEMO_FEED_URLS, DEMO_SHOPS } from '../fixtures/demo';
import { insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

async function counts() {
  const db = getDb();
  return {
    networks: (await db.select().from(networks)).length,
    shops: (await db.select().from(shops)).length,
    feeds: (await db.select().from(feeds)).length,
    categories: (await db.select().from(categories)).length,
    categoryMappings: (await db.select().from(feedCategoryMappings)).length,
    products: (await db.select().from(products)).length,
    offers: (await db.select().from(offers)).length,
  };
}

describe('seedDemoData (C-18, TD-21, TD-22)', () => {
  it('loads the demo network, two shops, two feeds and the category tree, and no product', async () => {
    const report = await seedDemoData(getDb());
    expect(report).toMatchObject({ networks: 1, shops: 2, feeds: 2, categories: 7 });
    expect(await counts()).toEqual({
      networks: 1,
      shops: 2,
      feeds: 2,
      categories: 7,
      categoryMappings: DEMO_COUNTS.categoryMappings,
      products: 0,
      offers: 0,
    });
  });

  it('registers one demo feed per demo shop with the demo-feed: url', async () => {
    await seedDemoData(getDb());
    const rows = await getDb()
      .select({ slug: shops.slug, url: feeds.url, isDemo: feeds.isDemo, source: feeds.sourceType })
      .from(feeds)
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .orderBy(shops.slug);
    expect(rows).toEqual(
      DEMO_SHOPS.map((shop, index) => ({
        slug: shop.slug,
        url: DEMO_FEED_URLS[index],
        isDemo: true,
        source: 'affiliate_network',
      })).sort((a, b) => a.slug.localeCompare(b.slug)),
    );
  });

  it('builds two root categories with 3 and 2 children', async () => {
    await seedDemoData(getDb());
    const rows = await getDb().select().from(categories);
    const roots = rows.filter((row) => row.parentId === null);
    expect(roots.map((row) => row.slug).sort()).toEqual(['automovil', 'herramientas']);
    for (const [slug, children] of [
      ['automovil', 3],
      ['herramientas', 2],
    ] as const) {
      const root = roots.find((row) => row.slug === slug);
      expect(rows.filter((row) => row.parentId === root?.id)).toHaveLength(children);
    }
  });

  it('run twice changes nothing: the second report inserts 0 and the counts are equal', async () => {
    await seedDemoData(getDb());
    const before = await counts();
    const second = await seedDemoData(getDb());
    expect(second).toMatchObject({ networks: 0, shops: 0, feeds: 0, categories: 0, categoryMappings: 0 });
    expect(await counts()).toEqual(before);
  });
});

describe('seeded category mappings (S5.1)', () => {
  it('reports the mappings it inserted on the first run', async () => {
    expect((await seedDemoData(getDb())).categoryMappings).toBe(DEMO_COUNTS.categoryMappings);
  });

  it('maps each shop\'s own feed category strings to a category of ours, per feed', async () => {
    await seedDemoData(getDb());
    const rows = await getDb()
      .select({ feedUrl: feeds.url, feedCategory: feedCategoryMappings.feedCategory, slug: categories.slug })
      .from(feedCategoryMappings)
      .innerJoin(feeds, eq(feedCategoryMappings.feedId, feeds.id))
      .innerJoin(categories, eq(feedCategoryMappings.categoryId, categories.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        { feedUrl: DEMO_FEED_URLS[0], feedCategory: 'Recambios > Filtros', slug: 'filtros' },
        { feedUrl: DEMO_FEED_URLS[1], feedCategory: 'Filtros de aceite', slug: 'filtros' },
        { feedUrl: DEMO_FEED_URLS[1], feedCategory: 'Herramienta manual', slug: 'herramientas-manuales' },
      ]),
    );
  });

  it('leaves the demo feed category of the unmapped product, and the empty category, unmapped', async () => {
    await seedDemoData(getDb());
    const rows = await getDb().select().from(feedCategoryMappings);
    expect(rows.map((row) => row.feedCategory)).not.toContain('Jardín > Cortacésped');
    const [aceites] = await getDb().select().from(categories).where(eq(categories.slug, 'aceites-y-lubricantes'));
    expect(rows.some((row) => row.categoryId === aceites.id)).toBe(false);
  });

  it('keeps a mapping an admin changed: a second seed never rewrites it', async () => {
    await seedDemoData(getDb());
    const [tools] = await getDb().select().from(categories).where(eq(categories.slug, 'herramientas-manuales'));
    await getDb()
      .update(feedCategoryMappings)
      .set({ categoryId: tools.id })
      .where(eq(feedCategoryMappings.feedCategory, 'Filtros de aceite'));
    await seedDemoData(getDb());
    const [row] = await getDb()
      .select()
      .from(feedCategoryMappings)
      .where(eq(feedCategoryMappings.feedCategory, 'Filtros de aceite'));
    expect(row.categoryId).toBe(tools.id);
  });
});

describe('seed scope (guardrail 1)', () => {
  it('approves only the demo shops and the is_demo feeds', async () => {
    const external = await insertShop({ slug: 'tienda-externa', name: 'Externa', isApproved: false });
    await insertFeed(external.id, { url: 'external.csv', isApproved: false });

    await seedDemoData(getDb());

    const approvedShops = await getDb().select().from(shops).where(eq(shops.isApproved, true));
    expect(approvedShops.map((row) => row.slug).sort()).toEqual(DEMO_SHOPS.map((shop) => shop.slug).sort());
    const approvedFeeds = await getDb().select().from(feeds).where(eq(feeds.isApproved, true));
    expect(approvedFeeds).toHaveLength(2);
    expect(approvedFeeds.every((row) => row.isDemo)).toBe(true);
    const [still] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-externa'));
    expect(still.isApproved).toBe(false);
  });

  it('never re-approves a demo shop or feed that an admin switched off', async () => {
    await seedDemoData(getDb());
    await getDb().update(shops).set({ isApproved: false }).where(eq(shops.slug, 'tienda-demo-uno'));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.url, DEMO_FEED_URLS[1]));

    await seedDemoData(getDb());

    const [shop] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno'));
    const [feed] = await getDb().select().from(feeds).where(eq(feeds.url, DEMO_FEED_URLS[1]));
    expect(shop.isApproved).toBe(false);
    expect(feed.isApproved).toBe(false);
  });

  it('leaves a pre-existing row with a demo slug untouched, name included', async () => {
    await insertShop({ slug: 'tienda-demo-uno', name: 'Renombrada por el admin', isApproved: false });
    await seedDemoData(getDb());
    const [shop] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno'));
    expect(shop).toMatchObject({ name: 'Renombrada por el admin', isApproved: false });
  });
});
