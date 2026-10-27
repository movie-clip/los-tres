import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { importFeeds } from '@/server/importer';
import { seedDemoData } from '@/server/seed';

import { DEMO_FEED_URLS, DEMO_SHARED, DEMO_COUNTS } from '../fixtures/demo';
import { allOffers, allProducts, insertFixtureFeed } from '../support/catalogue';
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

// Guardrail 1 / TD-21: seed and importer never write an approval, hidden or
// review column on an existing row. An admin's decision survives a restart
// (seed) and a re-import.

describe('admin decisions survive seed and import (TD-21)', () => {
  it('keeps a disabled demo feed disabled and a hidden product hidden across seed + import', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());

    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.url, DEMO_FEED_URLS[0]));
    await getDb().update(products).set({ isHidden: true }).where(eq(products.slug, DEMO_SHARED.slug));

    await seedDemoData(getDb());
    const report = await importFeeds(getDb());

    const [feed] = await getDb().select().from(feeds).where(eq(feeds.url, DEMO_FEED_URLS[0]));
    const [product] = await getDb().select().from(products).where(eq(products.slug, DEMO_SHARED.slug));
    expect(feed.isApproved).toBe(false);
    expect(product.isHidden).toBe(true);
    // The disabled feed is not even in the run; the other feeds still import.
    expect(report.feeds.map((row) => row.feedId)).not.toContain(feed.id);
    expect(report.feeds).toHaveLength(DEMO_COUNTS.feeds - 1);
    expect(await getPublicProductBySlug(DEMO_SHARED.slug)).toBeNull();
  });

  it('keeps a hidden offer hidden and an in-review offer in review while its price is refreshed', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.externalId, 'UNO-001'));
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.externalId, 'DOS-101'));

    const later = new Date('2030-01-01T00:00:00Z');
    await importFeeds(getDb(), { deps: { now: () => later } });

    const rows = Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer]));
    expect(rows['UNO-001'].isHidden).toBe(true);
    expect(rows['UNO-001'].inReview).toBe(false);
    expect(rows['DOS-101'].inReview).toBe(true);
    expect(rows['DOS-101'].isHidden).toBe(false);
    expect(rows['UNO-001'].priceUpdatedAt).toEqual(later); // the import did run
    expect(await allOffers()).toHaveLength(DEMO_COUNTS.offers);
  });

  it('keeps an un-approved demo shop un-approved: its offers stay invisible after a re-import', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    await getDb().update(shops).set({ isApproved: false }).where(eq(shops.slug, 'tienda-demo-dos'));

    await seedDemoData(getDb());
    await importFeeds(getDb());

    const page = await getPublicProductBySlug(DEMO_SHARED.slug);
    expect(page?.offers.map((offer) => offer.shopName)).toEqual(['Tienda Demo Uno']);
  });

  it('keeps a product hidden when a later import attaches a new offer to it', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await importFeeds(getDb(), { feedId: first.feedId, deps: fixtureDeps });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.slug, 'fixture-alpha-filtro'));
    const hiddenBefore = (await allProducts()).filter((row) => row.isHidden).map((row) => row.slug);

    const second = await insertFixtureFeed('ean-second.csv');
    await importFeeds(getDb(), { feedId: second.feedId, deps: fixtureDeps });

    const hiddenAfter = (await allProducts()).filter((row) => row.isHidden).map((row) => row.slug);
    expect(hiddenAfter).toEqual(hiddenBefore);
    expect(await getPublicProductBySlug('fixture-alpha-filtro')).toBeNull();
    // The new offer exists but is unreachable through the public read.
    const attached = (await allOffers()).filter((offer) => offer.feedId === second.feedId);
    expect(attached.length).toBeGreaterThan(0);
  });

  it('never makes a product public that came from an unapproved feed', async () => {
    const unapproved = await insertFixtureFeed('ean-first.csv', { isApproved: false });
    await importFeeds(getDb(), { feedId: unapproved.feedId, deps: fixtureDeps });
    await importFeeds(getDb(), { deps: fixtureDeps });
    expect(await allProducts()).toEqual([]);
    expect(await getPublicProductBySlug('fixture-alpha-filtro')).toBeNull();
  });

  it('imports an approved feed of an unapproved shop (TD-29) but shows none of it', async () => {
    const feed = await insertFixtureFeed('ean-first.csv');
    await getDb()
      .update(shops)
      .set({ isApproved: false })
      .where(eq(shops.id, feed.shopId));

    const report = await importFeeds(getDb(), { deps: fixtureDeps });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: 2 });
    expect(await getPublicProductBySlug('fixture-alpha-filtro')).toBeNull();
  });
});
