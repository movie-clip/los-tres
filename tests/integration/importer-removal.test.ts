import { readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { setOfferHidden, setProductHidden } from '@/server/admin/products';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { readFitStates, readProductFitState, readProductVehicles } from '@/server/catalogue/fit-state';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { SourceError } from '@/server/importer/source';
import type { FeedBytes, FeedFailure, ImportReport } from '@/server/importer/types';

import {
  allOffers,
  allProducts,
  insertFeed,
  insertOffer,
  insertProduct,
  insertShop,
  vehicleIdBySlug,
} from '../support/catalogue';
import { aFileFeed, catalogueCsv, importFromFolder, tempCatalogueFolder } from '../support/catalogue-files';
import { sitemapProducts } from '../support/categories';
import { resetDatabase } from '../support/db';
import { bytesOf, csvOf, gzipOf, textDeps } from '../support/feeds';
import { allClicks, callGo } from '../support/go';
import { allRows } from '../support/hide';
import { EAN, MAPPED, aFeedOf, importRows, keyRow, mapFeed } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S3.3 (T3.3.2): the removal pass of the importer. An offer of a feed that an import no longer lists is
// flagged `is_removed` and leaves every public surface; one that is listed again comes back. The guard
// skips a pass that looks like a broken file, and `allowLargeRemoval` lifts only its small-import half.
// Assertions are on flags, public reads and printed lines, never on how the pass is written.
// Every shop, product, file and link is invented; no network (stubNetworkOff) and no repo folder is read.

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

/** ['r1', ..., 'rN']: the external ids of a plain feed. */
const range = (count: number, prefix = 'r'): string[] => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

/** One mapped row per id; every row is its own product (no brand, part number or EAN). */
const listing = (ids: string[], o: { price?: string } = {}) =>
  ids.map((id) => keyRow(id, { category: MAPPED, price: o.price }));

type Feed = Awaited<ReturnType<typeof aFeedOf>> & { category: { id: number; slug: string } };

/** A shop with one approved feed that has imported `ids` (default r1..rN), its category mapped so every offer is public. */
async function seeded(count: number, o: { shopName?: string; ids?: string[] } = {}): Promise<Feed> {
  const feed = await aFeedOf(o.shopName ?? 'Tienda Retirada');
  const category = await mapFeed(feed.feedId);
  const report = await importRows({ [feed.feedId]: listing(o.ids ?? range(count)) }, { feedId: feed.feedId });
  expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: (o.ids ?? range(count)).length });
  return { ...feed, category };
}

/** Imports `ids` again into one feed. */
const reimport = (feed: { feedId: number }, ids: string[], o: { price?: string } = {}) =>
  importRows({ [feed.feedId]: listing(ids, o) }, { feedId: feed.feedId });

/** The feed's offers by external id. */
async function offersOf(feedId: number) {
  const rows = await getDb().select().from(offers).where(eq(offers.feedId, feedId)).orderBy(asc(offers.id));
  return Object.fromEntries(rows.map((row) => [row.externalId, row]));
}

type OffersById = Awaited<ReturnType<typeof offersOf>>;
const removedOf = (byId: OffersById): string[] =>
  Object.entries(byId)
    .filter(([, offer]) => offer.isRemoved)
    .map(([id]) => id)
    .sort();
const sorted = (ids: string[]): string[] => [...ids].sort();

const linesOf = (report: ImportReport): string[] => formatImportReport(report).split('\n');
const removalLines = (report: ImportReport): string[] => linesOf(report).filter((line) => line.includes('removal:'));

async function productOfOffer(offerId: number) {
  const [row] = await getDb()
    .select({ id: products.id, slug: products.slug, isHidden: products.isHidden, categoryId: products.categoryId })
    .from(offers)
    .innerJoin(products, eq(offers.productId, products.id))
    .where(eq(offers.id, offerId));
  return row;
}

/** What the public readers say about one product and its category right now. */
async function surface(slug: string, categorySlug: string) {
  const page = await getPublicProductBySlug(slug);
  const listingPage = await getPublicCategoryPage(categorySlug, 1, null, 'price-asc');
  return {
    pageOffers: page?.offers.map((offer) => offer.offerId) ?? null,
    pagePrices: page?.offers.map((offer) => offer.priceCents) ?? null,
    inCategory: listingPage?.products.some((card) => card.slug === slug) ?? false,
    categoryCount: listingPage?.productCount ?? null,
    inSitemap: (await sitemapProducts()).includes(slug),
  };
}

