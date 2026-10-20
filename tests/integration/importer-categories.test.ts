import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products as productsTable } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { importExitCode, importFeeds } from '@/server/importer';

import {
  allOffers,
  allProducts,
  insertCategory,
  insertCategoryMapping,
  insertFixtureFeed,
  productBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { fixtureDeps, readFeedFixture, textDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

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

const run = (feedId?: number) => importFeeds(getDb(), { feedId, deps: fixtureDeps });

const byTitle = async () => Object.fromEntries((await allProducts()).map((row) => [row.title, row]));
const offerByExternalId = async () =>
  Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer]));

// S5.1, AC 3, 5, 6, 7: the importer stores the feed's category string on the
// offer and assigns our category through the feed's mapping.
describe('category capture and assignment (AC 5, AC 7)', () => {
  it('stores the feed category as given (trimmed), and null for an empty cell', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    await run(feedId);
    const rows = await offerByExternalId();
    expect(rows['M-1'].feedCategory).toBe('Filtros');
    expect(rows['M-2'].feedCategory).toBe('Categoria sin mapa');
    expect(rows['M-3'].feedCategory).toBeNull();
    expect(rows['M-4'].feedCategory).toBe('Filtros');
    expect(rows['M-5'].feedCategory).toBe('filtros');
  });

  it('assigns the mapped category and leaves the others unassigned', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    const filtros = await insertCategory({ slug: 'filtros' });
    await insertCategoryMapping(feedId, 'Filtros', filtros.id);

    await run(feedId);

    const products = await byTitle();
    expect(products['Mixto Filtro mapeado'].categoryId).toBe(filtros.id);
    expect(products['Mixto Espacios'].categoryId).toBe(filtros.id); // "  Filtros  " is trimmed
    expect(products['Mixto Sin mapa'].categoryId).toBeNull(); // no mapping for this string
    expect(products['Mixto Celda vacia'].categoryId).toBeNull(); // empty cell (AC 3)
    expect(products['Mixto Otra caja'].categoryId).toBeNull(); // match is exact, not case-folded (D-1)
  });

  it('makes only the mapped products public, and the unmapped ones appear on no public read', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    const filtros = await insertCategory({ slug: 'filtros' });
    await insertCategoryMapping(feedId, 'Filtros', filtros.id);
    await run(feedId);

    const listing = await getPublicCategoryPage('filtros', 1);
    expect(listing?.products.map((card) => card.title).sort()).toEqual(['Mixto Espacios', 'Mixto Filtro mapeado']);
    const unmapped = await productBySlug('mixto-sin-mapa');
    expect(unmapped).toBeDefined();
    expect(await getPublicProductBySlug('mixto-sin-mapa')).toBeNull();
    expect(await getPublicProductBySlug('mixto-celda-vacia')).toBeNull();
    expect(await getPublicProductBySlug('mixto-filtro-mapeado')).not.toBeNull();
  });

  it('does not fail or reject a run that meets an unmapped or empty category', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    const report = await run(feedId);
    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 5,
      productsCreated: 5,
      offersCreated: 5,
      rejected: [],
    });
    expect(importExitCode(report)).toBe(0);
    expect(await allProducts()).toHaveLength(5);
  });

  it('imports a feed with no category column at all: the rows import and stay unmapped', async () => {
    const { feedId } = await insertFixtureFeed('category-no-column.csv');
    const report = await run(feedId);
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 1, rejected: [] });
    const [product] = await allProducts();
    expect(product.categoryId).toBeNull();
    expect((await allOffers())[0].feedCategory).toBeNull();
  });

  it('assigns the next import once a category gets mapped, through the known-offer path (AC 5)', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    await run(feedId);
    expect((await allProducts()).every((row) => row.categoryId === null)).toBe(true);
    expect(await getPublicProductBySlug('mixto-filtro-mapeado')).toBeNull();

    const filtros = await insertCategory({ slug: 'filtros' });
    await insertCategoryMapping(feedId, 'Filtros', filtros.id);
    const report = await run(feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 5 });
    const products = await byTitle();
    expect(products['Mixto Filtro mapeado'].categoryId).toBe(filtros.id);
    expect(products['Mixto Espacios'].categoryId).toBe(filtros.id);
    expect(await getPublicProductBySlug('mixto-filtro-mapeado')).not.toBeNull();
    expect(await getPublicProductBySlug('mixto-sin-mapa')).toBeNull();
  });

  it('keeps a mapping per feed: the same string on another feed stays unmapped (D-1)', async () => {
    const first = await insertFixtureFeed('category-ean-one.csv', { shopName: 'Tienda A' });
    await insertFixtureFeed('category-ean-three.csv', { shopName: 'Tienda C' });
    const category = await insertCategory({ slug: 'uno' });
    await insertCategoryMapping(first.feedId, 'Cat Uno', category.id);

    await run();

    const products = await byTitle();
    expect(products['Fixture Alpha Filtro'].categoryId).toBe(category.id);
    expect(products['Fixture Beta Taladro'].categoryId).toBeNull();
  });
});

