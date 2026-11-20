import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { clicks, feeds, networks, products } from '@/db/schema';
import { listCategoryMappingsForAdmin, markOutsideScope, assignCategory } from '@/server/admin/category-mappings';
import { importFeeds } from '@/server/importer';

import { insertCategoryMapping, insertFeed, insertFixtureFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import {
  aFeed,
  allRecords,
  categoryForm,
  fiveTargets,
  offerOf,
  productIn,
  publicView,
  rootCategory,
  rowsApartFromCategory,
} from '../support/categories';
import { resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

// S4.2 (T4.2.3), the read behind the screen: ACs 10 to 17 and 50. The page's own markup is in
// category-mapping-page.test.ts; here the data, with the cases the demo cannot reach.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

async function feedOf(feedId: number) {
  const page = await listCategoryMappingsForAdmin();
  const feed = page.feeds.find((candidate) => candidate.id === feedId);
  if (!feed) throw new Error(`feed ${feedId} is not listed`);
  return feed;
}

const summary = (rows: { feedCategory: string; productCount: number; state: { kind: string } }[]) =>
  rows.map((row) => [row.feedCategory, row.productCount, row.state.kind]);

describe('every feed is listed, with its identity and no address (AC 10)', () => {
  it('lists an approved, a disabled, an unapproved-shop and a demo feed, with shop, network and host', async () => {
    const [network] = await getDb().insert(networks).values({ name: 'Red Uno', slug: 'red-uno' }).returning({ id: networks.id });
    const shop = await insertShop({ name: 'Tienda Uno' });
    const [real] = await getDb()
      .insert(feeds)
      .values({
        shopId: shop.id,
        networkId: network.id,
        sourceType: 'affiliate_network',
        url: 'https://user:PASS-SENTINEL@feeds.example:8443/ruta/secreta.csv?apikey=KEY-SENTINEL#frag',
        isApproved: true,
        isDemo: false,
      })
      .returning({ id: feeds.id });
    const disabled = await aFeed({ approved: false });
    const unapprovedShop = await aFeed({ shopApproved: false });
    const demo = await aFeed({ demo: true, url: 'demo-feed:uno' });

    const page = await listCategoryMappingsForAdmin();

    expect(page.feeds.map((feed) => feed.id).sort()).toEqual([real.id, disabled.feedId, unapprovedShop.feedId, demo.feedId].sort());
    expect(page.feeds.find((feed) => feed.id === real.id)).toMatchObject({
      shopName: 'Tienda Uno',
      shopApproved: true,
      approved: true,
      demo: false,
      networkName: 'Red Uno',
      host: 'feeds.example',
    });
    expect(page.feeds.find((feed) => feed.id === disabled.feedId)).toMatchObject({ approved: false, networkName: null });
    expect(page.feeds.find((feed) => feed.id === unapprovedShop.feedId)).toMatchObject({ approved: true, shopApproved: false });
    expect(page.feeds.find((feed) => feed.id === demo.feedId)).toMatchObject({ demo: true, host: null });
    // No scheme, port, user name, password, path, query, fragment or key anywhere in what is returned.
    expect(JSON.stringify(page)).not.toMatch(/PASS-SENTINEL|KEY-SENTINEL|8443|ruta|secreta|https?:|demo-feed|frag|apikey/);
    for (const feed of page.feeds) expect(Object.keys(feed)).not.toContain('url');
  });

  it('answers with the five targets in tree order and no feed at all (AC 16)', async () => {
    const page = await listCategoryMappingsForAdmin();
    expect(page.feeds).toEqual([]);
    const targets = await fiveTargets();
    expect(page.targets).toEqual(targets.map(({ id, name }) => ({ id, name })));
    const root = await rootCategory();
    expect(page.targets.map((target) => target.id)).not.toContain(root.id);
    expect(page.targets).toHaveLength(5);
  });
});

describe('each distinct feed category with its number of products (AC 11, 12)', () => {
  it('counts distinct products, not offers: a product in two categories counts in each, two offers in one count once', async () => {
    const { feedId } = await aFeed();
    const both = await productIn(feedId, 'Uno');
    await offerOf(both.id, feedId, 'Dos');
    await offerOf(both.id, feedId, 'Uno'); // a second offer of the same product in the same category
    await productIn(feedId, 'Uno');
    await productIn(feedId, 'Dos');
    await productIn(feedId, 'Dos');
    await productIn(feedId, 'Dos');

    const feed = await feedOf(feedId);

    expect(summary(feed.rows)).toEqual([
      ['Dos', 4, 'not_reviewed'],
      ['Uno', 2, 'not_reviewed'],
    ]);
    expect(feed.hasOffers).toBe(true);
  });

  it('counts a hidden product, a hidden offer and the products of a disabled feed (AC 12)', async () => {
    const disabled = await aFeed({ approved: false, shopApproved: false });
    await productIn(disabled.feedId, 'Cat', { product: { isHidden: true } });
    await productIn(disabled.feedId, 'Cat', { offer: { isHidden: true } });
    await productIn(disabled.feedId, 'Cat', { offer: { inReview: true } });
    await productIn(disabled.feedId, 'Cat');

    expect(summary((await feedOf(disabled.feedId)).rows)).toEqual([['Cat', 4, 'not_reviewed']]);
  });

  it('keeps a product that has a category and one that has none in the same count', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Cat', { categoryId: aceite.id });
    await productIn(feedId, 'Cat');

    expect(summary((await feedOf(feedId)).rows)).toEqual([['Cat', 2, 'not_reviewed']]);
  });

  it('keeps each feed\'s rows apart: the same string on two feeds is two rows, one per feed', async () => {
    const one = await aFeed();
    const two = await aFeed();
    await productIn(one.feedId, 'Cat');
    await productIn(two.feedId, 'Cat');
    await productIn(two.feedId, 'Cat');

    expect(summary((await feedOf(one.feedId)).rows)).toEqual([['Cat', 1, 'not_reviewed']]);
    expect(summary((await feedOf(two.feedId)).rows)).toEqual([['Cat', 2, 'not_reviewed']]);
  });

  it('shows the state of each: mapped (naming the target), outside scope, not reviewed (AC 11)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Asignada');
    await productIn(feedId, 'Fuera');
    await productIn(feedId, 'Pendiente');
    await assignCategory(categoryForm({ feedId, feedCategory: 'Asignada', target: aceite.id }));
    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Fuera' }));

    const states = Object.fromEntries((await feedOf(feedId)).rows.map((row) => [row.feedCategory, row.state]));

    expect(states).toEqual({
      Asignada: { kind: 'mapped', targetId: aceite.id, targetName: aceite.name },
      Fuera: { kind: 'outside' },
      Pendiente: { kind: 'not_reviewed' },
    });
  });
});