describe('the column (AC 1)', () => {
  it('is boolean, not null, defaults to false, and a plain insert reads false', async () => {
    const result = await getDb().execute<{ data_type: string; is_nullable: string; column_default: string }>(
      sql`select data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'offers' and column_name = 'is_removed'`,
    );
    expect(result.rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);

    const shop = await insertShop();
    const product = await insertProduct();
    const id = await insertOffer({ productId: product.id, feedId: await insertFeed(shop.id) });
    expect((await allOffers()).find((offer) => offer.id === id)?.isRemoved).toBe(false);
  });

  it('is added by one migration statement and nothing else', () => {
    const file = path.resolve(process.cwd(), 'src/db/migrations/0009_offer_removed.sql');
    const statements = readFileSync(file, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toEqual(['ALTER TABLE "offers" ADD COLUMN "is_removed" boolean DEFAULT false NOT NULL;']);
  });
});

describe('an import flags the offers its file no longer lists (AC 3)', () => {
  it('flags exactly the missing offers, clears the listed ones, and says how many in the report and on the line', async () => {
    const feed = await seeded(10);

    const report = await reimport(feed, range(6));

    const byId = await offersOf(feed.feedId);
    expect(removedOf(byId)).toEqual(sorted(['r7', 'r8', 'r9', 'r10']));
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 4, offersUpdated: 6, offersCreated: 0 });
    expect(report.feeds[0].removalSkipped).toBeUndefined();
    expect(linesOf(report)[0]).toContain(' offers_updated=6 offers_removed=4 rejected=0 ');
    expect(removalLines(report)).toEqual([]);
    expect(importExitCode(report)).toBe(0);
  });

  it('deletes no offer and no product: a removed offer keeps its row, its id and its product', async () => {
    const feed = await seeded(10);
    const before = { offers: await offersOf(feed.feedId), products: await allProducts() };

    await reimport(feed, range(6));

    const after = await offersOf(feed.feedId);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before.offers).sort());
    for (const id of range(10)) {
      expect(after[id].id).toBe(before.offers[id].id);
      expect(after[id].productId).toBe(before.offers[id].productId);
    }
    expect((await allProducts()).map((row) => row.id)).toEqual(before.products.map((row) => row.id));
  });

  it('takes a removed offer off the public readers and leaves the listed ones on them', async () => {
    const feed = await seeded(10);
    const dropped = (await offersOf(feed.feedId)).r10;
    const kept = (await offersOf(feed.feedId)).r1;
    const droppedProduct = await productOfOffer(dropped.id);
    const keptProduct = await productOfOffer(kept.id);

    await reimport(feed, range(9));

    expect(await surface(droppedProduct.slug, feed.category.slug)).toMatchObject({
      pageOffers: null,
      inCategory: false,
      inSitemap: false,
      categoryCount: 9,
    });
    expect(await surface(keptProduct.slug, feed.category.slug)).toMatchObject({ pageOffers: [kept.id], inCategory: true, inSitemap: true });
    expect((await callGo(dropped.id)).status).toBe(404);
    expect((await callGo(kept.id)).status).toBe(302);
    expect(await allClicks()).toHaveLength(1);
  });

  it('prices a surviving offer from the new file in the same run that removes another', async () => {
    const feed = await seeded(10);

    await reimport(feed, range(6), { price: '7.25' });

    const byId = await offersOf(feed.feedId);
    expect(byId.r1.priceCents).toBe(725);
    expect(byId.r10.isRemoved).toBe(true);
  });
});

describe('an import changes only its own feed (AC 4)', () => {
  it('leaves every offer of another feed of the same shop, of another shop and on the same product as it was', async () => {
    // F1 and F2 belong to one shop, F3 to another; a1, b1 and c1 are one product through a shared EAN.
    const shopOne = await insertShop({ name: 'Tienda Uno' });
    const f1 = await insertFeed(shopOne.id);
    const f2 = await insertFeed(shopOne.id);
    const f3 = (await aFeedOf('Tienda Tres')).feedId;
    for (const feedId of [f1, f2, f3]) await mapFeed(feedId);
    const row = (id: string, ean = '') => keyRow(id, { category: MAPPED, ean: ean || undefined });
    await importRows({
      [f1]: [row('a1', EAN.one), row('a2'), row('a3')],
      [f2]: [row('b1', EAN.one), row('b2')],
      [f3]: [row('c1', EAN.one), row('c2')],
    });
    const before = await allRows();
    expect(new Set(before.offers.filter((offer) => ['a1', 'b1', 'c1'].includes(offer.externalId)).map((o) => o.productId)).size).toBe(1);

    const report = await importRows({ [f1]: [row('a2'), row('a3')] }, { feedId: f1 });

    expect(report.feeds[0]).toMatchObject({ offersRemoved: 1 });
    const after = await allRows();
    expect(after.offers.filter((offer) => offer.feedId !== f1)).toEqual(before.offers.filter((offer) => offer.feedId !== f1));
    expect(after.products).toEqual(before.products);
    expect(after.feeds).toEqual(before.feeds);
    expect(after.shops).toEqual(before.shops);
    expect(removedOf(await offersOf(f1))).toEqual(['a1']);
  });

  it('a run over every approved feed removes only from the feed whose file dropped the offer', async () => {
    const one = await seeded(4, { shopName: 'Tienda Uno', ids: range(4, 'u') });
    const two = await seeded(4, { shopName: 'Tienda Dos', ids: range(4, 'd') });

    const report = await importRows({
      [one.feedId]: listing(['u1', 'u2', 'u3']),
      [two.feedId]: listing(range(4, 'd')),
    });

    expect(report.feeds.map((feed) => feed.offersRemoved)).toEqual([1, 0]);
    expect(removedOf(await offersOf(one.feedId))).toEqual(['u4']);
    expect(removedOf(await offersOf(two.feedId))).toEqual([]);
  });
});

