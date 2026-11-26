import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { formatImportReport } from '@/server/importer';

import { allOffers, allProducts, insertOffer } from '../support/catalogue';
import { fiveTargets, sitemapProducts } from '../support/categories';
import { resetDatabase } from '../support/db';
import { stubLocalFlag, type LocalFlagMode } from '../support/local-flag';
import { EAN, MAPPED, aFeedOf, importRows, keyRow, mapFeed, storedProduct } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard (0006, rule 4): the file runs real imports.
vi.setConfig({ testTimeout: 30_000 });

// S7.6 (US-7.6) ACs 8 to 11, the collected wall (D-3, D-17; US-12.2 ACs 28, 29, 31, 32 kept): a marked
// row (a row of a collected feed) gives an EAN to a marked product only, an unmarked row to an unmarked
// one only, and the local flag decides what is shown, never whether a fill happens. In the pattern of
// collected-import.test.ts. Every shop, product and link is invented.

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
const OTHER_KEY = { brand: 'Beta', part: 'CD-200' };

const collectedFeed = (name?: string) => aFeedOf(name, { sourceType: 'collected_file' });
const row = (id: string, o: { ean?: string; key?: { brand: string; part: string } } = {}) =>
  keyRow(id, { ...(o.key ?? KEY), ean: o.ean, price: '5.00', category: MAPPED });

type Report = Awaited<ReturnType<typeof importRows>>;
const eanLines = (report: Report) => formatImportReport(report).split('\n').filter((line) => /^ {2}ean:/.test(line));

const search = (raw: string) => getPublicSearchPage(parseSearchTerm(raw), 1);
const slugsOf = (result: Awaited<ReturnType<typeof search>>) =>
  result?.state === 'results' ? result.products.map((card) => card.slug) : [];

/** The offers joined to the source kind of their feed: how a marked offer is read. */
async function offerKinds() {
  return getDb()
    .select({ productId: offers.productId, externalId: offers.externalId, kind: feeds.sourceType })
    .from(offers)
    .innerJoin(feeds, eq(feeds.id, offers.feedId))
    .orderBy(offers.id);
}

describe('a marked row fills a marked product (AC 8)', () => {
  it('AC 8: two collected feeds converge on one marked product with no EAN; a later collected row with an EAN fills it', async () => {
    const one = await collectedFeed('Recopilada uno');
    const two = await collectedFeed('Recopilada dos');
    const three = await collectedFeed('Recopilada tres');
    for (const feed of [one, two, three]) await mapFeed(feed.feedId);
    await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });
    await importRows({ [two.feedId]: [row('c-2')] }, { feedId: two.feedId });
    expect(await allProducts()).toMatchObject([{ isCollected: true, ean: null, eanNormalised: null }]);
    const before = await allProducts();

    const report = await importRows({ [three.feedId]: [row('c-3', { ean: EAN.one })] }, { feedId: three.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, ownProducts: [], rejected: [], eanFilled: 1 });
    expect(eanLines(report)).toEqual(['  ean: filled=1']);
    expect(await allProducts()).toEqual([{ ...before[0], ean: EAN.one, eanNormalised: EAN.one }]);
    expect((await allProducts())[0].isCollected).toBe(true);
  });

  it('AC 8: the next import of a known collected offer whose row now carries an EAN fills its marked product', async () => {
    const one = await collectedFeed('Recopilada uno');
    await mapFeed(one.feedId);
    await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });
    const before = await allProducts();

    const report = await importRows({ [one.feedId]: [row('c-1', { ean: EAN.one })] }, { feedId: one.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1, eanFilled: 1 });
    expect(await allProducts()).toEqual([{ ...before[0], ean: EAN.one, eanNormalised: EAN.one }]);
  });
});

