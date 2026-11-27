import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers } from '@/db/schema';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatImportReport } from '@/server/importer';

import { BAD_CELLS, BLANK_CELLS, NO_HELD, OIL_CELLS, OIL_HELD, OTHER_CELLS, OTHER_HELD, heldOf, oilRow } from '../support/attributes';
import { allOffers, allProducts, insertOffer } from '../support/catalogue';
import { sitemapProducts } from '../support/categories';
import { resetDatabase } from '../support/db';
import { stubLocalFlag, type LocalFlagMode } from '../support/local-flag';
import { MAPPED, aFeedOf, importRows, mapFeed, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard (0006, rule 4): the file runs real imports.
vi.setConfig({ testTimeout: 30_000 });

// S15.3 (US-15.3) ACs 32 to 35, the collected wall (rule 6, decision 0017; US-12.2 and S7.6 kept): a marked row
// (a row of a collected feed) gives attributes to a marked product only, an unmarked row to an unmarked one only,
// and the local flag decides what is shown, never whether a fill happens. In the pattern of
// collected-ean-fill.test.ts. Every shop, product, link and value is invented.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const KEY = { brand: 'Alfa', part: 'AB-100' };
const TITLE = 'Aceite Cuarzo';

const collectedFeed = (name?: string) => aFeedOf(name, { sourceType: 'collected_file' });
const row = (id: string, cells: Parameters<typeof oilRow>[1] = OIL_CELLS, o: Parameters<typeof oilRow>[2] = {}) =>
  oilRow(id, cells, { ...KEY, category: MAPPED, price: '5.00', title: TITLE, ...o });

type Report = Awaited<ReturnType<typeof importRows>>;
const attributeLines = (report: Report) => formatImportReport(report).split('\n').filter((line) => /^ {2}attributes:/.test(line));
const search = (raw: string) => getPublicSearchPage(parseSearchTerm(raw), 1);
const slugsOf = (result: Awaited<ReturnType<typeof search>>) => (result?.state === 'results' ? result.products.map((card) => card.slug) : []);

/** The offers joined to the source kind of their feed: how a marked offer is read. */
async function offerKinds() {
  return getDb()
    .select({ productId: offers.productId, externalId: offers.externalId, kind: feeds.sourceType })
    .from(offers)
    .innerJoin(feeds, eq(feeds.id, offers.feedId))
    .orderBy(offers.id);
}

describe('a marked row writes and fills a marked product (AC 32)', () => {
  it('AC 32: the collected row that creates a product writes its attributes, and the product is marked', async () => {
    const one = await collectedFeed('Recopilada uno');
    await mapFeed(one.feedId);

    const report = await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, rejected: [] });
    const [product] = await allProducts();
    expect(product.isCollected).toBe(true);
    expect(heldOf(product)).toEqual(OIL_HELD);
    expect(attributeLines(report)).toEqual([]);
  });

  it('AC 32: two collected feeds whose rows share a brand and part number converge on one marked product; a later collected row fills it', async () => {
    const one = await collectedFeed('Recopilada uno');
    const two = await collectedFeed('Recopilada dos');
    const three = await collectedFeed('Recopilada tres');
    for (const feed of [one, two, three]) await mapFeed(feed.feedId);
    await importRows({ [one.feedId]: [row('c-1', BLANK_CELLS)] }, { feedId: one.feedId });
    await importRows({ [two.feedId]: [row('c-2', BAD_CELLS)] }, { feedId: two.feedId });
    expect(await allProducts()).toHaveLength(1);
    expect(heldOf((await allProducts())[0])).toEqual(NO_HELD);

    const report = await importRows({ [three.feedId]: [row('c-3')] }, { feedId: three.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [], rejected: [] });
    const [marked] = await allProducts();
    expect(marked.isCollected).toBe(true);
    expect(heldOf(marked)).toEqual(OIL_HELD);
  });

  it('AC 32: the next import of a known collected offer whose row now carries the entry fills its marked product', async () => {
    const one = await collectedFeed('Recopilada uno');
    await mapFeed(one.feedId);
    await importRows({ [one.feedId]: [row('c-1', BLANK_CELLS)] }, { feedId: one.feedId });

    const report = await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1 });
    expect(heldOf((await allProducts())[0])).toEqual(OIL_HELD);
  });

  it('AC 21, 32: a collected row is counted like any other when its value does not read', async () => {
    const one = await collectedFeed('Recopilada uno');
    await mapFeed(one.feedId);

    const report = await importRows({ [one.feedId]: [row('c-1', { ...OIL_CELLS, acea: 'E4' })] }, { feedId: one.feedId });

    expect(attributeLines(report)).toEqual(['  attributes: unparsed acea=1']);
  });
});