describe('two shops on one product (AC 5, 6)', () => {
  async function twoShops() {
    const a = await aFeedOf('Tienda A');
    const b = await aFeedOf('Tienda B');
    const category = await mapFeed(a.feedId);
    await mapFeed(b.feedId);
    const aRows = (withShared: boolean) => [
      ...(withShared ? [keyRow('a-1', { category: MAPPED, ean: EAN.one, price: '10.00' })] : []),
      keyRow('a-2', { category: MAPPED }),
    ];
    const bRows = (withShared: boolean) => [
      ...(withShared ? [keyRow('b-1', { category: MAPPED, ean: EAN.one, price: '12.00' })] : []),
      keyRow('b-2', { category: MAPPED }),
    ];
    await importRows({ [a.feedId]: aRows(true), [b.feedId]: bRows(true) });
    const offerA = (await offersOf(a.feedId))['a-1'];
    const offerB = (await offersOf(b.feedId))['b-1'];
    const product = await productOfOffer(offerA.id);
    expect(offerB.productId).toBe(offerA.productId);
    return { a, b, category, aRows, bRows, offerA, offerB, product };
  }

  it('keeps the product public with the other shop\'s offer when one shop drops its offer', async () => {
    const w = await twoShops();
    expect(await surface(w.product.slug, w.category.slug)).toMatchObject({ pageOffers: [w.offerA.id, w.offerB.id] });

    await importRows({ [w.a.feedId]: w.aRows(false) }, { feedId: w.a.feedId });

    expect((await offersOf(w.a.feedId))['a-1'].isRemoved).toBe(true);
    expect((await offersOf(w.b.feedId))['b-1'].isRemoved).toBe(false);
    expect(await surface(w.product.slug, w.category.slug)).toMatchObject({
      pageOffers: [w.offerB.id],
      pagePrices: [1200],
      inCategory: true,
      inSitemap: true,
    });
    expect((await callGo(w.offerA.id)).status).toBe(404);
    expect((await callGo(w.offerB.id)).status).toBe(302);
  });

  it('takes the product off every surface when its last public offer is removed, and leaves the product row as it was', async () => {
    const w = await twoShops();
    await importRows({ [w.a.feedId]: w.aRows(false) }, { feedId: w.a.feedId });
    const before = await allProducts();

    await importRows({ [w.b.feedId]: w.bRows(false) }, { feedId: w.b.feedId });

    expect(await surface(w.product.slug, w.category.slug)).toMatchObject({
      pageOffers: null,
      inCategory: false,
      inSitemap: false,
    });
    expect((await callGo(w.offerA.id)).status).toBe(404);
    expect((await callGo(w.offerB.id)).status).toBe(404);
    // Neither the hidden flag nor the category nor any other product column moved.
    expect(await allProducts()).toEqual(before);
    const stored = (await allProducts()).find((row) => row.id === w.product.id);
    expect(stored).toMatchObject({ isHidden: false });
    expect(stored?.categoryId).toBe(w.category.id);
  });

  it('puts the product back on the surfaces when a shop lists its offer again', async () => {
    const w = await twoShops();
    await importRows({ [w.a.feedId]: w.aRows(false) }, { feedId: w.a.feedId });
    await importRows({ [w.b.feedId]: w.bRows(false) }, { feedId: w.b.feedId });

    await importRows({ [w.b.feedId]: w.bRows(true) }, { feedId: w.b.feedId });

    expect(await surface(w.product.slug, w.category.slug)).toMatchObject({
      pageOffers: [w.offerB.id],
      pagePrices: [1200],
      inCategory: true,
      inSitemap: true,
    });
    expect((await callGo(w.offerB.id)).status).toBe(302);
    expect((await callGo(w.offerA.id)).status).toBe(404);
  });
});

describe('what counts as listed in the file (AC 7)', () => {
  it('removes the offer of a row that fails validation, keeps a duplicate_id row\'s offer at the first row\'s values, and lets a missing_id row change nothing', async () => {
    const feed = await seeded(10);
    const before = await offersOf(feed.feedId);

    const report = await importRows(
      {
        [feed.feedId]: [
          ...listing(range(6)),
          keyRow('r7', { category: MAPPED, price: 'abc' }),
          keyRow('r1', { category: MAPPED, price: '99.00' }),
          keyRow('', { category: MAPPED, title: 'Sin identificador' }),
        ],
      },
      { feedId: feed.feedId },
    );

    const after = await offersOf(feed.feedId);
    expect(report.feeds[0].rejected.map((row) => [row.record, row.code])).toEqual([
      [8, 'invalid_price'],
      [9, 'duplicate_id'],
      [10, 'missing_id'],
    ]);
    // r7 failed validation and r8 to r10 are absent: all four are removed; r1 is kept at its first row's price.
    expect(removedOf(after)).toEqual(sorted(['r7', 'r8', 'r9', 'r10']));
    expect(after.r1.priceCents).toBe(1000);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(linesOf(report)).toContain('  record 8: invalid_price (price)');
    expect(report.feeds[0]).toMatchObject({ offersRemoved: 4 });
  });

  it('brings a failed row\'s offer back on the next import that lists it correctly', async () => {
    const feed = await seeded(10);
    await importRows(
      { [feed.feedId]: [...listing(range(9)), keyRow('r10', { category: MAPPED, price: 'abc' })] },
      { feedId: feed.feedId },
    );
    expect((await offersOf(feed.feedId)).r10.isRemoved).toBe(true);

    await reimport(feed, range(10));

    expect((await offersOf(feed.feedId)).r10.isRemoved).toBe(false);
  });

  it('counts rejected rows as missing for the guard: a file that breaks most of its rows removes nothing', async () => {
    const feed = await seeded(20);
    const good = listing(range(5));
    const broken = range(15).map((_, i) => keyRow(`r${i + 6}`, { category: MAPPED, price: 'abc' }));

    const report = await importRows({ [feed.feedId]: [...good, ...broken] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 0 });
    expect(report.feeds[0].rejected).toHaveLength(15);
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    expect(removalLines(report)).toEqual(['  removal: skipped small_import missing=15 current=20']);
  });
});

