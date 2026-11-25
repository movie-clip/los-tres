import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { offers, products } from '@/db/schema';
import { assignCategory, markOutsideScope } from '@/server/admin/category-mappings';
import { setOfferHidden, setProductHidden } from '@/server/admin/products';
import { listSourcesForAdmin, setFeedApproval, setShopApproval, type AdminFeed } from '@/server/admin/sources';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCollectedFeed,
  insertFeed,
  insertOffer,
  insertProduct,
  insertShop,
  setOfferRemoved,
} from '../support/catalogue';
import { categoryForm, fiveTargets } from '../support/categories';
import { resetDatabase } from '../support/db';
import { BACKSTOP_MODES, stubLocalFlag, type LocalFlagMode } from '../support/local-flag';
import { MAPPED, aFeedOf, importRows, keyRow, mapFeed } from '../support/matching';
import { stubNetworkOff } from '../support/network-off';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// US-2.6 (T-2.6.3b), ACs 2, 3, 7 to 19: the two counts of every feed and shop of `listSourcesForAdmin`,
// against the test database. The first count (`offerCount`) is the offers a feed currently has: every
// stored offer except those an import removed. The second (`onSiteOfferCount`) is the offers the public
// product page lists now. One world is built once and only read, under each mode of the local flag; the
// tests that write (approvals, hide, mapping, import) build their own shop and feed and read it by id.
// The number of reads (AC 30) is admin-sources-cost.test.ts, the notes and the rendered lines
// (ACs 1, 4 to 6, 20 to 22) are admin-source-pages.test.ts and tests/unit/sources-page-counts.test.ts,
// and `hasOffers` of /admin/categorias (AC 23) is category-mapping-read.test.ts.

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

/** The mode that shows collected rows is `on`; every other mode, the backstop included, leaves them out. */
const MODES: LocalFlagMode[] = ['off', 'on', ...BACKSTOP_MODES];

type Built = { shopId: number; feedId: number };
type FeedOptions = { shopApproved?: boolean; feedApproved?: boolean; demo?: boolean };

let serial = 0;
/** One product of its own, in the state `columns` says. A slug has no underscore. */
async function product(columns: Partial<typeof products.$inferInsert> = {}) {
  serial += 1;
  return insertProduct({ slug: `cuenta-${serial}`, ...columns });
}

/** One offer on a product of its own. */
async function addOffer(
  feedId: number,
  spec: Partial<typeof offers.$inferInsert> = {},
  columns: Partial<typeof products.$inferInsert> = {},
): Promise<number> {
  const row = await product(columns);
  return insertOffer({ productId: row.id, feedId, ...spec });
}

async function feedIn(o: FeedOptions = {}): Promise<Built> {
  const shop = await insertShop({ isApproved: o.shopApproved });
  const feedId = await insertFeed(shop.id, { isApproved: o.feedApproved, isDemo: o.demo });
  return { shopId: shop.id, feedId };
}

async function readAll() {
  const shopList = await listSourcesForAdmin();
  const feedsById = new Map<number, AdminFeed>(shopList.flatMap((shop) => shop.feeds.map((feed) => [feed.id, feed] as const)));
  return { shopList, feedsById };
}

/** [first count, second count] of one feed, from a fresh read. */
async function countsOf(feedId: number): Promise<[number, number]> {
  const feed = (await readAll()).feedsById.get(feedId);
  if (!feed) throw new Error(`feed ${feedId} is not listed`);
  return [feed.offerCount, feed.onSiteOfferCount];
}

async function shopCountsOf(shopId: number): Promise<[number, number]> {
  const shop = (await readAll()).shopList.find((candidate) => candidate.id === shopId);
  if (!shop) throw new Error(`shop ${shopId} is not listed`);
  return [shop.offerCount, shop.onSiteOfferCount];
}

// ---------------------------------------------------------------------------------------------------------------
// The world: each state alone on a feed of its own, a mixed shop, the collected rows, a shop with no feed.
// ---------------------------------------------------------------------------------------------------------------

type State = {
  name: string;
  feed?: FeedOptions;
  /** `null`: the feed has no offer at all. */
  offer?: Partial<typeof offers.$inferInsert> | null;
  product?: Partial<typeof products.$inferInsert>;
  first: number;
  onSite: number;
};

