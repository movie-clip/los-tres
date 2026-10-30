import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, fitments, offers, products } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { readFitStates } from '@/server/catalogue/fit-state';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { seedDemoData } from '@/server/seed';

import {
  DEMO_COUNTS,
  DEMO_DRILL,
  DEMO_FEED_ROWS,
  DEMO_FEED_URLS,
  DEMO_NO_BRAND,
  DEMO_SHARED,
  DEMO_WRENCHES,
} from '../fixtures/demo';
import { allOffers, allProducts, vehicleIdBySlug } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { stubNetworkOff } from '../support/network-off';

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
        ? `products_created=${feed.productsCreated} offers_created=${feed.rows} offers_updated=0`
        : `products_created=0 offers_created=0 offers_updated=${feed.rows}`;
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

  it('changes no fitment row on the second import: same ids, same creation times (AC 18, AC 34)', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb(), { deps: { now: () => new Date('2026-10-01T09:00:00Z') } });
    const before = await fitmentRows();
    expect(before.length).toBeGreaterThan(0);

    await importFeeds(getDb(), { deps: { now: () => new Date('2026-10-02T09:00:00Z') } });

    expect(await fitmentRows()).toEqual(before);
  });
});