describe('a failed feed removes nothing (AC 8)', () => {
  const failedLine = (report: ImportReport, code: FeedFailure, shop = 'Tienda Fallida') =>
    expect(formatImportReport(report)).toBe(
      `feed ${report.feeds[0].feedId} "${shop}": failed ${code}\ntotal: feeds=1 imported=0 skipped=0 failed=1`,
    );

  const rowsOf = (ids: string[], price = '5.00') =>
    ids.map((id) => ({ id, title: `Producto ${id}`, price, url: `https://tienda-${id}.example/p/${id}` }));

  type Served = string | Uint8Array | Error;
  const FAILURES: { name: string; code: FeedFailure; served: () => Served }[] = [
    { name: 'the source cannot be read', code: 'fetch_failed', served: () => new Error('connection refused') },
    { name: 'the source refuses a redirect', code: 'redirect_refused', served: () => new SourceError('redirect_refused') },
    { name: 'the header has no usable column', code: 'invalid_header', served: () => 'title,brand\nx,y\n' },
    {
      name: 'the XML breaks after good records',
      code: 'invalid_xml',
      served: () => `<?xml version="1.0"?>\n<products>${rowsOf(range(2))
        .map((r) => `<product><id>${r.id}</id><title>${r.title}</title><price>${r.price}</price><url>${r.url}</url></product>`)
        .join('')}<product><id>X</id><title>cut`,
    },
    {
      name: 'the gzip is cut off after good records',
      code: 'invalid_gzip',
      served: () => {
        const whole = gzipOf(csvOf(rowsOf(range(400))));
        return whole.subarray(0, whole.byteLength - 30);
      },
    },
  ];

  it.each(FAILURES)('changes no offer and prints the unchanged failed line when $name', async ({ code, served }) => {
    const feed = await seeded(10, { shopName: 'Tienda Fallida' });
    const before = await allRows();

    const report = await importFeeds(getDb(), { feedId: feed.feedId, deps: textDeps({ [feed.feedId]: served() }) });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: code, offersRemoved: 0 });
    failedLine(report, code);
    expect(importExitCode(report)).toBe(1);
    expect(await allRows()).toEqual(before);
  });

  it('changes no offer when the byte source throws too_large after good records', async () => {
    const feed = await seeded(10, { shopName: 'Tienda Fallida' });
    const before = await allRows();
    const text = csvOf(rowsOf(range(2), '3.00'));

    const report = await importFeeds(getDb(), {
      feedId: feed.feedId,
      deps: {
        readSource: async () => {
          async function* capped(): FeedBytes {
            yield* bytesOf(text);
            throw new SourceError('too_large');
          }
          return capped();
        },
      },
    });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'too_large' });
    failedLine(report, 'too_large');
    expect(await allRows()).toEqual(before);
  });

  it('rolls back the whole import, prices included, when the database refuses the removal itself', async () => {
    const feed = await seeded(10, { shopName: 'Tienda Fallida' });
    const before = await allRows();
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_removal() returns trigger language plpgsql as $$ begin raise exception 'boom' using errcode = 'P0001'; end $$"),
    );
    await db.execute(
      sql.raw('create trigger fail_removal before update on offers for each row when (new.is_removed and not old.is_removed) execute function fail_removal()'),
    );
    let report: ImportReport;
    try {
      report = await reimport(feed, range(6), { price: '3.33' });
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_removal on offers'));
      await db.execute(sql.raw('drop function if exists fail_removal()'));
    }

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'database_error' });
    failedLine(report, 'database_error');
    expect(importExitCode(report)).toBe(1);
    // The prices the same run had already written are gone with it.
    expect(await allRows()).toEqual(before);
  });

  it('changes no offer when a catalogue file is gone', async () => {
    const folder = await tempCatalogueFolder();
    try {
      await writeFile(path.join(folder.dir, 'tienda.csv'), catalogueCsv(listing(range(10))));
      const file = await aFileFeed('tienda.csv', { shopName: 'Tienda Archivo' });
      await mapFeed(file.feedId);
      await importFromFolder(folder.dir);
      const before = await allRows();
      await rm(path.join(folder.dir, 'tienda.csv'));

      const report = await importFromFolder(folder.dir, { feedId: file.feedId });

      expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found', offersRemoved: 0 });
      expect(formatImportReport(report)).toBe(
        `feed ${file.feedId} "Tienda Archivo": failed file_not_found\ntotal: feeds=1 imported=0 skipped=0 failed=1`,
      );
      expect(await allRows()).toEqual(before);
    } finally {
      await folder.remove();
    }
  });
});

describe('the guard: an import with nothing accepted (AC 9)', () => {
  it('removes nothing, says why on one indented line, shows offers_removed=0, and still exits 0', async () => {
    const feed = await seeded(3);

    const report = await importRows({ [feed.feedId]: [] }, { feedId: feed.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 0 });
    expect(report.feeds[0].removalSkipped).toEqual({ reason: 'empty_import', missing: 3, current: 3 });
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    expect(linesOf(report)[0]).toContain(' offers_removed=0 ');
    expect(removalLines(report)).toEqual(['  removal: skipped empty_import missing=3 current=3']);
    expect(importExitCode(report)).toBe(0);
  });

  it('also skips when every row of the file is rejected', async () => {
    const feed = await seeded(5);
    const allBroken = range(5).map((id) => keyRow(id, { category: MAPPED, price: 'abc' }));

    const report = await importRows({ [feed.feedId]: allBroken }, { feedId: feed.feedId });

    expect(report.feeds[0].rejected).toHaveLength(5);
    expect(removalLines(report)).toEqual(['  removal: skipped empty_import missing=5 current=5']);
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
  });

  it('skips for any size of feed, even one below the small-import minimum', async () => {
    const feed = await seeded(1);
    const report = await importRows({ [feed.feedId]: [] }, { feedId: feed.feedId });
    expect(removalLines(report)).toEqual(['  removal: skipped empty_import missing=1 current=1']);
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
  });

  it('says nothing for a feed with no live offer', async () => {
    const feed = await aFeedOf('Tienda Vacia');
    const report = await importRows({ [feed.feedId]: [] }, { feedId: feed.feedId });
    expect(report.feeds[0].removalSkipped).toBeUndefined();
    expect(removalLines(report)).toEqual([]);
  });
});

