import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { setProductHidden } from '@/server/admin/products';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';

import {
  BAD_CELLS,
  BLANK_CELLS,
  NO_HELD,
  OIL_CELLS,
  OIL_HELD,
  OTHER_CELLS,
  apartFromAttributes,
  filterTarget,
  heldOf,
  mapFeedTo,
  oilRow,
} from '../support/attributes';
import { allOffers, allProducts, insertOffer } from '../support/catalogue';
import { sitemapProducts, withFailingProductUpdates } from '../support/categories';
import { resetDatabase } from '../support/db';
import { csvOf, gzipOf, textDeps, xmlOf } from '../support/feeds';
import { EAN, MAPPED, aFeedOf, importRows, importText, keyRow, mapFeed, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard (0006, rule 4): the file runs real imports.
vi.setConfig({ testTimeout: 30_000 });

// S15.3 (US-15.3) ACs 1 to 5, 18 to 31: the import reads the five attribute entries, counts what it could not
// read, and holds them on the product: the creating row writes (D-16), a later eligible row fills an absent
// one once through the S7.6 gate, a held one never changes. The collected wall (ACs 32 to 35) is
// collected-attributes.test.ts; the readers' forms are unit/category-attributes.test.ts; the page reader and
// the three database checks are product-page.test.ts. States the import cannot reach (a hidden product, an
// offer in review) are set by hand through `storedProduct` and `insertOffer`, as importer-ean-fill.test.ts
// does. Every shop, product, link and value is invented, and the fixtures are this file's own, not the demo.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

const KEY = { brand: 'MarcaUno', part: 'PN 100' };

type Report = Awaited<ReturnType<typeof importRows>>;
type Offer = Awaited<ReturnType<typeof allOffers>>[number];

const linesOf = (report: Report) => formatImportReport(report).split('\n');
const ATTRIBUTE_LINE = /^ {2}attributes:/;
const attributeLines = (report: Report) => linesOf(report).filter((line) => ATTRIBUTE_LINE.test(line));
/** An offer without what an import rewrites on a known offer (price, link, date, feed category): what must stay equal. */
const stable = (offer: Offer) => ({ ...offer, priceCents: 0, url: '', priceUpdatedAt: new Date(0), feedCategory: null });

/** A row of the shared key, in the mapped feed category. */
const row = (id: string, cells: Parameters<typeof oilRow>[1] = OIL_CELLS, o: Parameters<typeof oilRow>[2] = {}) =>
  oilRow(id, cells, { ...KEY, category: MAPPED, price: '10.00', ...o });

/** A feed of its own shop, its category text mapped to the engine oil, unless the test maps it elsewhere. */
async function oilFeed(name?: string, o: Parameters<typeof aFeedOf>[1] = {}) {
  const feed = await aFeedOf(name, o);
  await mapFeed(feed.feedId);
  return feed;
}

const importOne = (feed: { feedId: number }, rows: ReturnType<typeof row>[]) =>
  importRows({ [feed.feedId]: rows }, { feedId: feed.feedId });

/** The product `id` as stored now. */
async function productRow(id: number) {
  const found = (await allProducts()).find((product) => product.id === id);
  if (!found) throw new Error(`no product ${id}`);
  return found;
}

/**
 * One feed (named, so two worlds print alike) with a known offer 'x-1' on a stored product that holds no
 * attribute. `productExtra` and `offerExtra` set the one state a case is about.
 */
async function world(
  o: {
    shopApproved?: boolean;
    productExtra?: Parameters<typeof storedProduct>[0]['extra'];
    offerExtra?: Partial<typeof offers.$inferInsert>;
  } = {},
) {
  const feed = await oilFeed('Tienda Fija', { shopApproved: o.shopApproved });
  const product = await storedProduct({ slug: 'sin-atributos', ...KEY, extra: o.productExtra });
  const offerId = await insertOffer({ productId: product.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000, ...o.offerExtra });
  return { feed, product, offerId };
}

/** Imports the one feed with the row for the known offer 'x-1'. */
const importX = (feedId: number, cells: Parameters<typeof oilRow>[1] = OIL_CELLS, price = '10.00') =>
  importRows({ [feedId]: [row('x-1', cells, { price })] }, { feedId });

describe('what a feed can carry (AC 1 to 5)', () => {
  it('AC 1: a CSV row with the five entries is held on the product it creates, as the stored forms, and the page reader shows them', async () => {
    const feed = await oilFeed();

    const report = await importOne(feed, [row('o-1')]);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [], ownProducts: [] });
    const [product] = await allProducts();
    expect(heldOf(product)).toEqual(OIL_HELD);
    expect(attributeLines(report)).toEqual([]);
    expect((await getPublicProductBySlug(product.slug))?.attributes).toEqual({
      viscosity: '10W-40',
      volume: '4 l',
      acea: ['A3/B4', 'C2'],
      oilType: 'synthetic',
      approvals: ['VW 504 00', 'VW 507 00'],
    });
    // AC 40: they are in no search result and no sitemap (the listing carries the product, never a value).
    const found = await getPublicSearchPage(parseSearchTerm('Producto'), 1);
    expect(found?.state === 'results' ? found.products.map((card) => card.slug) : []).toEqual([product.slug]);
    expect(JSON.stringify(found)).not.toMatch(/10W-40|VW 504 00|A3\/B4|Sintético|volumeMl|attributes/);
    expect(await sitemapProducts()).toEqual([product.slug]);
  });

  const ROW_WITH_FIVE = {
    id: 'o-1',
    title: 'Aceite inventado',
    price: '19.99',
    url: 'https://tienda-o-1.example/p/o-1',
    brand: 'MarcaUno',
    ean: EAN.one,
    currency: 'EUR',
    ...OIL_CELLS,
  };

  it.each<[string, () => string | Uint8Array]>([
    ['an XML file', () => xmlOf([ROW_WITH_FIVE])],
    ['a gzip CSV file', () => gzipOf(csvOf([ROW_WITH_FIVE]))],
    ['a gzip XML file', () => gzipOf(xmlOf([ROW_WITH_FIVE]))],
  ])('AC 1: %s holds the same five values as the CSV, whatever the category (no category column: D-26)', async (_label, served) => {
    const feed = await aFeedOf();

    const report = await importFeeds(getDb(), { feedId: feed.feedId, deps: textDeps({ [feed.feedId]: served() }) });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, offersCreated: 1, rejected: [] });
    const [product] = await allProducts();
    expect(product.categoryId).toBeNull();
    expect(heldOf(product)).toEqual(OIL_HELD);
  });

  it('AC 2: a feed with no entry holds nothing and prints what it printed, whether it has no attribute column or five blank ones', async () => {
    const without = await aFeedOf('Tienda Alfa');
    const blank = await aFeedOf('Tienda Beta');
    const rows = [keyRow('r-1', { brand: 'Marca A', part: 'A-1' }), keyRow('r-2', { brand: 'Marca B', part: 'B-2', ean: EAN.one })];

    const reportWithout = await importRows({ [without.feedId]: rows }, { feedId: without.feedId });
    const reportBlank = await importRows(
      { [blank.feedId]: rows.map((r) => ({ ...r, ...BLANK_CELLS, brand: `${r.brand}x`, ean: '' })) },
      { feedId: blank.feedId },
    );

    expect((await allProducts()).map(heldOf)).toEqual([NO_HELD, NO_HELD, NO_HELD, NO_HELD]);
    expect(reportWithout.feeds[0]).toMatchObject({ rejected: [], productsCreated: 2, offersCreated: 2 });
    expect(reportBlank.feeds[0]).toMatchObject({ rejected: [], productsCreated: 2, offersCreated: 2 });
    const shape = (report: Report) => formatImportReport(report).replace(/feed \d+ "[^"]*"/g, 'feed');
    expect(shape(reportWithout)).toBe(shape(reportBlank));
    expect(attributeLines(reportWithout)).toEqual([]);
    expect(attributeLines(reportBlank)).toEqual([]);
  });

  it('AC 3: an entry never rejects a row, whatever it holds: a blank, an unreadable value, a value far outside its set, a very long one', async () => {
    const feed = await oilFeed();
    const outside = { viscosity: '99W-999', volume_l: '999999999999 l', acea: 'ZZZ', oil_type: '???', approvals: ';;;' };
    const long = 'x'.repeat(100_000);

    const report = await importOne(feed, [
      row('r-1', BLANK_CELLS, { brand: 'Marca 1' }),
      row('r-2', BAD_CELLS, { brand: 'Marca 2' }),
      row('r-3', outside, { brand: 'Marca 3' }),
      row('r-4', { viscosity: long, volume_l: long, acea: long, oil_type: long, approvals: long }, { brand: 'Marca 4' }),
    ]);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 4, productsCreated: 4, offersCreated: 4, rejected: [] });
    expect((await allProducts()).map(heldOf)).toEqual([NO_HELD, NO_HELD, NO_HELD, NO_HELD]);
    expect(await allOffers()).toHaveLength(4);
    expect(importExitCode(report)).toBe(0);
  });

  it('AC 4: a column that is not one of the five is never held, never printed and never rejects the row', async () => {
    const feed = await oilFeed();
    const text = [
      'id,title,price,url,brand,part_number,category,viscosity,gama,norma_api,tipo_de_envase,viscosity_grade',
      `r-1,Aceite inventado,10.00,https://tienda-r-1.example/p/r-1,${KEY.brand},${KEY.part},${MAPPED},10w40,Premium Gama Xyzzy,SN Xyzzy,Bidon Xyzzy,0W-20`,
    ].join('\n');

    const report = await importText({ [feed.feedId]: text }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, rejected: [] });
    const [product] = await allProducts();
    expect(heldOf(product)).toEqual({ ...NO_HELD, viscosity: '10W-40' });
    expect(JSON.stringify(product)).not.toMatch(/Xyzzy|Premium|0W-20/);
    expect(formatImportReport(report)).not.toMatch(/Xyzzy|gama|norma_api|tipo_de_envase|viscosity_grade/);
  });

  it('AC 5: a value is read from the entry only: a title and a description that name all five, with blank entries, hold nothing', async () => {
    const feed = await oilFeed();
    const text = [
      'id,title,price,url,brand,part_number,description,category,viscosity,volume_l,acea,oil_type,approvals',
      `r-1,Aceite sintético 5W-30 ACEA C3 4 L,10.00,https://tienda-r-1.example/p/r-1,${KEY.brand},${KEY.part},"Viscosidad 10W-40, 5 litros, ACEA A3/B4, mineral, homologación VW 504 00",${MAPPED},,,,,`,
      `r-2,Aceite sintético 5W-30,10.00,https://tienda-r-2.example/p/r-2,Marca Dos,PN 2,Aceite 10W-40 de 5 litros,${MAPPED},que no es un grado,,,,`,
    ].join('\n');

    const report = await importText({ [feed.feedId]: text }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 2, rejected: [] });
    expect((await allProducts()).map(heldOf)).toEqual([NO_HELD, NO_HELD]);
    // r-1's blank entries are not counted; r-2's unreadable viscosity is: that is the only line.
    expect(attributeLines(report)).toEqual(['  attributes: unparsed viscosity=1']);
  });

  it('AC 18: five entries that all fail hold nothing, leave no raw text in the product, the page, the output or the logs, and the product stays found', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const feed = await oilFeed();
    const planted = {
      viscosity: 'planted 5W-35 xyzzy',
      volume_l: 'planted 4 kg xyzzy',
      acea: 'planted E4 xyzzy',
      oil_type: 'planted xyzzy',
      approvals: `planted-xyzzy-${'p'.repeat(60)}`,
    };

    const report = await importOne(feed, [row('o-1', planted, { title: 'Aceite Zafiro' })]);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 1, rejected: [] });
    expect(attributeLines(report)).toEqual(['  attributes: unparsed viscosity=1 volume_l=1 acea=1 oil_type=1 approvals=1']);
    const [product] = await allProducts();
    expect(heldOf(product)).toEqual(NO_HELD);
    const page = await getPublicProductBySlug(product.slug);
    const seen = JSON.stringify([product, page, formatImportReport(report), logs.map((spy) => spy.mock.calls)]);
    expect(seen).not.toMatch(/xyzzy|planted/i);
    expect(page?.attributes).toBeNull();
    // The product keeps its category and its place in public search.
    const listing = await getPublicCategoryPage('aceite-de-motor', 1, null, 'price-asc');
    expect(listing?.products.map((card) => card.slug)).toEqual([product.slug]);
    const found = await getPublicSearchPage(parseSearchTerm('Zafiro'), 1);
    expect(found?.state === 'results' ? found.products.map((card) => card.slug) : []).toEqual([product.slug]);
  });
});

