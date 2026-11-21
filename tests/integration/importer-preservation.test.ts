import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feedCategoryMappings, feeds, offers, products, shops } from '@/db/schema';
import { assignCategory } from '@/server/admin/category-mappings';
import { setOfferHidden, setProductHidden } from '@/server/admin/products';
import { setFeedApproval, setShopApproval } from '@/server/admin/sources';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { importFeeds } from '@/server/importer';
import { seedDemoData } from '@/server/seed';

import { DEMO_FEED_URLS, DEMO_SHARED, DEMO_COUNTS } from '../fixtures/demo';
import {
  allOffers,
  allProducts,
  defaultCategoryId,
  insertCategory,
  insertCategoryMapping,
  insertFixtureFeed,
  productBySlug,
} from '../support/catalogue';
import { categoryForm, fiveTargets } from '../support/categories';
import { resetDatabase } from '../support/db';
import { fixtureDeps, csvOf, textDeps, type FeedRow } from '../support/feeds';
import { callGo } from '../support/go';
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

// S2.4 (T2.4.3), ACs 46 to 51: a hide made by the admin, through the real writers, is never changed
// by an import, the seed, a feed or shop approval change, or a category mapping, and an import never
// hides. The cases above set the flags by hand (TD-21); these set them the way the admin does.

const LATER = new Date('2031-02-03T04:05:06Z');

function hideCsv(price: string, extra: FeedRow[] = []): string {
  return csvOf([
    {
      id: 'H-1',
      title: 'Filtro hide uno',
      price,
      url: `https://shop.example/h1?v=${price}`,
      brand: 'Marca',
      ean: '2000000000046',
      currency: 'EUR',
    },
    ...extra,
  ]);
}

async function flagsNow() {
  return {
    products: (await allProducts())
      .filter((row) => row.isHidden)
      .map((row) => row.slug)
      .sort(),
    offers: (await allOffers())
      .filter((row) => row.isHidden)
      .map((row) => row.externalId)
      .sort(),
  };
}

describe('a hide made by the admin survives an import (AC 46 to 49)', () => {
  it.each(['every approved feed', 'one feed'] as const)(
    'AC 46: a hidden product stays hidden when %s is imported and its prices, links, dates and offers change',
    async (scope) => {
      const { feedId } = await insertFixtureFeed('hide.csv');
      await importFeeds(getDb(), { deps: textDeps({ [feedId]: hideCsv('10.00') }) });
      const [hidden] = await allProducts();
      await setProductHidden(hidden.id, true);

      const rows = hideCsv('12.34', [
        {
          id: 'H-2',
          title: 'Filtro hide dos',
          price: '5.00',
          url: 'https://shop.example/h2',
          brand: 'Marca',
          ean: '2000000000053',
          currency: 'EUR',
        },
      ]);
      const report = await importFeeds(getDb(), {
        feedId: scope === 'one feed' ? feedId : undefined,
        deps: { ...textDeps({ [feedId]: rows }), now: () => LATER },
      });

      expect(report.feeds[0]).toMatchObject({ outcome: 'imported' });
      const offersNow = Object.fromEntries((await allOffers()).map((offer) => [offer.externalId, offer]));
      expect(offersNow['H-1']).toMatchObject({
        priceCents: 1234,
        url: 'https://shop.example/h1?v=12.34',
        priceUpdatedAt: LATER,
      });
      expect(offersNow['H-2']).toMatchObject({ priceCents: 500, isHidden: false });
      const byTitle = Object.fromEntries((await allProducts()).map((row) => [row.title, row]));
      expect(byTitle['Filtro hide uno'].isHidden).toBe(true);
      expect(byTitle['Filtro hide dos'].isHidden).toBe(false);
      expect(await getPublicProductBySlug(byTitle['Filtro hide uno'].slug)).toBeNull();
    },
  );

  it('AC 46: a category assigned from none by the import does not unhide the product', async () => {
    const { feedId } = await insertFixtureFeed('category-mixed.csv');
    await importFeeds(getDb(), { deps: fixtureDeps });
    const [first] = await getDb().select().from(offers).where(eq(offers.externalId, 'M-1'));
    const [before] = await getDb().select().from(products).where(eq(products.id, first.productId));
    expect(before.categoryId).toBeNull();
    await setProductHidden(first.productId, true);

    const filtros = await insertCategory({ slug: 'filtros' });
    await insertCategoryMapping(feedId, 'Filtros', filtros.id);
    await importFeeds(getDb(), { deps: fixtureDeps });

    const [after] = await getDb().select().from(products).where(eq(products.id, first.productId));
    expect(after).toMatchObject({ categoryId: filtros.id, isHidden: true });
    expect(await getPublicProductBySlug(after.slug)).toBeNull();
    // Non-vacuous: the category is what the import changed, and only the hide kept the page closed.
    await setProductHidden(first.productId, false);
    expect(await getPublicProductBySlug(after.slug)).not.toBeNull();
  });

  it('AC 47: a hidden offer stays hidden while an import refreshes its price and date', async () => {
    const { feedId } = await insertFixtureFeed('hide.csv');
    await importFeeds(getDb(), { deps: textDeps({ [feedId]: hideCsv('10.00') }) });
    const [offer] = await allOffers();
    await setOfferHidden(offer.id, true);

    await importFeeds(getDb(), { deps: { ...textDeps({ [feedId]: hideCsv('7.77') }), now: () => LATER } });

    const [after] = await allOffers();
    expect(after).toMatchObject({ id: offer.id, isHidden: true, priceCents: 777, priceUpdatedAt: LATER });
    // The product's own flag is not the offer's.
    expect((await allProducts())[0].isHidden).toBe(false);
  });

  it('AC 48: a second feed attaching by EAN to a hidden product is stored, not hidden, and makes nothing public', async () => {
    const first = await insertFixtureFeed('ean-first.csv');
    await importFeeds(getDb(), { feedId: first.feedId, deps: fixtureDeps });
    const alpha = await productBySlug('fixture-alpha-filtro');
    await getDb()
      .update(products)
      .set({ categoryId: await defaultCategoryId() })
      .where(eq(products.id, alpha.id));
    expect(await getPublicProductBySlug('fixture-alpha-filtro')).not.toBeNull();
    await setProductHidden(alpha.id, true);

    const second = await insertFixtureFeed('ean-second.csv');
    await importFeeds(getDb(), { feedId: second.feedId, deps: fixtureDeps });

    const attached = (await allOffers()).filter(
      (offer) => offer.feedId === second.feedId && offer.productId === alpha.id,
    );
    expect(attached).toHaveLength(1);
    expect(attached[0].isHidden).toBe(false);
    expect((await productBySlug('fixture-alpha-filtro')).isHidden).toBe(true);
    expect(await getPublicProductBySlug('fixture-alpha-filtro')).toBeNull();
    expect((await callGo(attached[0].id)).status).toBe(404);
    // Non-vacuous: unhidden, the product shows both shops, so the new offer was a real, visible one.
    await setProductHidden(alpha.id, false);
    expect((await getPublicProductBySlug('fixture-alpha-filtro'))?.offers).toHaveLength(2);
  });

  it('AC 49: an import never hides: with nothing hidden nothing is hidden after, and with one hide only it is', async () => {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    await importFeeds(getDb(), { deps: { now: () => LATER } });
    expect(await flagsNow()).toEqual({ products: [], offers: [] });

    const shared = await productBySlug(DEMO_SHARED.slug);
    const [oneOffer] = (await allOffers()).filter((offer) => offer.externalId === 'UNO-001');
    await setProductHidden(shared.id, true);
    await setOfferHidden(oneOffer.id, true);
    await importFeeds(getDb(), { deps: { now: () => LATER } });
    await importFeeds(getDb(), { feedId: oneOffer.feedId });

    expect(await flagsNow()).toEqual({ products: [DEMO_SHARED.slug], offers: ['UNO-001'] });
  });
});

