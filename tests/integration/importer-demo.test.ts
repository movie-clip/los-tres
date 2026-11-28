import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { categories, feeds, fitments, offers, products } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { readFitStates, readProductVehicles } from '@/server/catalogue/fit-state';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { seedDemoData } from '@/server/seed';

import {
  DEMO_BOSCH,
  DEMO_COUNTS,
  DEMO_DRILL,
  DEMO_FEED_ROWS,
  DEMO_FEED_URLS,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_WRENCHES,
} from '../fixtures/demo';
import { NO_HELD, heldOf } from '../support/attributes';
import { allOffers, allProducts, vehicleIdBySlug } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { stubNetworkOff } from '../support/network-off';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

let fetchStub: ReturnType<typeof stubNetworkOff>;

beforeEach(async () => {
  await resetDatabase();
  fetchStub = stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

const FEEDS = [
  { name: 'Tienda Demo Uno', ...DEMO_FEED_ROWS.uno },
  { name: 'Tienda Demo Dos', ...DEMO_FEED_ROWS.dos },
  { name: 'Tienda Demo Tres', ...DEMO_FEED_ROWS.tres },
  { name: 'Tienda Demo Cuatro', ...DEMO_FEED_ROWS.cuatro },
];

// The exact report text of a first run (everything created) or a second (every offer updated).
function reportLines(ids: number[], run: 'first' | 'second'): string {
  const lines = FEEDS.map((feed, index) => {
    const counts =
      run === 'first'
        ? `products_created=${feed.productsCreated} offers_created=${feed.rows} offers_updated=0 offers_removed=0`
        : `products_created=0 offers_created=0 offers_updated=${feed.rows} offers_removed=0`;
    return `feed ${ids[index]} "${feed.name}": imported rows=${feed.rows} ${counts} rejected=0 unknown_vehicles=0`;
  });
  return [...lines, `total: feeds=${FEEDS.length} imported=${FEEDS.length} skipped=0 failed=0`].join('\n');
}

async function feedId(url: string): Promise<number> {
  const [row] = await getDb().select({ id: feeds.id }).from(feeds).where(eq(feeds.url, url));
  return row.id;
}

// The shipped demo files (demo/feeds/*.csv) through the real source reader:
// local files only, no network.
describe('import-feeds on the shipped demo data (brief acceptance)', () => {
  it('first run: the demo products and offers, nothing rejected, and the exact report lines', async () => {
    await seedDemoData(getDb());
    const ids = await Promise.all(DEMO_FEED_URLS.map(feedId));

    const report = await importFeeds(getDb());

    expect(await allProducts()).toHaveLength(DEMO_COUNTS.products);
    expect(await allOffers()).toHaveLength(DEMO_COUNTS.offers);
    expect(report.feeds.flatMap((feed) => feed.rejected)).toEqual([]);
    expect(importExitCode(report)).toBe(0);
    expect(formatImportReport(report)).toBe(reportLines(ids, 'first'));
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('second run duplicates nothing: counts unchanged, every offer updated', async () => {
    await seedDemoData(getDb());
    const ids = await Promise.all(DEMO_FEED_URLS.map(feedId));
    await importFeeds(getDb());
    const productsBefore = await allProducts();

    const report = await importFeeds(getDb());

    expect(await allProducts()).toEqual(productsBefore);
    expect(await allOffers()).toHaveLength(DEMO_COUNTS.offers);
    expect(formatImportReport(report)).toBe(reportLines(ids, 'second'));
  });

  it('re-running refreshes price_updated_at to the run start even when no price changed', async () => {
    await seedDemoData(getDb());
    const first = new Date('2026-10-01T09:00:00Z');
    const second = new Date('2026-10-02T09:00:00Z');
    await importFeeds(getDb(), { deps: { now: () => first } });
    expect((await allOffers()).every((offer) => offer.priceUpdatedAt.getTime() === first.getTime())).toBe(true);

    const report = await importFeeds(getDb(), { deps: { now: () => second } });

    expect(report.startedAt).toEqual(second);
    const rows = await allOffers();
    expect(rows).toHaveLength(DEMO_COUNTS.offers);
    expect(rows.every((offer) => offer.priceUpdatedAt.getTime() === second.getTime())).toBe(true);
  });

  it('matches the shared EAN into one product with the first feed\'s text and two offers', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());

    const page = await getPublicProductBySlug(DEMO_SHARED.slug);
    expect(page).toMatchObject({
      title: DEMO_SHARED.title,
      brand: DEMO_SHARED.brand,
      partNumber: DEMO_SHARED.partNumber,
      ean: DEMO_SHARED.ean,
    });
    expect(page?.offers.map((offer) => [offer.shopName, offer.priceCents])).toEqual(
      DEMO_SHARED.offers.map((offer) => [offer.shopName, offer.priceCents]),
    );
    // The drill and the wrenches map to no fixed category: imported, never public.
    for (const unmapped of [DEMO_DRILL, DEMO_WRENCHES]) {
      expect(await getPublicProductBySlug(unmapped.slug)).toBeNull();
      expect((await allProducts()).find((row) => row.slug === unmapped.slug)?.categoryId).toBeNull();
    }
    const oil = await getPublicProductBySlug(DEMO_NO_BRAND.slug);
    expect(oil?.offers.map((offer) => offer.priceCents)).toEqual([DEMO_NO_BRAND.priceCents]);
  });

  it('stores every price as the integer cents of the feed text', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const rows = await getDb().select({ ext: offers.externalId, cents: offers.priceCents }).from(offers);
    const byExternalId = Object.fromEntries(rows.map((row) => [row.ext, row.cents]));
    expect(rows).toHaveLength(DEMO_COUNTS.offers);
    expect(byExternalId).toMatchObject({
      'UNO-001': 1299,
      'UNO-002': 4990,
      'UNO-005': 650,
      'UNO-004': 1590,
      'DOS-100': 1149,
      'DOS-101': 2999,
      'DOS-102': 8900,
      'DOS-103': 5495,
    });
    expect(Object.values(byExternalId).every(Number.isInteger)).toBe(true);
  });

  it('imports nothing and reports an empty run when no feed is registered', async () => {
    const report = await importFeeds(getDb());
    expect(report.feeds).toEqual([]);
    expect(formatImportReport(report)).toBe('total: feeds=0 imported=0 skipped=0 failed=0');
    expect(await getDb().select().from(products)).toEqual([]);
  });
});

// S5.6, AC 17, 18, 31, 32, 34: the fitments the demo import writes.
describe('fitments of the shipped demo data (S5.6)', () => {
  const SCREEN_VEHICLE = 'seat-leon-iii-2012-2020-1-6-tdi-115cv';

  const fitmentRows = () =>
    getDb()
      .select({
        id: fitments.id,
        productId: fitments.productId,
        vehicleId: fitments.vehicleId,
        feedId: fitments.feedId,
        createdAt: fitments.createdAt,
      })
      .from(fitments)
      .orderBy(fitments.id);

  const productIdOf = async (partNumber: string): Promise<number> => {
    const [row] = await getDb().select({ id: products.id }).from(products).where(eq(products.partNumber, partNumber));
    return row.id;
  };

  it('writes fitments on the first import and none for the products and rows that carry no list', async () => {
    await seedDemoData(getDb());
    expect(await fitmentRows()).toEqual([]);
    await importFeeds(getDb());

    const rows = await fitmentRows();
    expect(rows.length).toBeGreaterThan(0);
    const withFitment = new Set(rows.map((row) => row.productId));
    expect(withFitment.has(await productIdOf('OF-3306'))).toBe(true);
    expect(withFitment.has(await productIdOf('OF-2041'))).toBe(false);
    // The drill and the wrenches are not car parts (AC 33).
    for (const unmapped of [DEMO_DRILL, DEMO_WRENCHES]) {
      const product = await getDb().select({ id: products.id }).from(products).where(eq(products.slug, unmapped.slug));
      expect(withFitment.has(product[0].id), unmapped.slug).toBe(false);
    }
  });

  it('answers fits, no-fit and unknown for the screen vehicle over the demo products (AC 31)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const fits = await productIdOf('OF-3306');
    const noFit = await productIdOf('OF-4472');
    const unknown = await productIdOf('OF-2041');

    const result = await readFitStates(SCREEN_VEHICLE, [fits, noFit, unknown]);

    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    expect(new Map(result.states)).toEqual(
      new Map([
        [fits, 'fits'],
        [noFit, 'no-fit'],
        [unknown, 'unknown'],
      ]),
    );
  });

  it('holds fitments from two feeds for the shared product, and the vehicle both list counts once (AC 32)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const product = await productIdOf('OF-3306');
    const leon = await vehicleIdBySlug(SCREEN_VEHICLE);

    const rows = (await fitmentRows()).filter((row) => row.productId === product);
    const feedsOfLeon = rows.filter((row) => row.vehicleId === leon).map((row) => row.feedId);
    expect(new Set(feedsOfLeon).size).toBeGreaterThanOrEqual(2);
    const result = await readFitStates(SCREEN_VEHICLE, [product]);
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    expect(result.states.get(product)).toBe('fits');
    expect(result.states.size).toBe(1);
  });

  // S5.9 #280, D-2 and AC 29: the demo Bosch filter fits 12 vehicles, enough to collapse the list.
  it('lists 12 distinct vehicles of 6 makes for the Bosch filter, in list order, León once though three feeds name it (AC 29)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const list = await readProductVehicles(DEMO_BOSCH.slug);
    expect(list.map((vehicle) => vehicle.slug)).toEqual([...DEMO_BOSCH.vehicles]);
    expect(new Set(list.map((vehicle) => vehicle.makeSlug)).size).toBe(DEMO_BOSCH.makes);
    expect(list.length).toBeGreaterThan(10);

    const product = await productIdOf(DEMO_BOSCH.partNumber);
    const leon = await vehicleIdBySlug(SCREEN_VEHICLE);
    const rows = (await fitmentRows()).filter((row) => row.productId === product);
    expect(new Set(rows.filter((row) => row.vehicleId === leon).map((row) => row.feedId)).size).toBe(3);
    // One fitment row per (vehicle, feed): 12 vehicles, León three times, Golf twice, Clio dCi once, the rest once.
    expect(rows.length).toBeGreaterThan(list.length);
  });

  it('keeps the six demo cars fit states of the Bosch filter after the extension (AC 29)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const product = await productIdOf(DEMO_BOSCH.partNumber);
    for (const [slug, fits] of Object.entries(DEMO_BOSCH.demoCars)) {
      const result = await readFitStates(slug, [product]);
      if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
      expect(result.states.get(product), slug).toBe(fits ? 'fits' : 'no-fit');
    }
  });

  it('gives the extra vehicles to no other demo product (AC 29)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const bosch = await productIdOf(DEMO_BOSCH.partNumber);
    const extras = DEMO_BOSCH.vehicles.filter((slug) => !(slug in DEMO_BOSCH.demoCars));
    const extraIds = await Promise.all(extras.map(vehicleIdBySlug));
    const rows = await fitmentRows();
    const others = rows.filter((row) => extraIds.includes(row.vehicleId) && row.productId !== bosch);
    expect(others).toEqual([]);
    expect(rows.filter((row) => extraIds.includes(row.vehicleId)).length).toBe(extras.length);
  });

  it('changes no fitment row on the second import: same ids, same creation times (AC 18, AC 34)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb(), { deps: { now: () => new Date('2026-10-01T09:00:00Z') } });
    const before = await fitmentRows();
    expect(before.length).toBeGreaterThan(0);

    await importFeeds(getDb(), { deps: { now: () => new Date('2026-10-02T09:00:00Z') } });

    expect(await fitmentRows()).toEqual(before);
  });
});