describe('what the import counts (AC 19 to 22)', () => {
  it('AC 19, 20: prints, for each attribute with an unreadable value, how many accepted rows carried one; blank and partial cells are not counted', async () => {
    const feed = await oilFeed();

    const report = await importOne(feed, [
      row('a-1', { ...OIL_CELLS, viscosity: '5W-35' }, { brand: 'Marca 1' }),
      row('a-2', { ...OIL_CELLS, volume_l: '4 kg', approvals: 'y'.repeat(61) }, { brand: 'Marca 2' }),
      row('a-3', OIL_CELLS, { brand: 'Marca 3' }),
      row('a-4', BLANK_CELLS, { brand: 'Marca 4' }),
      // Recognised in part: held, not counted. An approvals cell with one item dropped: held, not counted.
      row('a-5', { ...OIL_CELLS, acea: 'A3/B4, E4', approvals: `${'z'.repeat(61)}; VW 504 00` }, { brand: 'Marca 5' }),
    ]);

    expect(attributeLines(report)).toEqual(['  attributes: unparsed viscosity=1 volume_l=1 approvals=1']);
    const lines = linesOf(report);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('  attributes: unparsed viscosity=1 volume_l=1 approvals=1');
    expect(lines[2]).toMatch(/^total: /);
    const held = (await allProducts()).map(heldOf);
    expect(held[4]).toMatchObject({ acea: ['A3/B4'], approvals: ['VW 504 00'] });
  });

  it('AC 20: a feed whose values all read, or that carries no entry, prints the feed line and the total only, byte for byte', async () => {
    const clean = await oilFeed('Tienda Limpia');
    const none = await aFeedOf('Tienda Vacia');

    const withValues = await importOne(clean, [row('c-1'), row('c-2', OTHER_CELLS, { brand: 'Marca 2' }), row('c-3', BLANK_CELLS, { brand: 'Marca 3' })]);
    const withNone = await importRows({ [none.feedId]: [keyRow('n-1', { brand: 'Marca N', part: 'N-1' })] }, { feedId: none.feedId });

    expect(formatImportReport(withValues)).toBe(
      [
        `feed ${clean.feedId} "Tienda Limpia": imported rows=3 products_created=3 offers_created=3 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0`,
        'total: feeds=1 imported=1 skipped=0 failed=0',
      ].join('\n'),
    );
    expect(formatImportReport(withNone)).toBe(
      [
        `feed ${none.feedId} "Tienda Vacia": imported rows=1 products_created=1 offers_created=1 offers_updated=0 offers_removed=0 rejected=0 unknown_vehicles=0`,
        'total: feeds=1 imported=1 skipped=0 failed=0',
      ].join('\n'),
    );
  });

  it('AC 21: only accepted rows count: a rejected row and a repeated id never do; a known offer and a product that holds the value already do', async () => {
    const feed = await oilFeed();
    await importOne(feed, [row('r-1')]); // r-1 creates a product that holds a viscosity

    const report = await importOne(feed, [
      row('r-1', { ...OIL_CELLS, viscosity: '5W-35' }), // a known offer, on a product that already holds a viscosity: counted
      row('r-2', { ...OIL_CELLS, viscosity: '5W-35' }, { brand: 'Marca 2' }), // a new offer: counted
      row('r-3', { ...OIL_CELLS, viscosity: '5W-35' }, { brand: 'Marca 3', price: 'gratis' }), // rejected for its price: never counted
      row('r-2', { ...OIL_CELLS, viscosity: '5W-35' }, { brand: 'Marca 2' }), // the id repeated: rejected, never counted
    ]);

    expect(report.feeds[0].rejected.map((rejected) => rejected.code)).toEqual(['invalid_price', 'duplicate_id']);
    expect(attributeLines(report)).toEqual(['  attributes: unparsed viscosity=2']);
    expect(linesOf(report).map((line) => line.trim().split(' ')[0])).toEqual(['feed', 'record', 'record', 'attributes:', 'total:']);
  });

  it('AC 22: the count never changes the exit code, and importing the same files again prints the same lines', async () => {
    const feed = await oilFeed();
    const rows = [row('r-1', BAD_CELLS), row('r-2', { ...OIL_CELLS, acea: 'E7' }, { brand: 'Marca 2' })];

    const first = await importOne(feed, rows);
    const second = await importOne(feed, rows);

    expect(importExitCode(first)).toBe(0);
    expect(attributeLines(first)).toEqual(['  attributes: unparsed viscosity=1 volume_l=1 acea=2 oil_type=1 approvals=1']);
    expect(importExitCode(second)).toBe(0);
    expect(attributeLines(second)).toEqual(attributeLines(first));
    expect(second.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 2 });
  });

  it('AC 22: a run that prints the line and also has a failed feed exits 1, and the other feed still prints its line', async () => {
    const a = await oilFeed('Tienda Alfa');
    const b = await oilFeed('Tienda Beta');
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_boom() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw("create trigger fail_boom before insert on offers for each row when (new.external_id = 'boom') execute function fail_boom()"));
    let report: Report;
    try {
      report = await importRows({
        [a.feedId]: [row('a-1', BAD_CELLS)],
        [b.feedId]: [row('boom', BAD_CELLS, { brand: 'Otra', part: 'PN 9' })],
      });
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_boom on offers'));
      await db.execute(sql.raw('drop function if exists fail_boom()'));
    }

    expect(report.feeds.map((feed) => feed.outcome)).toEqual(['imported', 'failed']);
    expect(importExitCode(report)).toBe(1);
    expect(attributeLines(report)).toEqual(['  attributes: unparsed viscosity=1 volume_l=1 acea=1 oil_type=1 approvals=1']);
    expect(linesOf(report).find((line) => line.includes('failed'))).toContain('failed database_error');
  });
});