describe('the guard: a small import (AC 10, 11)', () => {
  const CASES = [
    { name: '9 missing of 10 removes', live: 10, keep: 1, removes: 9 },
    { name: '10 missing of 20 removes: exactly half is not more than half', live: 20, keep: 10, removes: 10 },
    { name: '5 missing of 5 removes: under the minimum the guard never trips', live: 5, keep: 0, removes: 5, accepted: ['n1'] },
  ];

  it.each(CASES)('$name', async ({ live, keep, removes, accepted }) => {
    const feed = await seeded(live);

    const report = await reimport(feed, accepted ?? range(keep));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: removes });
    expect(report.feeds[0].removalSkipped).toBeUndefined();
    expect(removalLines(report)).toEqual([]);
    expect(removedOf(await offersOf(feed.feedId))).toHaveLength(removes);
    expect(importExitCode(report)).toBe(0);
  });

  it('10 missing of 19 skips: nothing is flagged, the line says how many and of how many, exit 0', async () => {
    const feed = await seeded(19);

    const report = await reimport(feed, range(9));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 0, offersUpdated: 9 });
    expect(report.feeds[0].removalSkipped).toEqual({ reason: 'small_import', missing: 10, current: 19 });
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    expect(linesOf(report)[0]).toContain(' offers_removed=0 ');
    expect(removalLines(report)).toEqual(['  removal: skipped small_import missing=10 current=19']);
    expect(importExitCode(report)).toBe(0);
    // Everything still public: a skipped pass publishes and unpublishes nothing.
    expect((await getPublicCategoryPage(feed.category.slug, 1, null, 'price-asc'))?.productCount).toBe(19);
  });

  it('measures the live offers, not every stored offer: an offer removed earlier is not counted again', async () => {
    const feed = await seeded(20);
    await reimport(feed, range(10)); // removes r11..r20: 10 of 20, allowed
    expect(removedOf(await offersOf(feed.feedId))).toHaveLength(10);

    // Ten live offers remain; five of them missing is under the minimum, so it removes.
    const report = await reimport(feed, range(5));

    expect(report.feeds[0]).toMatchObject({ offersRemoved: 5 });
    expect(report.feeds[0].removalSkipped).toBeUndefined();
    expect(removedOf(await offersOf(feed.feedId))).toHaveLength(15);
  });
});

/** The CSV text of `listing(ids)`, for a run that needs `importFeeds` options `importRows` does not take. */
const csvOfListing = (ids: string[]): string => catalogueCsv(listing(ids));

describe('the override (AC 12)', () => {
  /** One import of `ids` into the feed through `importFeeds`, with the override on or off, named by --feed or not. */
  const run = (feedId: number, ids: string[], o: { allow: boolean; named?: boolean }) =>
    importFeeds(getDb(), {
      ...(o.named === false ? {} : { feedId }),
      allowLargeRemoval: o.allow,
      deps: textDeps({ [feedId]: csvOfListing(ids) }),
    });

  it('10 missing of 19 with the override removes them and prints no removal line', async () => {
    const feed = await seeded(19);

    const report = await run(feed.feedId, range(9), { allow: true });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 10 });
    expect(report.feeds[0].removalSkipped).toBeUndefined();
    expect(removedOf(await offersOf(feed.feedId))).toHaveLength(10);
    expect(removalLines(report)).toEqual([]);
  });

  it('still skips an import with nothing accepted, however large the feed', async () => {
    const feed = await seeded(25);

    const report = await run(feed.feedId, [], { allow: true });

    expect(report.feeds[0].removalSkipped).toEqual({ reason: 'empty_import', missing: 25, current: 25 });
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    expect(removalLines(report)).toEqual(['  removal: skipped empty_import missing=25 current=25']);
  });

  it('has no effect without a feed id: the all-feeds run keeps the guard', async () => {
    const feed = await seeded(19);

    const report = await run(feed.feedId, range(9), { allow: true, named: false });

    expect(report.feeds[0].removalSkipped).toEqual({ reason: 'small_import', missing: 10, current: 19 });
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
  });

  it('is off unless asked for: the same file without it skips', async () => {
    const feed = await seeded(19);
    const report = await run(feed.feedId, range(9), { allow: false });
    expect(report.feeds[0].removalSkipped).toMatchObject({ reason: 'small_import' });
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
  });

  it('unsticks a skipped feed: the same file skips again on a plain run and removes with the override', async () => {
    const feed = await seeded(19);
    const first = await reimport(feed, range(9));
    const second = await reimport(feed, range(9));
    // The guard compares with the same live set every time, so a skip repeats until it is overridden.
    expect(removalLines(first)).toEqual(['  removal: skipped small_import missing=10 current=19']);
    expect(removalLines(second)).toEqual(removalLines(first));

    const overridden = await run(feed.feedId, range(9), { allow: true });
    const after = await reimport(feed, range(9));

    expect(overridden.feeds[0]).toMatchObject({ offersRemoved: 10 });
    expect(after.feeds[0]).toMatchObject({ offersRemoved: 0 });
    expect(removalLines(after)).toEqual([]);
  });
});

describe('a skipped removal still commits the rest of the import (AC 13)', () => {
  it('refreshes prices, creates new offers and restores returning offers while it removes nothing', async () => {
    const feed = await seeded(20);
    await reimport(feed, range(19)); // removes r20 (1 of 20)
    const returning = (await offersOf(feed.feedId)).r20;
    expect(returning.isRemoved).toBe(true);

    // 19 live offers (r1..r19); the file lists r1..r5, r20 again and a new row: 14 missing of 19, so it skips.
    const report = await importRows(
      {
        [feed.feedId]: [...listing(range(5), { price: '4.44' }), ...listing(['r20'], { price: '6.66' }), ...listing(['n1'], { price: '8.88' })],
      },
      { feedId: feed.feedId },
    );

    expect(report.feeds[0].removalSkipped).toEqual({ reason: 'small_import', missing: 14, current: 19 });
    expect(report.feeds[0]).toMatchObject({ offersRemoved: 0, offersCreated: 1, offersUpdated: 6 });
    const byId = await offersOf(feed.feedId);
    expect(removedOf(byId)).toEqual([]);
    expect(byId.r1.priceCents).toBe(444);
    expect(byId.n1.priceCents).toBe(888);
    expect(byId.r20).toMatchObject({ id: returning.id, isRemoved: false, priceCents: 666 });
  });
});