// S15.3 (US-15.3) ACs 42 and 43: the demo feeds carry the attribute entry for the demo engine-oil products and the
// first import holds them, with no second import. The demo values are the shipped files' own (D14 of the design:
// invented, "Homologación demo N"); the readers' forms are unit/category-attributes.test.ts, and the unit
// demo-feeds.test.ts pins what the files say. Which products carry values is the shipped data's: this reads the
// four rows of tienda-demo-cuatro that carry an entry, and asserts nothing about the rows that do not.
describe('the demo attributes (S15.3, AC 42, 43)', () => {
  const DEMO_ATTRIBUTES = [
    {
      ean: '2000000100050',
      page: { viscosity: '5W-30', volume: '4 l', acea: ['C3'], oilType: 'synthetic', approvals: ['Homologación demo 501', 'Homologación demo 502'] },
    },
    {
      ean: '2000000100067',
      page: { viscosity: '5W-30', volume: '4 l', acea: ['C3'], oilType: 'synthetic', approvals: null },
    },
    {
      ean: '2000000100104',
      page: { viscosity: '5W-30', volume: '4,5 l', acea: ['C3'], oilType: 'synthetic', approvals: ['Homologación demo 503'] },
    },
    {
      ean: '2000000100142',
      page: { viscosity: '10W-40', volume: '5 l', acea: ['A3/B4'], oilType: 'mineral', approvals: [
        'Homologación demo 504',
        'Homologación demo 505',
        'Homologación demo 506',
        'Homologación demo 507',
        'Homologación demo 508',
        'Homologación demo 509',
        'Homologación demo 510',
        'Homologación demo 511',
        'Homologación demo 512',
        'Homologación demo 513',
      ] },
    },
  ] as const;

  it('AC 42: after the first import the demo engine-oil products with an entry show their attributes on the product page, with no second import', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const stored = await allProducts();

    for (const { ean, page } of DEMO_ATTRIBUTES) {
      const product = stored.find((candidate) => candidate.ean === ean);
      expect(product, ean).toBeDefined();
      expect((await getPublicProductBySlug(product?.slug ?? ''))?.attributes, ean).toEqual(page);
    }
  });

  it('AC 42: a demo product outside aceite-de-motor holds no attribute, and the page shows none for a product that holds none', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const [engineOil] = await getDb().select({ id: categories.id }).from(categories).where(eq(categories.slug, 'aceite-de-motor'));

    const outside = (await allProducts()).filter((product) => product.categoryId !== engineOil.id);

    expect(outside.length).toBeGreaterThan(0);
    for (const product of outside) expect(heldOf(product), product.slug).toEqual(NO_HELD);
    const filter = await getPublicProductBySlug(DEMO_SHARED.slug);
    expect(filter?.attributes).toBeNull();
  });

  it('AC 43: the first and the second import print no attribute line, so every demo value reads; the second changes no product row', async () => {
    await seedDemoData(getDb());
    const first = await importFeeds(getDb());
    const productsBefore = await allProducts();

    const second = await importFeeds(getDb());

    for (const report of [first, second]) expect(formatImportReport(report)).not.toMatch(/attributes/);
    expect(await allProducts()).toEqual(productsBefore);
    expect(productsBefore.some((product) => heldOf(product).viscosity !== null)).toBe(true);
  });
});