describe('order and exact matching (AC 13, 14)', () => {
  it('lists the not-reviewed categories before the mapped and the outside-scope ones, whatever their counts', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    for (let n = 0; n < 3; n += 1) await productIn(feedId, 'Asignada grande');
    for (let n = 0; n < 2; n += 1) await productIn(feedId, 'Fuera mediana');
    await productIn(feedId, 'Pendiente pequena');
    await assignCategory(categoryForm({ feedId, feedCategory: 'Asignada grande', target: aceite.id }));
    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Fuera mediana' }));

    const rows = (await feedOf(feedId)).rows;

    expect(rows.map((row) => row.state.kind)).toEqual(['not_reviewed', 'mapped', 'outside']);
    expect(rows[0].feedCategory).toBe('Pendiente pequena');
  });

  it('orders the rows of one group by more products first and then by name', async () => {
    const { feedId } = await aFeed();
    await productIn(feedId, 'Beta');
    await productIn(feedId, 'Alfa');
    await productIn(feedId, 'Gamma');
    await productIn(feedId, 'Gamma');

    expect((await feedOf(feedId)).rows.map((row) => row.feedCategory)).toEqual(['Gamma', 'Alfa', 'Beta']);
  });

  it('keeps "Filtros" and "filtros" as two rows and folds surrounding white space (imported, so the offers carry what the importer stores)', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    await importFeeds(getDb(), { feedId, deps: fixtureDeps });

    const feed = await feedOf(feedId);

    expect(feed.rows.map((row) => row.feedCategory).sort()).toEqual(['Categoria sin mapa', 'Filtros', 'filtros']);
    // "  Filtros  " is the same row as "Filtros": two products, not a third row.
    expect(Object.fromEntries(feed.rows.map((row) => [row.feedCategory, row.productCount]))).toEqual({
      Filtros: 2,
      filtros: 1,
      'Categoria sin mapa': 1,
    });
  });

  it('records and offers of two cases never merge, even when only a record exists for one of them', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Filtros');
    await insertCategoryMapping(feedId, 'filtros', aceite.id);

    const rows = (await feedOf(feedId)).rows;

    expect(summary(rows)).toEqual([
      ['Filtros', 1, 'not_reviewed'],
      ['filtros', 0, 'mapped'],
    ]);
  });
});