describe('a marked row never gives an unmarked product an attribute (AC 33)', () => {
  /** An unmarked product with no attribute, public with the flag off; the marked row reaches it as a join or as a known offer. */
  async function unmarkedProduct() {
    const hand = await aFeedOf('Tienda escrita a mano');
    const collected = await collectedFeed('Tienda recopilada');
    await mapFeed(hand.feedId);
    await mapFeed(collected.feedId);
    await importRows({ [hand.feedId]: [row('mano-1', BLANK_CELLS)] }, { feedId: hand.feedId });
    const [plain] = await allProducts();
    return { collected, plain };
  }

  const visibleTo = async (slug: string) => ({ page: await getPublicProductBySlug(slug), found: slugsOf(await search(TITLE)) });

  it.each(['joins it by its key', 'sits on it as a known offer'] as const)(
    'AC 33: a marked row that %s fills nothing, its offer joins as an offer only, and the public page and search are the same before and after',
    async (how) => {
      stubLocalFlag('off');
      const { collected, plain } = await unmarkedProduct();
      if (how === 'sits on it as a known offer') {
        await insertOffer({ productId: plain.id, feedId: collected.feedId, externalId: 'c-1', priceCents: 500 });
      }
      const before = await visibleTo(plain.slug);
      const productsBefore = await allProducts();
      expect(before.page?.attributes).toBeNull();

      const report = await importRows({ [collected.feedId]: [row('c-1')] }, { feedId: collected.feedId });

      expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, ownProducts: [], rejected: [] });
      expect(await allProducts()).toEqual(productsBefore);
      expect(heldOf((await allProducts())[0])).toEqual(NO_HELD);
      // Non-vacuity: the marked row's offer is stored, on the unmarked product.
      expect((await offerKinds()).map((offer) => [offer.productId, offer.kind])).toContainEqual([plain.id, 'collected_file']);
      expect(await visibleTo(plain.slug)).toEqual(before);
    },
  );

  it('AC 33: it stays so on every later import, and with the flag on the page still shows no attribute', async () => {
    stubLocalFlag('off');
    const { collected, plain } = await unmarkedProduct();
    const rows = [row('c-1')];
    await importRows({ [collected.feedId]: rows }, { feedId: collected.feedId });
    const productsBefore = await allProducts();

    const again = await importRows({ [collected.feedId]: rows }, { feedId: collected.feedId });

    expect(again.feeds[0]).toMatchObject({ offersCreated: 0, offersUpdated: 1 });
    expect(await allProducts()).toEqual(productsBefore);
    stubLocalFlag('on');
    const page = await getPublicProductBySlug(plain.slug);
    expect(page?.offers).toHaveLength(2); // the marked offer is shown with the flag on, as US-12.2 says
    expect(page?.attributes).toBeNull();
  });
});