describe('a marked row never fills an unmarked product (AC 9; US-12.2 AC 29)', () => {
  /** An unmarked product with no EAN, public with the flag off; the marked row reaches it as a join or as a known offer. */
  async function unmarkedProduct() {
    const hand = await aFeedOf('Tienda escrita a mano');
    const collected = await collectedFeed('Tienda recopilada');
    await mapFeed(hand.feedId);
    await mapFeed(collected.feedId);
    await importRows({ [hand.feedId]: [row('mano-1')] }, { feedId: hand.feedId });
    const [plain] = await allProducts();
    return { collected, plain };
  }

  const visibleTo = async (slug: string) => {
    const page = await getPublicProductBySlug(slug);
    return { page, jsonLd: page ? buildProductJsonLd(page) : null, byEan: await search(EAN.one) };
  };

  it.each(['joins it by its key', 'sits on it as a known offer'] as const)('AC 9: a marked row that %s fills nothing, and the public page, structured data and search are the same before and after', async (how) => {
    stubLocalFlag('off');
    const { collected, plain } = await unmarkedProduct();
    if (how === 'sits on it as a known offer') {
      await insertOffer({ productId: plain.id, feedId: collected.feedId, externalId: 'c-1', priceCents: 500 });
    }
    const before = await visibleTo(plain.slug);
    const productsBefore = await allProducts();
    expect(before.page?.ean).toBeNull();
    expect(before.byEan).toMatchObject({ state: 'no-results' });

    const report = await importRows({ [collected.feedId]: [row('c-1', { ean: EAN.one })] }, { feedId: collected.feedId });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 0, ownProducts: [], rejected: [], eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
    // Non-vacuity: the marked row's offer is stored, on the unmarked product.
    expect((await offerKinds()).map((offer) => [offer.productId, offer.kind])).toContainEqual([plain.id, 'collected_file']);
    const after = await visibleTo(plain.slug);
    expect(after).toEqual(before);
    expect(after.jsonLd).not.toHaveProperty('gtin');
    expect(after.byEan).toMatchObject({ state: 'no-results' });
  });

  it('AC 9: it stays so on every later import, flag off or on, and with the flag on the page still shows no EAN', async () => {
    stubLocalFlag('off');
    const { collected, plain } = await unmarkedProduct();
    const rows = [row('c-1', { ean: EAN.one })];
    await importRows({ [collected.feedId]: rows }, { feedId: collected.feedId });
    const productsBefore = await allProducts();

    const again = await importRows({ [collected.feedId]: rows }, { feedId: collected.feedId });

    expect(again.feeds[0]).toMatchObject({ offersCreated: 0, offersUpdated: 1, eanFilled: 0 });
    expect(eanLines(again)).toEqual([]);
    expect(await allProducts()).toEqual(productsBefore);
    stubLocalFlag('on');
    const page = await getPublicProductBySlug(plain.slug);
    expect(page?.offers).toHaveLength(2); // the marked offer is shown, as US-12.2 AC 29 says
    expect(page?.ean).toBeNull();
    expect(await search(EAN.one)).toMatchObject({ state: 'no-results' });
  });
});

describe('an unmarked row never gives a marked product an EAN (AC 10)', () => {
  it('AC 10, collected first: an unmarked row with the marked product\'s key and an EAN is its own plain product, and the marked one keeps none', async () => {
    const collected = await collectedFeed('Tienda recopilada');
    const hand = await aFeedOf('Tienda escrita a mano');
    await importRows({ [collected.feedId]: [row('c-1')] }, { feedId: collected.feedId });
    const [marked] = await allProducts();

    const report = await importRows({ [hand.feedId]: [row('mano-1', { ean: EAN.one })] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 1, ownProducts: [], eanFilled: 0 });
    expect(eanLines(report)).toEqual([]);
    const [first, second] = await allProducts();
    expect(first).toEqual(marked);
    expect(first).toMatchObject({ isCollected: true, ean: null, eanNormalised: null });
    expect(second).toMatchObject({ isCollected: false, eanNormalised: EAN.one });
    expect((await allOffers()).map((offer) => [offer.productId, offer.feedId])).toEqual([
      [first.id, collected.feedId],
      [second.id, hand.feedId],
    ]);
  });

  it('AC 10, unmarked first: the same rows in the other order leave the marked product with no EAN as well', async () => {
    const hand = await aFeedOf('Tienda escrita a mano');
    const collected = await collectedFeed('Tienda recopilada');
    await importRows({ [hand.feedId]: [row('mano-1', { ean: EAN.one })] }, { feedId: hand.feedId });
    // A marked product apart from the plain one: its own key, so the collected row creates it.
    await importRows({ [collected.feedId]: [row('c-1', { key: OTHER_KEY })] }, { feedId: collected.feedId });
    const before = await allProducts();
    expect(before.map((product) => product.isCollected)).toEqual([false, true]);

    // The hand feed is imported again with a row of the marked product's key and another EAN.
    const report = await importRows(
      { [hand.feedId]: [row('mano-1', { ean: EAN.one }), row('mano-2', { key: OTHER_KEY, ean: EAN.two })] },
      { feedId: hand.feedId },
    );

    expect(report.feeds[0]).toMatchObject({ productsCreated: 1, offersCreated: 1, offersUpdated: 1, ownProducts: [], eanFilled: 0 });
    const after = await allProducts();
    expect(after[1]).toEqual(before[1]);
    expect(after[1]).toMatchObject({ isCollected: true, ean: null });
    expect(after[2]).toMatchObject({ isCollected: false, eanNormalised: EAN.two });
  });

  it('AC 10: a known unmarked offer that sits on a marked product fills nothing, whatever EAN its row carries', async () => {
    const hand = await aFeedOf('Tienda escrita a mano');
    const marked = await storedProduct({ slug: 'marcado', ...KEY, extra: { isCollected: true } });
    await insertOffer({ productId: marked.id, feedId: hand.feedId, externalId: 'mano-1', priceCents: 500 });
    const before = await allProducts();

    const report = await importRows({ [hand.feedId]: [row('mano-1', { ean: EAN.one })] }, { feedId: hand.feedId });

    expect(report.feeds[0]).toMatchObject({ offersUpdated: 1, eanFilled: 0 });
    expect(await allProducts()).toEqual(before);
  });
});