describe('an offer that is listed again comes back (AC 14)', () => {
  it('keeps its id, product and clicks, takes the new price, counts as updated, and is public again', async () => {
    const feed = await seeded(3);
    const before = (await offersOf(feed.feedId)).r3;
    const product = await productOfOffer(before.id);
    expect((await callGo(before.id)).status).toBe(302);
    const clicksBefore = await allClicks();
    expect(clicksBefore).toHaveLength(1);

    await reimport(feed, range(2));
    expect((await offersOf(feed.feedId)).r3.isRemoved).toBe(true);
    expect((await callGo(before.id)).status).toBe(404);
    expect(await allClicks()).toEqual(clicksBefore);

    const report = await importRows(
      { [feed.feedId]: [...listing(range(2)), keyRow('r3', { category: MAPPED, price: '7.50' })] },
      { feedId: feed.feedId },
    );

    const after = (await offersOf(feed.feedId)).r3;
    expect(after).toMatchObject({ id: before.id, productId: before.productId, isRemoved: false, priceCents: 750 });
    expect(report.feeds[0]).toMatchObject({ offersCreated: 0, productsCreated: 0, offersUpdated: 3, offersRemoved: 0 });
    expect(Object.keys(await offersOf(feed.feedId))).toHaveLength(3);
    expect((await allClicks())[0]).toEqual(clicksBefore[0]);
    expect(await surface(product.slug, feed.category.slug)).toMatchObject({ pageOffers: [before.id], pagePrices: [750], inCategory: true });
    expect((await callGo(before.id)).status).toBe(302);
  });
});

describe('removal and return write no hide or review flag (AC 15)', () => {
  it('a hidden offer that is removed stays hidden, and stays non-public when it returns', async () => {
    const feed = await seeded(4);
    const hiddenOffer = (await offersOf(feed.feedId)).r1;
    await setOfferHidden(hiddenOffer.id, true);

    await reimport(feed, ['r2', 'r3', 'r4']);
    expect((await offersOf(feed.feedId)).r1).toMatchObject({ isRemoved: true, isHidden: true });

    await reimport(feed, range(4));
    expect((await offersOf(feed.feedId)).r1).toMatchObject({ isRemoved: false, isHidden: true });
    expect((await callGo(hiddenOffer.id)).status).toBe(404);
    expect(await getPublicProductBySlug((await productOfOffer(hiddenOffer.id)).slug)).toBeNull();
  });

  it('an offer in the matching queue is removed and comes back still in it', async () => {
    const feed = await seeded(4);
    const queued = (await offersOf(feed.feedId)).r2;
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, queued.id));

    await reimport(feed, ['r1', 'r3', 'r4']);
    expect((await offersOf(feed.feedId)).r2).toMatchObject({ isRemoved: true, inReview: true });
    await reimport(feed, range(4));

    expect((await offersOf(feed.feedId)).r2).toMatchObject({ isRemoved: false, inReview: true });
    expect((await callGo(queued.id)).status).toBe(404);
  });

  it('unhiding a removed offer publishes nothing; the return does', async () => {
    const feed = await seeded(4);
    const offer = (await offersOf(feed.feedId)).r1;
    await setOfferHidden(offer.id, true);
    await reimport(feed, ['r2', 'r3', 'r4']);

    await setOfferHidden(offer.id, false);
    expect((await offersOf(feed.feedId)).r1).toMatchObject({ isRemoved: true, isHidden: false });
    expect((await callGo(offer.id)).status).toBe(404);

    await reimport(feed, range(4));
    expect((await callGo(offer.id)).status).toBe(302);
  });

  it('a hidden product stays hidden through a removal and a return', async () => {
    const feed = await seeded(4);
    const offer = (await offersOf(feed.feedId)).r1;
    const product = await productOfOffer(offer.id);
    await setProductHidden(product.id, true);

    await reimport(feed, ['r2', 'r3', 'r4']);
    await reimport(feed, range(4));

    expect((await productOfOffer(offer.id)).isHidden).toBe(true);
    expect(await getPublicProductBySlug(product.slug)).toBeNull();
    expect((await callGo(offer.id)).status).toBe(404);
  });

  it('writes no hidden or review flag on any row: only the removed flag differs after a removal', async () => {
    const feed = await seeded(6);
    await setOfferHidden((await offersOf(feed.feedId)).r1.id, true);
    await setProductHidden((await productOfOffer((await offersOf(feed.feedId)).r2.id)).id, true);
    const before = await allRows();

    await reimport(feed, ['r1', 'r2', 'r3', 'r4']);

    const after = await allRows();
    const flags = (rows: typeof before) => ({
      offers: rows.offers.map((row) => [row.id, row.isHidden, row.inReview]),
      products: rows.products.map((row) => [row.id, row.isHidden, row.categoryId]),
    });
    expect(flags(after)).toEqual(flags(before));
    expect(after.offers.filter((row) => row.isRemoved).map((row) => row.externalId).sort()).toEqual(['r5', 'r6']);
  });
});