const STATES: State[] = [
  { name: 'a visible offer (control)', first: 1, onSite: 1 },
  { name: 'shop not approved (AC 8, 13)', feed: { shopApproved: false }, first: 1, onSite: 0 },
  { name: 'feed not approved (AC 8, 13)', feed: { feedApproved: false }, first: 1, onSite: 0 },
  { name: 'shop and feed not approved (AC 8, 13)', feed: { shopApproved: false, feedApproved: false }, first: 1, onSite: 0 },
  { name: 'offer removed by an import (AC 10, 13)', offer: { isRemoved: true }, first: 0, onSite: 0 },
  { name: 'offer removed and also hidden and in review (AC 10)', offer: { isRemoved: true, isHidden: true, inReview: true }, first: 0, onSite: 0 },
  { name: 'offer hidden (AC 9, 13)', offer: { isHidden: true }, first: 1, onSite: 0 },
  { name: 'offer in review (AC 9, 13)', offer: { inReview: true }, first: 1, onSite: 0 },
  { name: 'product with no category (AC 14)', product: { categoryId: null }, first: 1, onSite: 0 },
  { name: 'product hidden by an admin (AC 14)', product: { isHidden: true }, first: 1, onSite: 0 },
  { name: 'demo feed (AC 16)', feed: { demo: true }, first: 1, onSite: 1 },
  { name: 'demo feed, offer hidden (AC 16)', feed: { demo: true }, offer: { isHidden: true }, first: 1, onSite: 0 },
  { name: 'no offer at all (AC 3)', offer: null, first: 0, onSite: 0 },
];

const stateFeeds: Built[] = [];
const world: Record<string, Built & { extra?: number[] }> = {};

beforeAll(async () => {
  await resetDatabase();

  for (const state of STATES) {
    const built = await feedIn(state.feed);
    if (state.offer !== null) await addOffer(built.feedId, state.offer, state.product);
    stateFeeds.push(built);
  }

  // One shop, three feeds: the shop's counts are the sums of the three (AC 2).
  const mixed = await insertShop();
  const live = await insertFeed(mixed.id);
  const paused = await insertFeed(mixed.id, { isApproved: false });
  const bare = await insertFeed(mixed.id);
  await addOffer(live);
  await addOffer(live);
  await addOffer(live, { isHidden: true });
  await addOffer(paused);
  await addOffer(paused);
  await addOffer(paused, { inReview: true });
  world.mixed = { shopId: mixed.id, feedId: live, extra: [paused, bare] };

  // A shop with no feed at all (AC 2).
  world.noFeeds = { shopId: (await insertShop()).id, feedId: 0 };

  // The collected rows (AC 11, 14, 15).
  const collected = await insertCollectedFeed();
  await addOffer(collected.feedId);
  await addOffer(collected.feedId);
  world.collectedFeed = collected;

  const ordinary = await feedIn();
  await addOffer(ordinary.feedId, {}, { isCollected: true });
  world.collectedProduct = ordinary;

  const collectedHidden = await insertCollectedFeed();
  await addOffer(collectedHidden.feedId, { isHidden: true });
  world.collectedHidden = collectedHidden;

  const collectedUnapproved = await insertCollectedFeed({ isApproved: false });
  await addOffer(collectedUnapproved.feedId);
  world.collectedUnapproved = collectedUnapproved;

  // Two feeds on one product: only the approved one is listed on its page, the count follows each feed.
  const shared = await product();
  const sharedA = await feedIn();
  const sharedB = await feedIn({ feedApproved: false });
  await insertOffer({ productId: shared.id, feedId: sharedA.feedId });
  await insertOffer({ productId: shared.id, feedId: sharedB.feedId });
  world.sharedA = sharedA;
  world.sharedB = sharedB;
});

describe('each state alone: the first count is what the feed holds, the second what the site shows (AC 3, 7 to 14, 16)', () => {
  it.each(STATES.map((state, index) => [state.name, index] as const))('%s', async (_name, index) => {
    const state = STATES[index];
    expect(await countsOf(stateFeeds[index].feedId)).toEqual([state.first, state.onSite]);
  });

  it('a feed with no offer reads 0 and 0, numbers and not blank (AC 3)', async () => {
    const [first, onSite] = await countsOf(stateFeeds[STATES.findIndex((state) => state.offer === null)].feedId);
    expect(first).toBe(0);
    expect(onSite).toBe(0);
  });
});

describe('the first count ignores approval and counts hidden and in-review offers (AC 8, 9)', () => {
  it('an unapproved shop with an unapproved feed shows what was imported, not 0', async () => {
    const both = stateFeeds[STATES.findIndex((state) => state.name.startsWith('shop and feed not approved'))];
    expect((await countsOf(both.feedId))[0]).toBe(1);
  });

  it('counts the hidden and the in-review offer of an approved feed, and the second count leaves them out', async () => {
    // world.mixed.live: 2 visible and 1 hidden offer.
    expect(await countsOf(world.mixed.feedId)).toEqual([3, 2]);
  });
});