describe('an unmarked row never gives a marked product an attribute (AC 34)', () => {
  it('AC 34, collected first: an unmarked row with the marked product\'s key and its attributes is its own plain product; the marked one holds none', async () => {
    const collected = await collectedFeed('Tienda recopilada');
    const hand = await aFeedOf('Tienda escrita a mano');
    await importRows({ [collected.feedId]: [row('c-1', BLANK_CELLS)] }, { feedId: collected.feedId });
    const [marked] = await allProducts();

    const report = await importRows({ [hand.feedId]: [row('mano-1')] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 1, ownProducts: [] });
    const [first, second] = await allProducts();
    expect(first).toEqual(marked);
    expect(heldOf(first)).toEqual(NO_HELD);
    expect(second).toMatchObject({ isCollected: false });
    expect(heldOf(second)).toEqual(OIL_HELD);
  });

  it('AC 34, unmarked first: a marked product made apart, then an unmarked row of this feed that sits on it as a known offer, gives it nothing', async () => {
    const hand = await aFeedOf('Tienda escrita a mano');
    const marked = await storedProduct({ slug: 'marcado', ...KEY, extra: { isCollected: true } });
    await insertOffer({ productId: marked.id, feedId: hand.feedId, externalId: 'mano-1', priceCents: 500 });
    const before = await allProducts();

    const report = await importRows({ [hand.feedId]: [row('mano-1')] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ offersUpdated: 1 });
    expect(await allProducts()).toEqual(before);
    expect(heldOf((await allProducts())[0])).toEqual(NO_HELD);
  });

  it('AC 34: each side keeps what its own row gave: a marked and an unmarked product of one key, re-imported with each other\'s values, never trade an attribute', async () => {
    const collected = await collectedFeed('Tienda recopilada');
    const hand = await aFeedOf('Tienda escrita a mano');
    await importRows({ [collected.feedId]: [row('c-1', OTHER_CELLS)] }, { feedId: collected.feedId });
    await importRows({ [hand.feedId]: [row('mano-1', OIL_CELLS)] }, { feedId: hand.feedId });
    const [marked, plain] = await allProducts();
    expect([marked.isCollected, plain.isCollected]).toEqual([true, false]);
    expect([heldOf(marked), heldOf(plain)]).toEqual([OTHER_HELD, OIL_HELD]);

    await importRows({ [collected.feedId]: [row('c-1', OIL_CELLS)] }, { feedId: collected.feedId });
    await importRows({ [hand.feedId]: [row('mano-1', OTHER_CELLS)] }, { feedId: hand.feedId });

    expect((await allProducts()).map(heldOf)).toEqual([OTHER_HELD, OIL_HELD]);
  });
});

describe('the local flag decides what is shown, never whether a fill happens (AC 35)', () => {
  // `on-https` is the backstop: the flag is on beside a public origin, so it counts as off on every request.
  it.each<[LocalFlagMode, boolean]>([
    ['off', false],
    ['on', true],
    ['on-https', false],
  ])('AC 35, flag %s: the marked fill happens the same, and the attributes are shown only where marked rows are shown (%s)', async (mode, shown) => {
    stubLocalFlag(mode);
    const one = await collectedFeed('Recopilada uno');
    const two = await collectedFeed('Recopilada dos');
    await mapFeed(one.feedId);
    await mapFeed(two.feedId);
    await importRows({ [one.feedId]: [row('c-1', BLANK_CELLS)] }, { feedId: one.feedId });

    const report = await importRows({ [two.feedId]: [row('c-2')] }, { feedId: two.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, rejected: [] });
    const [marked] = await allProducts();
    expect(marked.isCollected).toBe(true);
    expect(heldOf(marked)).toEqual(OIL_HELD);

    const page = await getPublicProductBySlug(marked.slug);
    if (shown) {
      expect(page?.attributes).toMatchObject({ viscosity: '10W-40', volume: '4 l', acea: ['A3/B4', 'C2'] });
      expect(slugsOf(await search(TITLE))).toEqual([marked.slug]);
    } else {
      expect(page).toBeNull();
      expect(slugsOf(await search(TITLE))).toEqual([]);
    }
    // Marked rows are never in the sitemap, flag on or off, and the held attributes do not change that.
    expect(await sitemapProducts()).toEqual([]);
  });

  it('AC 35: the same import with the flag off and on stores the same attribute values on the marked product', async () => {
    const stored: unknown[] = [];
    for (const mode of ['off', 'on'] as const) {
      await resetDatabase();
      stubLocalFlag(mode);
      const one = await collectedFeed('Recopilada uno');
      await mapFeed(one.feedId);
      await importRows({ [one.feedId]: [row('c-1', BLANK_CELLS)] }, { feedId: one.feedId });
      await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });
      stored.push(heldOf((await allProducts())[0]));
      expect((await allOffers()).length).toBe(1);
    }
    expect(stored).toEqual([OIL_HELD, OIL_HELD]);
  });
});
