import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, products } from '@/db/schema';
import { importFeeds } from '@/server/importer';

import {
  allOffers,
  allProducts,
  insertFeed,
  insertFixtureFeed,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
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

// 0008 step 1 (EAN), step 3 (new product), conflicts rejected into the report.
describe('EAN matching (0008, slice B cut)', () => {
  it('attaches a second feed\'s row with the same EAN: one product, two offers, text unchanged', async () => {
    const first = await insertFixtureFeed('ean-first.csv', { shopName: 'Tienda A' });
    await run(first.feedId);
    const before = await allProducts();
    expect(before).toHaveLength(2);

    const second = await insertFixtureFeed('ean-second.csv', { shopName: 'Tienda B' });
    const report = await run(second.feedId);

    const after = await allProducts();
    expect(after).toEqual(before); // no new product, no text rewritten
    const alpha = after.find((row) => row.title === 'Fixture Alpha Filtro');
    expect(alpha).toMatchObject({ brand: 'MarcaUno', partNumber: 'PN 100', description: 'Descripcion alpha' });

    const offers = (await allOffers()).filter((offer) => offer.productId === alpha?.id);
    expect(offers.map((offer) => [offer.feedId, offer.priceCents]).sort()).toEqual(
      [
        [first.feedId, 1000],
        [second.feedId, 950],
      ].sort(),
    );
    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 2,
      productsCreated: 0,
      offersCreated: 2,
      rejected: [],
    });
  });

  it('matches an EAN written with hyphens against the stored digit string', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const second = await insertFixtureFeed('ean-second.csv'); // B-1 writes 200-0000-000046
    await run(second.feedId);
    const [alpha] = await getDb().select().from(products).where(eq(products.eanNormalised, '2000000000046'));
    expect(alpha.ean).toBe('2000000000046'); // as received from the first feed
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
  });

  it('treats brands that differ only in case and spacing as the same brand', async () => {
    // ean-second.csv B-1 has brand "marcauno " against the stored "MarcaUno".
    const first = await insertFixtureFeed('ean-first.csv');
    const second = await insertFixtureFeed('ean-second.csv');
    await run(first.feedId);
    const report = await run(second.feedId);
    expect(report.feeds[0].rejected).toEqual([]);
  });

  it('rejects the same EAN with a different brand as ean_brand_conflict and creates nothing', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const productsBefore = await allProducts();
    const offersBefore = await allOffers();

    const conflict = await insertFixtureFeed('ean-brand-conflict.csv');
    const report = await run(conflict.feedId);

    expect(report.feeds[0]).toMatchObject({
      outcome: 'imported',
      rows: 1,
      productsCreated: 0,
      offersCreated: 0,
      rejected: [{ record: 2, code: 'ean_brand_conflict', field: 'ean' }],
    });
    expect(await allProducts()).toEqual(productsBefore);
    expect(await allOffers()).toEqual(offersBefore);
  });

  it('attaches when the incoming row has no brand', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    const nullBrand = await insertFixtureFeed('ean-null-brand.csv');
    const report = await run(nullBrand.feedId);

    expect(report.feeds[0].rejected).toEqual([]);
    const [alpha] = await getDb().select().from(products).where(eq(products.eanNormalised, '2000000000046'));
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
  });

  it('attaches when the stored product has no brand', async () => {
    const stored = await insertProduct({
      slug: 'sin-marca',
      title: 'Producto sin marca',
      ean: '2000000000060',
      eanNormalised: '2000000000060',
      brand: null,
      brandNormalised: null,
    });
    const feed = await insertFixtureFeed('ean-null-brand.csv'); // D-2: EAN ...060 with brand MarcaDos
    const report = await run(feed.feedId);

    expect(report.feeds[0].rejected).toEqual([]);
    const attached = (await allOffers()).filter((offer) => offer.productId === stored.id);
    expect(attached.map((offer) => offer.externalId)).toEqual(['D-2']);
  });

  it('creates a new product for a row whose EAN nobody has', async () => {
    const feed = await insertFixtureFeed('ean-first.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ productsCreated: 2, offersCreated: 2 });
    expect(await allProducts()).toHaveLength(2);
  });

  it('rejects ambiguous_ean when two products already share the EAN, and creates nothing', async () => {
    await insertProduct({ slug: 'gemelo-1', ean: '2000000000046', eanNormalised: '2000000000046' });
    await insertProduct({ slug: 'gemelo-2', ean: '2000000000046', eanNormalised: '2000000000046' });
    const feed = await insertFixtureFeed('ean-null-brand.csv');
    const report = await run(feed.feedId);

    expect(report.feeds[0].rejected).toEqual([{ record: 2, code: 'ambiguous_ean', field: 'ean' }]);
    expect(await allProducts()).toHaveLength(3); // the two twins plus D-2's new product
    expect((await allOffers()).map((offer) => offer.externalId)).toEqual(['D-2']);
  });

  it('gives each row without an EAN its own product, with numbered slugs on a title clash', async () => {
    const feed = await insertFixtureFeed('no-ean.csv');
    const report = await run(feed.feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 2, offersCreated: 2, rejected: [] });
    const rows = await allProducts();
    expect(rows.map((row) => row.slug).sort()).toEqual(['producto-sin-ean', 'producto-sin-ean-2']);
    expect(rows.every((row) => row.ean === null && row.eanNormalised === null)).toBe(true);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('keeps part number and brand stored raw and normalised side by side', async () => {
    const feed = await insertFixtureFeed('ean-first.csv');
    await run(feed.feedId);
    const [alpha] = await getDb().select().from(products).where(eq(products.slug, 'fixture-alpha-filtro'));
    expect(alpha).toMatchObject({
      brand: 'MarcaUno',
      brandNormalised: 'MARCAUNO',
      partNumber: 'PN 100',
      partNumberNormalised: 'PN100',
    });
  });
});