describe('a removed offer leaves the first count and comes back with it (AC 10)', () => {
  it('drops by one when an import removes an offer and returns when it is restored', async () => {
    const { feedId } = await feedIn();
    const keep = await addOffer(feedId);
    const flip = await addOffer(feedId);
    expect(keep).not.toBe(flip);
    expect(await countsOf(feedId)).toEqual([2, 2]);

    await setOfferRemoved(flip, true);
    expect(await countsOf(feedId)).toEqual([1, 1]);

    await setOfferRemoved(flip, false);
    expect(await countsOf(feedId)).toEqual([2, 2]);
  });

  it('every offer removed reads 0 and 0 and the feed is still listed', async () => {
    const { feedId } = await feedIn();
    await setOfferRemoved(await addOffer(feedId), true);
    await setOfferRemoved(await addOffer(feedId), true);
    expect(await countsOf(feedId)).toEqual([0, 0]);
  });
});

describe('a shop is the sum of its feeds, and 0 and 0 with no feed (AC 2)', () => {
  it('sums both counts over a feed with offers, an unapproved feed and a feed with none', async () => {
    expect(await countsOf(world.mixed.extra?.[0] as number)).toEqual([3, 0]);
    expect(await countsOf(world.mixed.extra?.[1] as number)).toEqual([0, 0]);
    expect(await shopCountsOf(world.mixed.shopId)).toEqual([6, 2]);
  });

  it('a shop with no feed shows 0 for both', async () => {
    const shop = (await readAll()).shopList.find((candidate) => candidate.id === world.noFeeds.shopId);
    expect(shop).toMatchObject({ feeds: [], offerCount: 0, onSiteOfferCount: 0 });
  });

  it.each(MODES)('every shop equals the sum of its feeds, whole numbers, in mode %s', async (mode) => {
    stubLocalFlag(mode);
    const { shopList } = await readAll();
    expect(shopList.length).toBeGreaterThanOrEqual(10);
    for (const shop of shopList) {
      expect(shop.offerCount, `${shop.name} first`).toBe(shop.feeds.reduce((sum, feed) => sum + feed.offerCount, 0));
      expect(shop.onSiteOfferCount, `${shop.name} second`).toBe(shop.feeds.reduce((sum, feed) => sum + feed.onSiteOfferCount, 0));
      for (const count of [shop.offerCount, shop.onSiteOfferCount]) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('collected rows follow the one reading of the local flag, backstop included (AC 11, 14, 15)', () => {
  it.each(MODES)('mode %s: the first count never changes, the second counts collected rows only when they are shown', async (mode) => {
    stubLocalFlag(mode);
    const shown = mode === 'on';
    const { feedsById } = await readAll();
    const pair = (built: Built) => {
      const feed = feedsById.get(built.feedId);
      return [feed?.offerCount, feed?.onSiteOfferCount];
    };
    // Two offers of a collected feed, their products ordinary (AC 11, 15).
    expect(pair(world.collectedFeed)).toEqual([2, shown ? 2 : 0]);
    // An ordinary feed whose product was made from a collected row (AC 14).
    expect(pair(world.collectedProduct)).toEqual([1, shown ? 1 : 0]);
    // Nothing else excludes these two, so the flag is the only thing that moved the second count.
    // A hidden offer of a collected feed, and a collected feed not approved, are out whatever the flag says.
    expect(pair(world.collectedHidden)).toEqual([1, 0]);
    expect(pair(world.collectedUnapproved)).toEqual([1, 0]);
  });
});

describe('the second count is never above the first, and equals what the public product pages list (AC 17, 18)', () => {
  it.each(MODES)('in mode %s, for every feed of every state built', async (mode) => {
    stubLocalFlag(mode);
    const { feedsById } = await readAll();

    // What the public product pages list now: every product the database holds, read through the public reader.
    const slugs = (await getDb().select({ slug: products.slug }).from(products)).map((row) => row.slug);
    const listed = new Set<number>();
    for (const slug of slugs) {
      for (const offer of (await getPublicProductBySlug(slug))?.offers ?? []) listed.add(offer.offerId);
    }
    const stored = await getDb().select({ id: offers.id, feedId: offers.feedId }).from(offers);

    for (const feed of feedsById.values()) {
      const own = stored.filter((offer) => offer.feedId === feed.id);
      expect(feed.onSiteOfferCount, `feed ${feed.id} second`).toBe(own.filter((offer) => listed.has(offer.id)).length);
      expect(feed.onSiteOfferCount, `feed ${feed.id} within first`).toBeLessThanOrEqual(feed.offerCount);
    }

    // Not vacuous: some offers are listed and some are not, so the equality compares two real answers.
    expect(listed.size).toBeGreaterThanOrEqual(5);
    expect(stored.length - listed.size).toBeGreaterThanOrEqual(10);
    expect([...feedsById.values()].filter((feed) => feed.onSiteOfferCount > 0 && feed.onSiteOfferCount < feed.offerCount).length).toBeGreaterThanOrEqual(1);
  });

  it('two feeds on one product: the count follows each feed, only the approved one is listed', async () => {
    expect(await countsOf(world.sharedA.feedId)).toEqual([1, 1]);
    expect(await countsOf(world.sharedB.feedId)).toEqual([1, 0]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// AC 19: the next read after each writer shows the counts of the new state. Own rows, read by id.
// ---------------------------------------------------------------------------------------------------------------

describe('after a change the next read shows the counts that apply to the new state (AC 19)', () => {
  it('disabling and approving a feed moves the second count of the feed and its shop, and not the first', async () => {
    const { shopId, feedId } = await feedIn();
    await addOffer(feedId);
    await addOffer(feedId);
    expect(await countsOf(feedId)).toEqual([2, 2]);

    await setFeedApproval(feedId, false);
    expect(await countsOf(feedId)).toEqual([2, 0]);
    expect(await shopCountsOf(shopId)).toEqual([2, 0]);

    await setFeedApproval(feedId, true);
    expect(await countsOf(feedId)).toEqual([2, 2]);
    expect(await shopCountsOf(shopId)).toEqual([2, 2]);
  });

  it('disabling and approving a shop moves the second count of each of its approved feeds, and not the first', async () => {
    const shop = await insertShop();
    const one = await insertFeed(shop.id);
    const two = await insertFeed(shop.id);
    await addOffer(one);
    await addOffer(two);
    await addOffer(two);
    expect(await shopCountsOf(shop.id)).toEqual([3, 3]);

    await setShopApproval(shop.id, false);
    expect(await countsOf(one)).toEqual([1, 0]);
    expect(await countsOf(two)).toEqual([2, 0]);
    expect(await shopCountsOf(shop.id)).toEqual([3, 0]);

    await setShopApproval(shop.id, true);
    expect(await shopCountsOf(shop.id)).toEqual([3, 3]);
  });

  it('hiding and unhiding an offer, then its product, moves the second count and not the first', async () => {
    const { feedId } = await feedIn();
    const hiddenOffer = await addOffer(feedId);
    const other = await product();
    await insertOffer({ productId: other.id, feedId });
    expect(await countsOf(feedId)).toEqual([2, 2]);

    await setOfferHidden(hiddenOffer, true);
    expect(await countsOf(feedId)).toEqual([2, 1]);
    await setOfferHidden(hiddenOffer, false);
    expect(await countsOf(feedId)).toEqual([2, 2]);

    await setProductHidden(other.id, true);
    expect(await countsOf(feedId)).toEqual([2, 1]);
    await setProductHidden(other.id, false);
    expect(await countsOf(feedId)).toEqual([2, 2]);
  });

  it('saving a category mapping moves the second count of a feed whose product had no category', async () => {
    const [target] = await fiveTargets();
    const { feedId } = await feedIn();
    const unmapped = await product({ categoryId: null });
    await insertOffer({ productId: unmapped.id, feedId, feedCategory: 'Filtros de aceite' });
    expect(await countsOf(feedId)).toEqual([1, 0]);

    await assignCategory(categoryForm({ feedId, feedCategory: 'Filtros de aceite', target: target.id }));
    expect(await countsOf(feedId)).toEqual([1, 1]);

    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Filtros de aceite' }));
    expect(await countsOf(feedId)).toEqual([1, 0]);
  });

  describe('an import', () => {
    beforeEach(() => {
      stubNetworkOff();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const ids = (count: number) => Array.from({ length: count }, (_, i) => `r${i + 1}`);
    const rows = (count: number) => ids(count).map((id) => keyRow(id, { category: MAPPED }));

    it('that drops rows lowers both counts, and one that has them again raises both', async () => {
      const feed = await aFeedOf('Tienda Importada');
      await mapFeed(feed.feedId);

      await importRows({ [feed.feedId]: rows(10) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([10, 10]);

      // Four of ten missing: under the removal guard, so the pass runs.
      await importRows({ [feed.feedId]: rows(6) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([6, 6]);

      await importRows({ [feed.feedId]: rows(10) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([10, 10]);
    });

    it('into an unapproved shop reads the imported number and 0 on the site, through a removal and a restore', async () => {
      const feed = await aFeedOf('Tienda Sin Aprobar', { shopApproved: false });
      await mapFeed(feed.feedId);

      await importRows({ [feed.feedId]: rows(10) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([10, 0]);

      await importRows({ [feed.feedId]: rows(6) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([6, 0]);

      await importRows({ [feed.feedId]: rows(10) }, { feedId: feed.feedId });
      expect(await countsOf(feed.feedId)).toEqual([10, 0]);

      await setShopApproval(feed.shopId, true);
      expect(await countsOf(feed.feedId)).toEqual([10, 10]);
    });
  });
});