describe('the local flag decides what is shown, never whether a fill happens (AC 11)', () => {
  // `on-https` is the backstop: the flag is on beside a public origin, so it counts as off on every request.
  it.each<[LocalFlagMode, boolean]>([
    ['off', false],
    ['on', true],
    ['on-https', false],
  ])('AC 11, flag %s: the marked fill happens the same, and the EAN is shown only where marked rows are shown (%s)', async (mode, shown) => {
    stubLocalFlag(mode);
    const one = await collectedFeed('Recopilada uno');
    const two = await collectedFeed('Recopilada dos');
    await mapFeed(one.feedId);
    await mapFeed(two.feedId);
    const [target] = await fiveTargets();
    await importRows({ [one.feedId]: [row('c-1')] }, { feedId: one.feedId });

    const report = await importRows({ [two.feedId]: [row('c-2', { ean: EAN.one })] }, { feedId: two.feedId });

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1, eanFilled: 1 });
    expect(eanLines(report)).toEqual(['  ean: filled=1']);
    const [marked] = await allProducts();
    expect(marked).toMatchObject({ isCollected: true, ean: EAN.one, eanNormalised: EAN.one });

    const page = await getPublicProductBySlug(marked.slug);
    const listing = await getPublicCategoryPage(target.slug, 1, null, 'price-asc');
    if (shown) {
      expect(page?.ean).toBe(EAN.one);
      expect(slugsOf(await search(EAN.one))).toEqual([marked.slug]);
    } else {
      expect(page).toBeNull();
      expect(await search(EAN.one)).toMatchObject({ state: 'no-results' });
      expect(listing?.products.map((card) => card.slug) ?? []).not.toContain(marked.slug);
    }
    // Marked rows are never in the sitemap, flag on or off, and the filled EAN does not change that.
    expect(await sitemapProducts()).toEqual([]);
  });

  it('AC 11: with the flag off the filled marked product is found by nothing public, not by its title either', async () => {
    stubLocalFlag('off');
    const one = await collectedFeed('Recopilada uno');
    await mapFeed(one.feedId);
    await importRows({ [one.feedId]: [keyRow('c-1', { ...KEY, title: 'Titulo recopilado secreto', category: MAPPED })] }, { feedId: one.feedId });
    await importRows({ [one.feedId]: [keyRow('c-1', { ...KEY, title: 'Titulo recopilado secreto', ean: EAN.one, category: MAPPED })] }, { feedId: one.feedId });

    expect((await allProducts())[0]).toMatchObject({ eanNormalised: EAN.one });
    expect(await search('secreto')).toMatchObject({ state: 'no-results' });
    expect(await search(EAN.one)).toMatchObject({ state: 'no-results' });
  });
});