describe('a later row fills an absent attribute once (AC 23, 24, 26, 27)', () => {
  it('AC 23: a known offer fills the stored product it sits on, on an ordinary import, one stored before this story', async () => {
    const { feed, product } = await world();
    expect(heldOf(await productRow(product.id))).toEqual(NO_HELD);

    const report = await importX(feed.feedId);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, rejected: [], ownProducts: [] });
    expect(heldOf(await productRow(product.id))).toEqual(OIL_HELD);
    expect(attributeLines(report)).toEqual([]);
  });

  it('AC 23: a new offer that joins a stored product by its key fills it', async () => {
    const product = await storedProduct({ slug: 'sin-atributos', ...KEY });
    const feed = await oilFeed('Tienda Beta');

    const report = await importOne(feed, [row('b-1')]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(heldOf(await productRow(product.id))).toEqual(OIL_HELD);
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([product.id]);
  });

  it('AC 24: a row that carries nothing, a blank or an unreadable value never blocks a later one: the first that reads fills, in the same import', async () => {
    const feed = await oilFeed();

    const report = await importOne(feed, [
      row('a-1', BAD_CELLS), // creates the product; nothing read
      row('a-2', BLANK_CELLS), // joins it; nothing to give
      row('a-3', OIL_CELLS), // joins it; the first row that reads
      row('a-4', OTHER_CELLS), // joins it; too late
    ]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 4, rejected: [] });
    expect(heldOf((await allProducts())[0])).toEqual(OIL_HELD);
  });

  it('AC 24: and across two imports: the first gives nothing, the second (a known offer now carrying the entry) fills', async () => {
    const feed = await oilFeed();
    await importOne(feed, [row('a-1', BLANK_CELLS)]);
    await importOne(feed, [row('a-1', BAD_CELLS)]);
    expect(heldOf((await allProducts())[0])).toEqual(NO_HELD);

    await importOne(feed, [row('a-1', OIL_CELLS)]);

    expect(heldOf((await allProducts())[0])).toEqual(OIL_HELD);
  });

  it('AC 26: attributes fill one by one: a product that holds a viscosity and no volume takes the volume of a later row, and the viscosity stays', async () => {
    const a = await oilFeed('Tienda Alfa');
    const b = await oilFeed('Tienda Beta');
    await importOne(a, [row('a-1', { viscosity: '0W-20' })]);
    expect(heldOf((await allProducts())[0])).toEqual({ ...NO_HELD, viscosity: '0W-20' });

    await importOne(b, [row('b-1', { ...OIL_CELLS, viscosity: '5W-30' })]);

    expect(heldOf((await allProducts())[0])).toEqual({ ...OIL_HELD, viscosity: '0W-20' });
  });

  it('AC 27: a set fills as a whole: a held ACEA set or approvals list never gains, loses or reorders an item', async () => {
    const a = await oilFeed('Tienda Alfa');
    const b = await oilFeed('Tienda Beta');
    await importOne(a, [row('a-1', { acea: 'A3/B4', approvals: 'VW 504 00; MB 229.51' })]);

    await importOne(b, [row('b-1', { acea: 'A3/B4, C2, C3', approvals: 'MB 229.51; VW 504 00; VW 507 00; BMW LL-04' })]);
    expect(heldOf((await allProducts())[0])).toEqual({ ...NO_HELD, acea: ['A3/B4'], approvals: ['VW 504 00', 'MB 229.51'] });

    // A shorter set from another row leaves the held, longer one as it is.
    await importOne(b, [row('b-1', { acea: 'C2' }), row('b-2', { approvals: 'VW 507 00' })]);
    expect(heldOf((await allProducts())[0])).toEqual({ ...NO_HELD, acea: ['A3/B4'], approvals: ['VW 504 00', 'MB 229.51'] });
  });
});