describe('the seed, an approval change and a mapping never change a hidden flag (AC 50, 51)', () => {
  async function hiddenDemo() {
    await seedDemoData(getDb());
    await importFeeds(getDb());
    const shared = await productBySlug(DEMO_SHARED.slug);
    const [offer] = (await allOffers()).filter((row) => row.externalId === 'UNO-001');
    await setProductHidden(shared.id, true);
    await setOfferHidden(offer.id, true);
  }
  const HIDDEN = { products: [DEMO_SHARED.slug], offers: ['UNO-001'] };

  it('AC 50: the demo seed, run twice, leaves a hidden demo product and offer hidden', async () => {
    await hiddenDemo();
    await seedDemoData(getDb());
    await seedDemoData(getDb());
    expect(await flagsNow()).toEqual(HIDDEN);
  });

  it('AC 51: disabling and re-approving every feed and shop leaves the flags as they were', async () => {
    await hiddenDemo();
    for (const feed of await getDb().select().from(feeds)) {
      await setFeedApproval(feed.id, false);
      await setFeedApproval(feed.id, true);
    }
    for (const shop of await getDb().select().from(shops)) {
      await setShopApproval(shop.id, false);
      await setShopApproval(shop.id, true);
    }
    expect(await flagsNow()).toEqual(HIDDEN);
  });

  it('AC 51: saving a category mapping leaves the flags as they were', async () => {
    await hiddenDemo();
    const [mapping] = await getDb().select().from(feedCategoryMappings).orderBy(asc(feedCategoryMappings.id));
    const targets = await fiveTargets();
    const other = targets.find((target) => target.id !== mapping.categoryId) ?? targets[0];

    await assignCategory(
      categoryForm({ feedId: mapping.feedId, feedCategory: mapping.feedCategory, target: other.id }),
    );

    const [saved] = await getDb()
      .select()
      .from(feedCategoryMappings)
      .where(eq(feedCategoryMappings.id, mapping.id));
    expect(saved.categoryId).toBe(other.id);
    expect(await flagsNow()).toEqual(HIDDEN);
  });
});
