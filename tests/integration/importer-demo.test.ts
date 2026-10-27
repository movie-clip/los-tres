import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
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
import { allOffers, allProducts } from '../support/catalogue';
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

async function feedId(url: string): Promise<number> {
  const [row] = await getDb().select({ id: feeds.id }).from(feeds).where(eq(feeds.url, url));
  return row.id;
}

// The shipped demo files (demo/feeds/*.csv) through the real source reader:
// local files only, no network.
describe('import-feeds on the shipped demo data (brief acceptance)', () => {
  it('first run: the demo products and offers, nothing rejected, and the exact report lines', async () => {
    await seedDemoData(getDb());
    const [uno, dos] = [await feedId(DEMO_FEED_URLS[0]), await feedId(DEMO_FEED_URLS[1])];

    const report = await importFeeds(getDb());

    expect(await allProducts()).toHaveLength(DEMO_COUNTS.products);
    expect(await allOffers()).toHaveLength(DEMO_COUNTS.offers);
    expect(report.feeds.flatMap((feed) => feed.rejected)).toEqual([]);
    expect(importExitCode(report)).toBe(0);
    expect(formatImportReport(report)).toBe(
      [
        `feed ${uno} "Tienda Demo Uno": imported rows=${DEMO_FEED_ROWS.uno} products_created=${DEMO_FEED_ROWS.uno} offers_created=${DEMO_FEED_ROWS.uno} offers_updated=0 rejected=0`,
        `feed ${dos} "Tienda Demo Dos": imported rows=${DEMO_FEED_ROWS.dos} products_created=${DEMO_FEED_ROWS.dosProductsCreated} offers_created=${DEMO_FEED_ROWS.dos} offers_updated=0 rejected=0`,
        'total: feeds=2 imported=2 skipped=0 failed=0',
      ].join('\n'),
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('second run duplicates nothing: counts unchanged, every offer updated', async () => {
    await seedDemoData(getDb());
    const [uno, dos] = [await feedId(DEMO_FEED_URLS[0]), await feedId(DEMO_FEED_URLS[1])];
    await importFeeds(getDb());
    const productsBefore = await allProducts();

    const report = await importFeeds(getDb());

    expect(await allProducts()).toEqual(productsBefore);
    expect(await allOffers()).toHaveLength(DEMO_COUNTS.offers);
    expect(formatImportReport(report)).toBe(
      [
        `feed ${uno} "Tienda Demo Uno": imported rows=${DEMO_FEED_ROWS.uno} products_created=0 offers_created=0 offers_updated=${DEMO_FEED_ROWS.uno} rejected=0`,
        `feed ${dos} "Tienda Demo Dos": imported rows=${DEMO_FEED_ROWS.dos} products_created=0 offers_created=0 offers_updated=${DEMO_FEED_ROWS.dos} rejected=0`,
        'total: feeds=2 imported=2 skipped=0 failed=0',
      ].join('\n'),
    );
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
      'UNO-101': 555,
      'UNO-124': 1935,
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