describe('row rules that decide which product a row belongs to', () => {
  it('rejects a present but invalid EAN as invalid_ean instead of creating a stray product', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0].rejected).toContainEqual({ record: 7, code: 'invalid_ean', field: 'ean' });
    expect((await allOffers()).map((offer) => offer.externalId)).not.toContain('R-6');
  });

  it('rejects the second row that repeats an id within one feed as duplicate_id', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0].rejected).toContainEqual({ record: 9, code: 'duplicate_id', field: 'id' });
    const kept = (await allOffers()).filter((offer) => offer.externalId === 'R-1');
    expect(kept).toHaveLength(1);
    expect(kept[0].priceCents).toBe(500); // the first occurrence wins
  });

  it('reports every reject code of a mixed feed with its record number and keeps the good row', async () => {
    const feed = await insertFixtureFeed('rejects.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 8, offersCreated: 1 });
    expect(report.feeds[0].rejected).toEqual([
      { record: 3, code: 'missing_id', field: 'id' },
      { record: 4, code: 'missing_title', field: 'title' },
      { record: 5, code: 'invalid_price', field: 'price' },
      { record: 6, code: 'invalid_currency', field: 'currency' },
      { record: 7, code: 'invalid_ean', field: 'ean' },
      { record: 8, code: 'invalid_url', field: 'url' },
      { record: 9, code: 'duplicate_id', field: 'id' },
    ]);
  });

  it('stores the prices of price-edge.csv as exact integer cents', async () => {
    const feed = await insertFixtureFeed('price-edge.csv');
    const report = await run(feed.feedId);
    expect(report.feeds[0]).toMatchObject({ rows: 7, offersCreated: 7, rejected: [] });
    const cents = Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer.priceCents]));
    expect(cents).toEqual({
      'P-1': 1999,
      'P-2': 29,
      'P-3': 110,
      'P-4': 1200,
      'P-5': 1250,
      'P-6': 435,
      'P-7': 999999999,
    });
  });
});

describe('a known offer is updated, never re-matched (TD-23, TD-24)', () => {
  it('updates price and url on a second import and leaves the product text alone', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'ean-first.csv' });
    await run(feedId);
    const before = await allProducts();

    // The same shop's feed now serves different text and prices for the same ids.
    await getDb().update(feeds).set({ url: 'changed-text.csv' }).where(eq(feeds.id, feedId));
    const report = await run(feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1 });
    expect(await allProducts()).toEqual(before);
    const updated = (await allOffers()).find((offer) => offer.externalId === 'A-1');
    expect(updated).toMatchObject({ priceCents: 1125, url: 'https://shop-a.example/p/A-1-new' });
  });
});

describe('a hidden product still receives offers', () => {
  it('attaches the new offer to the hidden product and keeps it hidden', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await run(first.feedId);
    await getDb().update(products).set({ isHidden: true }).where(eq(products.slug, 'fixture-alpha-filtro'));

    const second = await insertFixtureFeed('ean-second.csv');
    await run(second.feedId);

    const [alpha] = await getDb().select().from(products).where(eq(products.slug, 'fixture-alpha-filtro'));
    expect(alpha.isHidden).toBe(true);
    expect((await allOffers()).filter((offer) => offer.productId === alpha.id)).toHaveLength(2);
    expect(await allProducts()).toHaveLength(2);
  });
});