describe('feed and shop states (AC 16)', () => {
  it('runs the pass for an approved feed of an unapproved shop, publishes none of it, and shows the listed offers once the shop is approved', async () => {
    const feed = await seeded(10, { shopName: 'Tienda Sin Aprobar' });
    await getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, feed.shopId));

    const report = await reimport(feed, range(5));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 5 });
    expect(removedOf(await offersOf(feed.feedId))).toEqual(sorted(range(10).slice(5)));
    expect((await getPublicCategoryPage(feed.category.slug, 1, null, 'price-asc'))?.productCount ?? 0).toBe(0);
    expect((await callGo((await offersOf(feed.feedId)).r1.id)).status).toBe(404);

    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, feed.shopId));

    expect((await getPublicCategoryPage(feed.category.slug, 1, null, 'price-asc'))?.productCount).toBe(5);
    expect((await callGo((await offersOf(feed.feedId)).r1.id)).status).toBe(302);
    expect((await callGo((await offersOf(feed.feedId)).r10.id)).status).toBe(404);
  });

  it('skips an unapproved feed with --feed and in an all-feeds run, and changes none of its offers', async () => {
    const shop = await insertShop({ name: 'Tienda Apagada' });
    const feedId = await insertFeed(shop.id, { isApproved: false });
    const product = await insertProduct({ slug: 'producto-apagado' });
    await insertOffer({ productId: product.id, feedId, externalId: 'x1' });
    await insertOffer({ productId: product.id, feedId, externalId: 'x2', isRemoved: true });
    const before = await offersOf(feedId);

    const named = await importFeeds(getDb(), { feedId, deps: textDeps({}) });
    const all = await importFeeds(getDb(), { deps: textDeps({}) });

    expect(named.feeds[0]).toMatchObject({ outcome: 'skipped', skipReason: 'not_approved', offersRemoved: 0 });
    expect(formatImportReport(named)).toBe(
      `feed ${feedId} "Tienda Apagada": skipped not_approved\ntotal: feeds=1 imported=0 skipped=1 failed=0`,
    );
    expect(all.feeds).toEqual([]);
    expect(await offersOf(feedId)).toEqual(before);
  });
});

describe('a catalogue-file feed follows the same rules (AC 17)', () => {
  const CATALOGUE = (ids: string[]) => catalogueCsv(listing(ids));

  async function fileFeed(count: number) {
    const folder = await tempCatalogueFolder();
    const file = path.join(folder.dir, 'tienda.csv');
    await writeFile(file, CATALOGUE(range(count)));
    const feed = await aFileFeed('tienda.csv', { shopName: 'Tienda Archivo' });
    const category = await mapFeed(feed.feedId);
    await importFromFolder(folder.dir, { feedId: feed.feedId });
    const rewrite = async (ids: string[]) => {
      await writeFile(file, CATALOGUE(ids));
      return importFromFolder(folder.dir, { feedId: feed.feedId });
    };
    return { folder, feed, category, rewrite };
  }

  it('removes the offers the file dropped, and nothing else', async () => {
    const { folder, feed, rewrite } = await fileFeed(10);
    try {
      const report = await rewrite(range(6));
      expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 4 });
      expect(removedOf(await offersOf(feed.feedId))).toEqual(sorted(['r7', 'r8', 'r9', 'r10']));
    } finally {
      await folder.remove();
    }
  });

  it('skips a file with no accepted row as empty_import', async () => {
    const { folder, feed, rewrite } = await fileFeed(3);
    try {
      const report = await rewrite([]);
      expect(report.feeds[0].removalSkipped).toEqual({ reason: 'empty_import', missing: 3, current: 3 });
      expect(removalLines(report)).toEqual(['  removal: skipped empty_import missing=3 current=3']);
      expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    } finally {
      await folder.remove();
    }
  });

  it('skips a file that drops 11 of 20 as small_import', async () => {
    const { folder, feed, rewrite } = await fileFeed(20);
    try {
      const report = await rewrite(range(9));
      expect(removalLines(report)).toEqual(['  removal: skipped small_import missing=11 current=20']);
      expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
    } finally {
      await folder.remove();
    }
  });

  it('brings a dropped offer back, with its id, when the file lists it again', async () => {
    const { folder, feed, rewrite } = await fileFeed(4);
    try {
      const before = (await offersOf(feed.feedId)).r4;
      await rewrite(range(3));
      expect((await offersOf(feed.feedId)).r4.isRemoved).toBe(true);

      const report = await rewrite(range(4));

      expect(report.feeds[0]).toMatchObject({ offersUpdated: 4, offersCreated: 0 });
      expect((await offersOf(feed.feedId)).r4).toMatchObject({ id: before.id, isRemoved: false });
    } finally {
      await folder.remove();
    }
  });
});

describe('importing again (AC 18)', () => {
  it('an unchanged file prints offers_removed=0 and no removal line, every time', async () => {
    const feed = await seeded(10);
    for (let run = 0; run < 2; run += 1) {
      const report = await reimport(feed, range(10));
      expect(linesOf(report)[0]).toContain(' offers_removed=0 ');
      expect(removalLines(report)).toEqual([]);
    }
    expect(removedOf(await offersOf(feed.feedId))).toEqual([]);
  });

  it('a shrunk file removes on the first run only', async () => {
    const feed = await seeded(10);

    const first = await reimport(feed, range(6));
    const second = await reimport(feed, range(6));

    expect(first.feeds[0].offersRemoved).toBe(4);
    expect(second.feeds[0].offersRemoved).toBe(0);
    expect(linesOf(second)[0]).toContain(' offers_removed=0 ');
    expect(removalLines(second)).toEqual([]);
    expect(removedOf(await offersOf(feed.feedId))).toHaveLength(4);
  });
});