describe('a held attribute is never changed or cleared (AC 25)', () => {
  it('AC 25: not by a row with another value, the same, a blank, an unreadable value or another feed, nor by hide and unhide, a disabled feed and shop, or the removal of its offer', async () => {
    const a = await oilFeed('Tienda Alfa');
    const b = await oilFeed('Tienda Beta');
    await importOne(a, [row('a-1')]);
    const [product] = await allProducts();
    const stays = async (stage: string) => expect(heldOf(await productRow(product.id)), stage).toEqual(OIL_HELD);

    const stages: [string, () => Promise<unknown>][] = [
      ['another value', () => importOne(a, [row('a-1', OTHER_CELLS)])],
      ['the same value', () => importOne(a, [row('a-1', OIL_CELLS)])],
      ['a blank', () => importOne(a, [row('a-1', BLANK_CELLS)])],
      ['an unreadable value', () => importOne(a, [row('a-1', BAD_CELLS)])],
      ['a row of another feed', () => importOne(b, [row('b-1', OTHER_CELLS)])],
      ['hide and unhide', async () => {
        await setProductHidden(product.id, true);
        await setProductHidden(product.id, false);
      }],
      ['the feed and the shop disabled', async () => {
        await getDb().update(feeds).set({ isApproved: false });
        await getDb().update(shops).set({ isApproved: false });
        await importFeeds(getDb(), { deps: textDeps({}) }); // every feed is disabled: nothing is read
        await getDb().update(feeds).set({ isApproved: true });
        await getDb().update(shops).set({ isApproved: true });
      }],
      ['the removal of its offer by an import that no longer lists it', async () => {
        const report = await importOne(a, [row('a-9', BLANK_CELLS, { brand: 'Marca 9' })]);
        expect(report.feeds[0].offersRemoved).toBe(1);
      }],
    ];
    for (const [stage, run] of stages) {
      await run();
      await stays(stage);
    }
  });
});

