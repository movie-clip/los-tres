import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FIXED_CATEGORY_TREE } from '@/db/category-tree';
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
import { createFeed, createNetwork, createShop, listNetworksForAdmin, listSourcesForAdmin } from '@/server/admin/sources';
import { seedDemoData } from '@/server/seed';

import { DEMO_COUNTS, DEMO_FEED_URLS, DEMO_SHOPS } from '../fixtures/demo';
import { insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';

/** resetDatabase leaves the migrated state: the fixed tree, one root and its children. */
const FIXED_CATEGORY_COUNT = 1 + FIXED_CATEGORY_TREE.children.length;

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
  it('loads the demo network, the demo shops, their feeds and the mappings, and no product', async () => {
    const report = await seedDemoData(getDb());
    expect(report).toMatchObject({
      networks: 1,
      shops: DEMO_COUNTS.shops,
      feeds: DEMO_COUNTS.feeds,
      categoryMappings: DEMO_COUNTS.categoryMappings,
    });
    expect(report).not.toHaveProperty('categories');
    expect(await counts()).toEqual({
      networks: 1,
      shops: DEMO_COUNTS.shops,
      feeds: DEMO_COUNTS.feeds,
      categories: FIXED_CATEGORY_COUNT,
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

  it('creates no category: the fixed tree is the same rows before and after', async () => {
    const before = await getDb().select().from(categories).orderBy(categories.id);
    expect(before).toHaveLength(FIXED_CATEGORY_COUNT);
    await seedDemoData(getDb());
    expect(await getDb().select().from(categories).orderBy(categories.id)).toEqual(before);
  });

  it('refuses a database without the fixed tree, naming the slug, and writes nothing', async () => {
    await getDb().delete(categories);
    await expect(seedDemoData(getDb())).rejects.toThrow(/fixed category missing: .+; run migrate first/);
    expect(await counts()).toMatchObject({ networks: 0, shops: 0, feeds: 0, categories: 0, categoryMappings: 0 });
  });

  it('run twice changes nothing: the second report inserts 0 and the counts are equal', async () => {
    await seedDemoData(getDb());
    const before = await counts();
    const second = await seedDemoData(getDb());
    expect(second).toMatchObject({ networks: 0, shops: 0, feeds: 0, categoryMappings: 0 });
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
        { feedUrl: DEMO_FEED_URLS[0], feedCategory: 'Recambios > Filtros de aceite', slug: 'filtros-de-aceite' },
        { feedUrl: DEMO_FEED_URLS[0], feedCategory: 'Recambios > Filtros de aire', slug: 'filtros-de-aire' },
        { feedUrl: DEMO_FEED_URLS[0], feedCategory: 'Recambios > Filtros de habitáculo', slug: 'filtros-de-habitaculo' },
        { feedUrl: DEMO_FEED_URLS[0], feedCategory: 'Recambios > Aceites de motor', slug: 'aceite-de-motor' },
        { feedUrl: DEMO_FEED_URLS[1], feedCategory: 'Filtros de aceite', slug: 'filtros-de-aceite' },
      ]),
    );
    // Every mapping lands on a leaf of the fixed tree, never on the root.
    const leaves: string[] = FIXED_CATEGORY_TREE.children.map((child) => child.slug);
    expect(rows.every((row) => leaves.includes(row.slug))).toBe(true);
  });

  it('leaves the demo feed categories of the unmapped products, and the empty category, unmapped', async () => {
    await seedDemoData(getDb());
    const rows = await getDb().select().from(feedCategoryMappings);
    const mapped = rows.map((row) => row.feedCategory);
    for (const feedCategory of ['Jardín > Cortacésped', 'Bricolaje > Taladros', 'Herramienta manual']) {
      expect(mapped).not.toContain(feedCategory);
    }
    const [empty] = await getDb().select().from(categories).where(eq(categories.slug, 'filtros-de-combustible'));
    expect(rows.some((row) => row.categoryId === empty.id)).toBe(false);
  });

  it('keeps a mapping an admin changed: a second seed never rewrites it', async () => {
    await seedDemoData(getDb());
    const [other] = await getDb().select().from(categories).where(eq(categories.slug, 'filtros-de-aire'));
    await getDb()
      .update(feedCategoryMappings)
      .set({ categoryId: other.id })
      .where(eq(feedCategoryMappings.feedCategory, 'Filtros de aceite'));
    await seedDemoData(getDb());
    const [row] = await getDb()
      .select()
      .from(feedCategoryMappings)
      .where(eq(feedCategoryMappings.feedCategory, 'Filtros de aceite'));
    expect(row.categoryId).toBe(other.id);
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
    expect(approvedFeeds).toHaveLength(DEMO_COUNTS.feeds);
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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('the derived demo marker (S3.1, AC 35)', () => {
  it('marks the seeded network, shops and feeds demo, and a row an admin creates never', async () => {
    await seedDemoData(getDb());
    const created = await createShop(form({ name: 'Tienda del admin', slug: 'tienda-del-admin' }));
    const network = await createNetwork(form({ name: 'Red del admin', slug: 'red-del-admin' }));
    expect(created.status).toBe('written');
    expect(network.status).toBe('written');

    const list = await listSourcesForAdmin();
    const seeded = list.filter((shop) => DEMO_SHOPS.some((demo) => demo.slug === shop.slug));
    expect(seeded).toHaveLength(DEMO_COUNTS.shops);
    for (const shop of seeded) {
      expect(shop.demo, shop.name).toBe(true);
      expect(shop.feeds.every((feed) => feed.demo)).toBe(true);
      // The seeded address reads as no host: a demo-feed: value is never shown (AC 24).
      expect(shop.feeds.every((feed) => feed.host === null)).toBe(true);
    }
    expect(list.find((shop) => shop.slug === 'tienda-del-admin')).toMatchObject({ demo: false, feeds: [] });

    const networkList = await listNetworksForAdmin();
    expect(networkList.find((row) => row.slug === 'demo')?.demo).toBe(true);
    expect(networkList.find((row) => row.slug === 'red-del-admin')?.demo).toBe(false);
  });

  it('a feed an admin creates is never demo, even under a demo shop and a demo network', async () => {
    await seedDemoData(getDb());
    const [demoShop] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno'));
    const [demoNetwork] = await getDb().select().from(networks).where(eq(networks.slug, 'demo'));
    const result = await createFeed(
      form({ shopId: String(demoShop.id), networkId: String(demoNetwork.id), url: 'https://feeds.example/real.csv' }),
    );
    expect(result.status).toBe('written');
    const created = (await getDb().select().from(feeds).where(eq(feeds.url, 'https://feeds.example/real.csv')))[0];
    expect(created).toMatchObject({ isDemo: false, isApproved: false, sourceType: 'affiliate_network' });
  });

  it('a demo shop and a demo network lose the marker once a non-demo feed is added to them, and only them (D-16)', async () => {
    await seedDemoData(getDb());
    const [one] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno'));
    const [demoNetwork] = await getDb().select().from(networks).where(eq(networks.slug, 'demo'));
    expect((await createFeed(form({ shopId: String(one.id), networkId: String(demoNetwork.id), url: 'https://feeds.example/real.csv' }))).status).toBe('written');

    const list = await listSourcesForAdmin();
    expect(list.find((shop) => shop.id === one.id)?.demo).toBe(false);
    for (const shop of list.filter((row) => row.id !== one.id)) expect(shop.demo, shop.name).toBe(true);
    expect((await listNetworksForAdmin()).find((row) => row.slug === 'demo')?.demo).toBe(false);
    // The feeds keep their own marker: the seeded one is still demo.
    expect(list.find((shop) => shop.id === one.id)?.feeds.map((feed) => feed.demo)).toEqual([true, false]);
  });

  it('a shop or network with no feed is not demo', async () => {
    await createShop(form({ name: 'Sin feeds', slug: 'sin-feeds' }));
    await createNetwork(form({ name: 'Sin feeds', slug: 'red-sin-feeds' }));
    expect((await listSourcesForAdmin())[0].demo).toBe(false);
    expect((await listNetworksForAdmin())[0].demo).toBe(false);
  });
});

describe('a restart after an admin edited the demo rows (S3.1, AC 36)', () => {
  it('does not rename them back, adds no second row, and keeps a disable', async () => {
    await seedDemoData(getDb());
    await getDb().update(shops).set({ name: 'Renombrada por el admin', isApproved: false }).where(eq(shops.slug, 'tienda-demo-uno'));
    await getDb().update(networks).set({ name: 'Red renombrada' }).where(eq(networks.slug, 'demo'));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.url, DEMO_FEED_URLS[0]));
    const before = await counts();

    const second = await seedDemoData(getDb());

    expect(second).toMatchObject({ networks: 0, shops: 0, feeds: 0 });
    expect(await counts()).toEqual(before);
    const [shop] = await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno'));
    const [network] = await getDb().select().from(networks).where(eq(networks.slug, 'demo'));
    const [feed] = await getDb().select().from(feeds).where(eq(feeds.url, DEMO_FEED_URLS[0]));
    expect(shop).toMatchObject({ name: 'Renombrada por el admin', isApproved: false });
    expect(network.name).toBe('Red renombrada');
    expect(feed.isApproved).toBe(false);
    expect((await getDb().select().from(shops).where(eq(shops.slug, 'tienda-demo-uno')))).toHaveLength(1);
  });
});