describe('the printed lines (AC 19)', () => {
  it('prints the imported line with offers_removed, the removal line last under its feed, and the unchanged total', async () => {
    const feed = await seeded(20, { shopName: 'Tienda Linea' });

    const report = await importRows(
      { [feed.feedId]: [...listing(range(5)), keyRow('r6', { category: MAPPED, price: 'abc' })] },
      { feedId: feed.feedId },
    );

    expect(linesOf(report)).toEqual([
      `feed ${feed.feedId} "Tienda Linea": imported rows=6 products_created=0 offers_created=0 offers_updated=5 offers_removed=0 rejected=1 unknown_vehicles=0`,
      '  record 7: invalid_price (price)',
      '  removal: skipped small_import missing=15 current=20',
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
    expect(formatImportReport(report)).not.toMatch(/https?:|\.example|abc/);
  });

  it('prints the number removed on the head line and no removal line when the pass removed offers', async () => {
    const feed = await seeded(10, { shopName: 'Tienda Linea' });

    const report = await reimport(feed, range(6));

    expect(linesOf(report)).toEqual([
      `feed ${feed.feedId} "Tienda Linea": imported rows=6 products_created=0 offers_created=0 offers_updated=6 offers_removed=4 rejected=0 unknown_vehicles=0`,
      'total: feeds=1 imported=1 skipped=0 failed=0',
    ]);
  });
});

// OD-3 (US-5.6 AC 14, docs/product/vehicle-fitment.md rule 2, decision 0018): a fitment belongs to
// (product, vehicle, feed) and counts while that feed and its shop are approved. A removed offer does
// not end it: the product keeps the "fits" claim a feed gave it after that feed dropped the offer.
// Assertions go through the public fit readers and the category filter by car, never the fitments table.
describe('fitments after a removal (OD-3)', () => {
  const [CAR] = VEHICLE_CATALOGUE.map((vehicle) => vehicle.slug);

  /** Shop A says its offer of the shared product fits CAR; shop B says nothing about fitment. */
  async function fitmentWorld() {
    const a = await aFeedOf('Tienda A');
    const b = await aFeedOf('Tienda B');
    const category = await mapFeed(a.feedId);
    await mapFeed(b.feedId);
    const carId = await vehicleIdBySlug(CAR);
    const aRows = (withShared: boolean) => [
      ...(withShared ? [keyRow('a-1', { category: MAPPED, ean: EAN.one, price: '10.00' })] : []),
      keyRow('a-2', { category: MAPPED }),
    ];
    const withFitment = (rows: ReturnType<typeof aRows>) =>
      rows.map((row) => (row.id === 'a-1' ? { ...row, fitment: CAR } : { ...row, fitment: '' }));
    const bRows = [keyRow('b-1', { category: MAPPED, ean: EAN.one, price: '12.00' }), keyRow('b-2', { category: MAPPED })];
    await importRows({ [a.feedId]: withFitment(aRows(true)), [b.feedId]: bRows });
    const offerA = (await offersOf(a.feedId))['a-1'];
    const offerB = (await offersOf(b.feedId))['b-1'];
    expect(offerB.productId).toBe(offerA.productId);
    const product = await productOfOffer(offerA.id);
    return {
      a,
      b,
      category,
      carId,
      product,
      offerA,
      offerB,
      /** Feed A imports again without the shared row (its offer is removed); a-2 stays listed. */
      dropSharedFromA: () => importRows({ [a.feedId]: withFitment(aRows(false)) }, { feedId: a.feedId }),
    };
  }
  type World = Awaited<ReturnType<typeof fitmentWorld>>;

  /** The fit claim of the shared product on every real reader. */
  async function fitReaders(w: World) {
    const [bySlug, byId, vehicles, listing] = await Promise.all([
      readProductFitState(w.product.slug, w.carId),
      readFitStates(CAR, [w.product.id]),
      readProductVehicles(w.product.slug),
      getPublicCategoryPage(w.category.slug, 1, null, 'price-asc', w.carId),
    ]);
    return {
      banner: bySlug,
      state: byId.status === 'ok' ? byId.states.get(w.product.id) : byId.status,
      fittedVehicles: vehicles.map((vehicle) => vehicle.slug),
      group: listing?.products.find((card) => card.slug === w.product.slug)?.fitGroup ?? null,
      fitsCount: listing?.fit?.fitsCount ?? null,
    };
  }

  const FITS = { banner: 'fits', state: 'fits', fittedVehicles: [CAR], group: 'fits', fitsCount: 1 };

  it('keeps the product fitting the car after the feed that said so drops its offer, while the other shop keeps it public', async () => {
    const w = await fitmentWorld();
    expect(await fitReaders(w)).toEqual(FITS);

    const report = await w.dropSharedFromA();

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 1 });
    expect((await offersOf(w.a.feedId))['a-1'].isRemoved).toBe(true);
    expect((await offersOf(w.b.feedId))['b-1'].isRemoved).toBe(false);
    // Still public, through shop B's offer only.
    expect(await surface(w.product.slug, w.category.slug)).toMatchObject({ pageOffers: [w.offerB.id], inCategory: true });
    // And the claim stands on the banner, the list of fitting cars, the fit state and the category filter.
    expect(await fitReaders(w)).toEqual(FITS);
  });

  it('keeps the claim through a second import of the same shrunk file', async () => {
    const w = await fitmentWorld();
    await w.dropSharedFromA();

    const again = await w.dropSharedFromA();

    expect(again.feeds[0]).toMatchObject({ outcome: 'imported', offersRemoved: 0 });
    expect(await fitReaders(w)).toEqual(FITS);
  });

  it('ends the claim with the approval of the feed that gave it, not with its removed offer', async () => {
    const w = await fitmentWorld();
    await w.dropSharedFromA();

    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, w.a.feedId));

    expect(await fitReaders(w)).toEqual({
      banner: 'unknown',
      state: 'unknown',
      fittedVehicles: [],
      group: 'unknown',
      fitsCount: 0,
    });
  });
});