describe('the category order (AC 28; D-26: stored by the entry, shown only in the engine oil)', () => {
  it('AC 28: a category mapped before the first import: the first import is enough, and the page shows the attributes', async () => {
    const feed = await oilFeed();

    await importOne(feed, [row('o-1')]);

    const [product] = await allProducts();
    expect(product.categoryId).not.toBeNull();
    expect((await getPublicProductBySlug(product.slug))?.attributes).toMatchObject({ viscosity: '10W-40', volume: '4 l' });
  });

  it('AC 28: a category mapped between two imports: the creating row already held the attributes, the second import sets the category, and nothing else is needed', async () => {
    const feed = await aFeedOf();
    await importOne(feed, [row('o-1')]);
    const [created] = await allProducts();
    expect(created.categoryId).toBeNull();
    expect(heldOf(created)).toEqual(OIL_HELD);
    expect(await getPublicProductBySlug(created.slug)).toBeNull();

    await mapFeed(feed.feedId);
    await importOne(feed, [row('o-1')]);

    const [after] = await allProducts();
    expect(after.categoryId).not.toBeNull();
    expect(heldOf(after)).toEqual(OIL_HELD);
    expect((await getPublicProductBySlug(after.slug))?.attributes).toMatchObject({ acea: ['A3/B4', 'C2'], oilType: 'synthetic' });
  });

  it('AC 28, 39: a product in another category stores the attributes and shows none; a product in no category is not public at all', async () => {
    const feed = await aFeedOf();
    await mapFeedTo(feed.feedId, await filterTarget());
    const other = await aFeedOf('Tienda Sin Categoria');

    await importOne(feed, [row('f-1', OIL_CELLS, { brand: 'Filtro Marca' })]);
    await importOne(other, [row('n-1', OIL_CELLS, { brand: 'Sin Categoria', category: 'Texto sin mapear' })]);

    const [inFilters, inNone] = await allProducts();
    expect(heldOf(inFilters)).toEqual(OIL_HELD);
    expect(heldOf(inNone)).toEqual(OIL_HELD);
    expect(inFilters.categoryId).not.toBeNull();
    expect(inNone.categoryId).toBeNull();
    expect((await getPublicProductBySlug(inFilters.slug))?.attributes).toBeNull();
    expect(await getPublicProductBySlug(inNone.slug)).toBeNull();
  });
});