describe('a re-run changes no assignment (AC 6)', () => {
  it('leaves category ids, products and offers unchanged and creates no duplicates', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    const filtros = await insertCategory({ slug: 'filtros' });
    await insertCategoryMapping(feedId, 'Filtros', filtros.id);
    await run(feedId);
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const report = await run(feedId);

    expect(await allProducts()).toEqual(productsBefore);
    expect((await allOffers()).map((o) => [o.id, o.externalId, o.feedCategory])).toEqual(
      offersBefore.map((o) => [o.id, o.externalId, o.feedCategory]),
    );
    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 5 });
  });
});

describe('first mapped wins and is never cleared (OD-F, D-3)', () => {
  async function twoFeeds() {
    const one = await insertFixtureFeed('category-ean-one.csv', { shopName: 'Tienda A' });
    const two = await insertFixtureFeed('category-ean-two.csv', { shopName: 'Tienda B' });
    const catA = await insertCategory({ slug: 'categoria-a' });
    const catB = await insertCategory({ slug: 'categoria-b' });
    await insertCategoryMapping(one.feedId, 'Cat Uno', catA.id);
    await insertCategoryMapping(two.feedId, 'Cat Dos', catB.id);
    return { one, two, catA, catB };
  }

  it('keeps the first feed\'s category when a second feed maps the same product elsewhere', async () => {
    const { one, two, catA } = await twoFeeds();
    await run(one.feedId);
    await run(two.feedId);

    const products = await allProducts();
    expect(products).toHaveLength(1);
    expect(products[0].categoryId).toBe(catA.id);
    expect(await allOffers()).toHaveLength(2);
    // The product is in one category only, so it is on one category page only.
    expect((await getPublicCategoryPage('categoria-a', 1))?.productCount).toBe(1);
    expect((await getPublicCategoryPage('categoria-b', 1))?.productCount).toBe(0);
  });

  it('follows import order, not feed id: the feed imported first decides', async () => {
    const { one, two, catB } = await twoFeeds();
    await run(two.feedId);
    await run(one.feedId);
    expect((await allProducts())[0].categoryId).toBe(catB.id);
  });

  it('does not move the product when a later full import runs both feeds again', async () => {
    const { one, two, catA } = await twoFeeds();
    await run(one.feedId);
    await run(two.feedId);
    await run();
    await run();
    expect((await allProducts())[0].categoryId).toBe(catA.id);
  });

  it('does not overwrite an assignment when the mapping that made it is later changed', async () => {
    const { one, catA, catB } = await twoFeeds();
    await run(one.feedId);
    // Re-point the mapping directly: an admin edit (S4.2) is not built yet.
    await getDb().execute(
      sql`update feed_category_mappings set category_id = ${catB.id} where feed_id = ${one.feedId}`,
    );
    await run(one.feedId);
    expect((await allProducts())[0].categoryId).toBe(catA.id);
  });

  it('never clears a category when a later import carries an empty category cell', async () => {
    const { one, two, catA } = await twoFeeds();
    await run(one.feedId);
    const emptyText = readFeedFixture('category-ean-two-empty.csv');
    await importFeeds(getDb(), { feedId: two.feedId, deps: textDeps({ [two.feedId]: emptyText }) });

    const [product] = await allProducts();
    expect(product.categoryId).toBe(catA.id);
    const second = (await allOffers()).find((offer) => offer.feedId === two.feedId);
    expect(second?.feedCategory).toBeNull();
  });

  it('never clears a category when the feed row\'s category string stops being mapped', async () => {
    const { one, catA } = await twoFeeds();
    await run(one.feedId);
    const renamed = 'id,title,brand,part_number,ean,price,currency,url,description,category\n' +
      'E-1,Fixture Alpha Filtro,MarcaUno,PN 100,2000000000046,10.00,EUR,https://shop-a.example/p/E-1,,Otra categoria\n';
    await importFeeds(getDb(), { feedId: one.feedId, deps: textDeps({ [one.feedId]: renamed }) });

    expect((await allProducts())[0].categoryId).toBe(catA.id);
    expect((await allOffers())[0].feedCategory).toBe('Otra categoria'); // feed data is refreshed
  });

  it('refreshes offers.feed_category on every import like the price', async () => {
    const { one } = await twoFeeds();
    await run(one.feedId);
    expect((await allOffers())[0].feedCategory).toBe('Cat Uno');
    const changed = 'id,title,brand,part_number,ean,price,currency,url,description,category\n' +
      'E-1,Fixture Alpha Filtro,MarcaUno,PN 100,2000000000046,11.00,EUR,https://shop-a.example/p/E-1,,Cat Nueva\n';
    await importFeeds(getDb(), { feedId: one.feedId, deps: textDeps({ [one.feedId]: changed }) });
    expect((await allOffers())[0]).toMatchObject({ feedCategory: 'Cat Nueva', priceCents: 1100 });
  });
});