describe('products with an empty category cell (AC 15)', () => {
  it('counts them per feed, as distinct products, and lists them as no category', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    await importFeeds(getDb(), { feedId, deps: fixtureDeps });
    const other = await aFeed();
    await productIn(other.feedId, null);
    const twice = await productIn(other.feedId, null);
    await offerOf(twice.id, other.feedId, null);

    const feed = await feedOf(feedId);

    expect(feed.emptyCellProducts).toBe(1);
    expect(feed.rows.map((row) => row.feedCategory)).not.toContain('');
    expect(feed.rows).toHaveLength(3);
    expect((await feedOf(other.feedId)).emptyCellProducts).toBe(2);
    expect((await feedOf(other.feedId)).rows).toEqual([]);
  });

  it('a feed with no category column shows every product there and lists no category', async () => {
    const { feedId } = await insertFixtureFeed('category-no-column.csv');
    await importFeeds(getDb(), { feedId, deps: fixtureDeps });

    const feed = await feedOf(feedId);

    expect(feed).toMatchObject({ hasOffers: true, emptyCellProducts: 1, rows: [] });
  });
});

describe('a record with no offer, and a feed never imported (AC 16, 17)', () => {
  it('lists a recorded category no offer carries with a count of zero, in its state', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await insertCategoryMapping(feedId, 'Solo registrada', aceite.id);
    await insertCategoryMapping(feedId, 'Solo fuera', aceite.id);
    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Solo fuera' }));

    const feed = await feedOf(feedId);

    expect(summary(feed.rows)).toEqual([
      ['Solo fuera', 0, 'outside'],
      ['Solo registrada', 0, 'mapped'],
    ]);
    expect(feed.hasOffers).toBe(false);
  });

  it('shows a record and its offers as one row, not two', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Cat');
    await insertCategoryMapping(feedId, 'Cat', aceite.id);

    expect(summary((await feedOf(feedId)).rows)).toEqual([['Cat', 1, 'mapped']]);
  });

  it('a feed never imported with no record has no rows, no offers and no empty cells', async () => {
    const { feedId } = await aFeed();

    expect(await feedOf(feedId)).toMatchObject({ hasOffers: false, emptyCellProducts: 0, rows: [] });
  });

  it('a feed with offers but no categories at all is told apart from one never imported', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({ categoryId: null });
    await insertOffer({ productId: product.id, feedId, feedCategory: null });

    expect(await feedOf(feedId)).toMatchObject({ hasOffers: true, emptyCellProducts: 1, rows: [] });
  });
});

describe('opening the screen writes nothing and changes no public answer (AC 50)', () => {
  it('leaves every table as it was and every public reader answering the same', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const listed = await productIn(feedId, 'Uno', { categoryId: aceite.id });
    await productIn(feedId, 'Dos');
    await productIn(feedId, null);
    await insertCategoryMapping(feedId, 'Registrada', aceite.id);
    const dump = async () => ({
      products: await getDb().select().from(products).orderBy(products.id),
      rows: await rowsApartFromCategory(),
      records: await allRecords(),
      clicks: await getDb().select().from(clicks),
    });
    const view = () => publicView({ productSlug: listed.slug, offerId: listed.offerId, categorySlug: aceite.slug });
    const before = await dump();
    const viewBefore = await view();
    expect(viewBefore).toMatchObject({ productPage: true, categoryCount: 1 });

    await listCategoryMappingsForAdmin();
    await listCategoryMappingsForAdmin();

    expect(await view()).toEqual({ ...viewBefore });
    // The /go call in the view logs a click of its own; compare the rest of the dump.
    const after = await dump();
    expect({ ...after, clicks: undefined }).toEqual({ ...before, clicks: undefined });
  });
});