describe('a fill changes nothing but the attributes (AC 29)', () => {
  const snapshot = async () => ({
    shops: await getDb().select().from(shops).orderBy(shops.id),
    feeds: await getDb().select().from(feeds).orderBy(feeds.id),
    offers: (await allOffers()).map(stable),
    products: (await allProducts()).map(apartFromAttributes),
  });

  it.each(['a known offer', 'a new offer that joins'] as const)('AC 29: %s leaves every column of the product but the five attribute columns, and every shop, feed and offer flag, as it was', async (how) => {
    const feed = await oilFeed('Tienda Fija');
    const product = await storedProduct({
      slug: 'sin-atributos',
      ...KEY,
      ean: EAN.one,
      extra: { title: 'Titulo fijo', description: 'Texto fijo', isHidden: false },
    });
    if (how === 'a known offer') {
      await insertOffer({ productId: product.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000 });
    }
    const before = await snapshot();
    const productBefore = await productRow(product.id);

    const report = await importOne(feed, [row(how === 'a known offer' ? 'x-1' : 'b-1', OIL_CELLS, { title: 'Otro titulo', ean: EAN.one })]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, rejected: [], ownProducts: [] });
    const productAfter = await productRow(product.id);
    expect(heldOf(productAfter)).toEqual(OIL_HELD);
    expect(apartFromAttributes(productAfter)).toEqual(apartFromAttributes(productBefore));
    const after = await snapshot();
    expect(after.shops).toEqual(before.shops);
    expect(after.feeds).toEqual(before.feeds);
    expect(after.products).toEqual(before.products);
    // The row's own offer is written as today: a known offer is updated in place, a new one is added to the product.
    if (how === 'a known offer') expect(after.offers).toEqual(before.offers);
    else expect(after.offers.slice(0, before.offers.length)).toEqual(before.offers);
    expect((await allOffers()).every((offer) => offer.productId === product.id)).toBe(true);
  });

  it('AC 29: a steady-state import writes no product row at all: with every update of products refused, a re-import of rows the products already hold still imports', async () => {
    const feed = await oilFeed();
    await importOne(feed, [row('o-1'), row('o-2', OTHER_CELLS, { brand: 'Marca 2' })]);

    const report = await withFailingProductUpdates(() => importOne(feed, [row('o-1'), row('o-2', OTHER_CELLS, { brand: 'Marca 2' })]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersUpdated: 2, productsCreated: 0 });
  });

  it('AC 29: and the refusal bites a fill, so the check above is not vacuous: a row that would fill fails the feed', async () => {
    const { feed } = await world();

    const report = await withFailingProductUpdates(() => importX(feed.feedId));

    expect(report.feeds[0].outcome).toBe('failed');
  });
});