describe('a mapping never overrides the admin (guardrail 1)', () => {
  it('keeps a hidden product non-public after the import that assigns its category', async () => {
    const { feedId } = await insertFixtureFeed('category-ean-one.csv');
    await run(feedId); // unmapped at first
    const [product] = await allProducts();
    await getDb().update(productsTable).set({ isHidden: true }).where(eq(productsTable.id, product.id));
    const category = await insertCategory({ slug: 'uno' });
    await insertCategoryMapping(feedId, 'Cat Uno', category.id);

    await run(feedId);

    expect((await allProducts())[0]).toMatchObject({ categoryId: category.id, isHidden: true });
    expect((await getPublicCategoryPage('uno', 1))?.productCount).toBe(0);
  });

  it('keeps the product non-public when its feed is disabled after the import', async () => {
    const { feedId } = await insertFixtureFeed('category-ean-one.csv');
    const category = await insertCategory({ slug: 'uno' });
    await insertCategoryMapping(feedId, 'Cat Uno', category.id);
    await run(feedId);
    expect((await getPublicCategoryPage('uno', 1))?.productCount).toBe(1);

    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));

    expect((await getPublicCategoryPage('uno', 1))?.productCount).toBe(0);
    expect(await getPublicProductBySlug((await allProducts())[0].slug)).toBeNull();
  });

  it('keeps an admin-hidden offer hidden through the assigning import', async () => {
    const { feedId } = await insertFixtureFeed('category-ean-one.csv');
    const category = await insertCategory({ slug: 'uno' });
    await run(feedId);
    await getDb().update(offers).set({ isHidden: true });
    await insertCategoryMapping(feedId, 'Cat Uno', category.id);
    await run(feedId);
    expect((await allOffers())[0].isHidden).toBe(true);
    expect((await getPublicCategoryPage('uno', 1))?.productCount).toBe(0);
  });
});