describe('the approval and hide gate for a later fill (AC 30, guardrail 1)', () => {
  const CONDITIONS: [string, Parameters<typeof world>[0], (ids: { shopId: number; productId: number; offerId: number }) => Promise<unknown>][] = [
    ['its shop is not approved', { shopApproved: false }, ({ shopId }) => getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, shopId))],
    ['its offer is hidden', { offerExtra: { isHidden: true } }, ({ offerId }) => getDb().update(offers).set({ isHidden: false }).where(eq(offers.id, offerId))],
    ['its offer is in review', { offerExtra: { inReview: true } }, ({ offerId }) => getDb().update(offers).set({ inReview: false }).where(eq(offers.id, offerId))],
    ['its product is hidden', { productExtra: { isHidden: true } }, ({ productId }) => getDb().update(products).set({ isHidden: false }).where(eq(products.id, productId))],
  ];

  it.each(CONDITIONS)('AC 30: a known offer fills nothing while %s, and is updated as today; the next import after the condition clears fills, and the clearing wrote nothing', async (_label, setup, clear) => {
    const { feed, product, offerId } = await world(setup);
    const offersBefore = await allOffers();

    const first = await importX(feed.feedId, OIL_CELLS, '9.00');

    expect(first.feeds[0]).toMatchObject({ outcome: 'imported', offersUpdated: 1, rejected: [] });
    expect(heldOf(await productRow(product.id))).toEqual(NO_HELD);
    const offersAfter = await allOffers();
    expect(offersAfter.map((offer) => offer.priceCents)).toEqual([900]);
    expect(offersAfter.map(stable)).toEqual(offersBefore.map(stable));

    await clear({ shopId: feed.shopId, productId: product.id, offerId });
    expect(heldOf(await productRow(product.id))).toEqual(NO_HELD); // an unhide, like an approval, publishes and writes nothing by itself
    await importX(feed.feedId, OIL_CELLS, '9.00');

    expect(heldOf(await productRow(product.id))).toEqual(OIL_HELD);
  });

  it.each<[string, { shopApproved?: boolean }, { isHidden?: boolean }]>([
    ['its shop is not approved', { shopApproved: false }, {}],
    ['the product it joins is hidden', {}, { isHidden: true }],
  ])('AC 30: a new row fills nothing when %s, and it still joins as an offer', async (_label, shop, productExtra) => {
    const product = await storedProduct({ slug: 'sin-atributos', ...KEY, extra: productExtra });
    const feed = await oilFeed('Tienda Beta', shop);
    const before = await productRow(product.id);

    const report = await importOne(feed, [row('b-1')]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [] });
    expect(await productRow(product.id)).toEqual(before);
    expect((await allOffers()).map((offer) => offer.productId)).toEqual([product.id]);
  });

  it('AC 30: a known offer of a feed that is not approved is skipped: nothing is filled', async () => {
    const feed = await oilFeed('Tienda Fija', { feedApproved: false });
    const product = await storedProduct({ slug: 'sin-atributos', ...KEY });
    await insertOffer({ productId: product.id, feedId: feed.feedId, externalId: 'x-1', priceCents: 1000 });
    const before = await productRow(product.id);

    const report = await importX(feed.feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'skipped' });
    expect(await productRow(product.id)).toEqual(before);
    expect(attributeLines(report)).toEqual([]);
  });

  it('AC 30 (D-16): the row that creates a product writes the attributes it reads whatever its shop\'s approval, and the first value then stays; the product is public only after the shop is approved', async () => {
    const feed = await oilFeed('Tienda Nueva', { shopApproved: false });

    const first = await importOne(feed, [row('o-1')]);

    expect(first.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 1 });
    const [created] = await allProducts();
    expect(heldOf(created)).toEqual(OIL_HELD);
    expect(await getPublicProductBySlug(created.slug)).toBeNull();

    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, feed.shopId));
    await importOne(feed, [row('o-1', OTHER_CELLS)]);

    expect(heldOf(await productRow(created.id))).toEqual(OIL_HELD);
    expect((await getPublicProductBySlug(created.slug))?.attributes).toMatchObject({ viscosity: '10W-40' });
  });

  it('AC 31: a hidden product that holds attributes has no public page and no attribute on any public surface', async () => {
    const feed = await oilFeed();
    await importOne(feed, [row('o-1', OIL_CELLS, { title: 'Aceite oculto' })]);
    const [product] = await allProducts();
    expect((await getPublicProductBySlug(product.slug))?.attributes).not.toBeNull();

    await setProductHidden(product.id, true);

    expect(heldOf(await productRow(product.id))).toEqual(OIL_HELD);
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
    const listing = await getPublicCategoryPage('aceite-de-motor', 1, null, 'price-asc');
    expect(JSON.stringify(listing)).not.toContain('10W-40');
    const found = await getPublicSearchPage(parseSearchTerm('Aceite oculto'), 1);
    expect(found).toMatchObject({ state: 'no-results' });
  });

  it('AC 31: a product whose only offers come from an unapproved shop holds the attributes and shows none', async () => {
    const feed = await oilFeed('Tienda Sin Aprobar', { shopApproved: false });
    await importOne(feed, [row('o-1', OIL_CELLS, { title: 'Aceite Pendiente' })]);
    const [product] = await allProducts();

    expect(heldOf(product)).toEqual(OIL_HELD);
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
    expect(await getPublicSearchPage(parseSearchTerm('Pendiente'), 1)).toMatchObject({ state: 'no-results' });
    expect(JSON.stringify(await getPublicCategoryPage('aceite-de-motor', 1, null, 'price-asc'))).not.toContain('10W-40');
  });
});

describe('matching is unchanged by an attribute (AC 44)', () => {
  it('AC 44: two rows of one key with different attributes are one product, and an attribute is no part of the key', async () => {
    const feed = await oilFeed();

    const report = await importOne(feed, [row('a-1', OIL_CELLS), row('a-2', OTHER_CELLS)]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 2, ownProducts: [], rejected: [] });
    expect(await allProducts()).toHaveLength(1);
  });

  it('AC 44: two rows of different keys with the same attributes stay two products, and no own_product line is printed', async () => {
    const feed = await oilFeed();

    const report = await importOne(feed, [row('a-1', OIL_CELLS, { brand: 'Marca 1' }), row('a-2', OIL_CELLS, { brand: 'Marca 2' })]);

    expect(report.feeds[0]).toMatchObject({ productsCreated: 2, ownProducts: [] });
    expect(linesOf(report).some((line) => line.includes('own_product'))).toBe(false);
  });
});
