import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { listProductsForAdmin, readProductForAdmin } from '@/server/admin/products';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import {
  NOT_PUBLIC_REASONS,
  offerNotPublicReasonSql,
  offerRules,
  productNotPublicReasonSql,
  productRules,
  reasonCaseSql,
  visibleOfferWhere,
  visibleProductWhere,
  type NotPublicReason,
} from '@/server/visibility';

import { defaultCategoryId, insertCollectedFeed, insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { allRows } from '../support/hide';
import { BACKSTOP_MODES, stubLocalFlag, type LocalFlagMode } from '../support/local-flag';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// The one seam the shipped reason builders offer for the guard (AC 8): each reads the local flag once for its rule
// tables and once more through each public builder it asks, so a queue of readings makes the public side disagree with
// the tables for one build and nothing else. With the queue empty (every other test of this file) the real reading
// answers, so the environment stubs of `stubLocalFlag` keep working. The queue is armed and emptied inside
// `withFlagReadings`, around a synchronous build, so no other reader can take a value from it.
const flag = vi.hoisted(() => ({ readings: [] as boolean[] }));
vi.mock('@/config/local-flag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/local-flag')>();
  return {
    ...actual,
    collectedRowsShown: (env?: Parameters<typeof actual.collectedRowsShown>[0]) => {
      const next = flag.readings.shift();
      return next === undefined ? actual.collectedRowsShown(env) : next;
    },
  };
});

/** Builds with the next flag readings fixed, in the order the builder reads them; the queue is empty again after. */
function withFlagReadings<T>(readings: boolean[], build: () => T): T {
  flag.readings = [...readings];
  try {
    return build();
  } finally {
    flag.readings = [];
  }
}

// US-2.5 (T-2.5.3b), ACs 5, 7, 8, 10 to 27: the reason an admin row reads No, against the test database, through
// the two real admin reads (the list and the product with its offers). Every row is compared with the public
// product page for the same slug (AC 7), so the reason is null exactly when the public site shows the row.
// The fixtures share one world per describe (04-design § Risks in detail): the first world is built once and only
// read, under different settings of the local flag; the peel builds its own rows and puts them back before each walk.
// The hide writers' answers (ACs 28, 29) are in admin-product-actions.test.ts and admin-product-writer.test.ts,
// the pages in admin-product-pages.test.ts.

afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const FIRST_PAGE = { term: '', hiddenOnly: false, page: 1 } as const;

type Built = { id: number; offerIds: number[] };
type OfferSpec = { feedId: number } & Partial<typeof offers.$inferInsert>;

/** A slug has no underscore: the key `o-shop_not_approved` is the slug `o-shop-not-approved`. */
const slugOf = (key: string): string => key.replace(/_/g, '-');

/** One product and its offers; returns the ids in the order the offers were given. */
async function build(key: string, offerSpecs: OfferSpec[], columns: Partial<typeof products.$inferInsert> = {}): Promise<Built> {
  const product = await insertProduct({ slug: slugOf(key), ...columns });
  const offerIds: number[] = [];
  for (const spec of offerSpecs) offerIds.push(await insertOffer({ productId: product.id, ...spec }));
  return { id: product.id, offerIds };
}

const feedWith = async (o: { shopApproved?: boolean; feedApproved?: boolean }) => {
  const shop = await insertShop({ isApproved: o.shopApproved });
  return insertFeed(shop.id, { isApproved: o.feedApproved });
};

/** Every product of the list with its offers, as the admin screens read them. */
async function readAll() {
  const list = await listProductsForAdmin(FIRST_PAGE);
  expect(list.total).toBeLessThanOrEqual(list.pageSize);
  return Promise.all(
    list.rows.map(async (row) => {
      const detail = await readProductForAdmin(row.id);
      if (!detail) throw new Error(`no detail for ${row.slug}`);
      return { row, detail };
    }),
  );
}

/** AC 7: a product shows a reason exactly when the public page does not answer, an offer exactly when it is not listed. */
async function expectAgreeWithPublicPage(): Promise<{ products: number; offers: number }> {
  let offersChecked = 0;
  const all = await readAll();
  for (const { row, detail } of all) {
    const page = await getPublicProductBySlug(row.slug);
    expect(row.reason === null, `${row.slug} list`).toBe(page !== null);
    expect(row.publicNow, `${row.slug} publicNow`).toBe(row.reason === null);
    expect(detail.reason, `${row.slug} detail`).toBe(row.reason);
    const listed = new Set((page?.offers ?? []).map((offer) => offer.offerId));
    for (const offer of detail.offers) {
      expect(offer.reason === null, `${row.slug} offer ${offer.id}`).toBe(listed.has(offer.id));
      expect(offer.publicNow, `${row.slug} offer ${offer.id} publicNow`).toBe(offer.reason === null);
      offersChecked += 1;
    }
  }
  return { products: all.length, offers: offersChecked };
}

// ---------------------------------------------------------------------------------------------------------------
// World 1: each cause alone, several causes across the offers of one product, and the collected rows.
// ---------------------------------------------------------------------------------------------------------------

const world: Record<string, Built> = {};
const read = async (slug: string) => {
  const detail = await readProductForAdmin(world[slug].id);
  if (!detail) throw new Error(`no product ${slug}`);
  return detail;
};
const offerReasons = (detail: Awaited<ReturnType<typeof read>>, ids: number[]) =>
  ids.map((id) => detail.offers.find((offer) => offer.id === id)?.reason);

beforeAll(async () => {
  await resetDatabase();
  const live = await feedWith({});
  const shopOff = await feedWith({ shopApproved: false });
  const feedOff = await feedWith({ feedApproved: false });
  const bothOff = await feedWith({ shopApproved: false, feedApproved: false });
  const collected = await insertCollectedFeed();
  const collectedFeedOff = await insertCollectedFeed({ isApproved: false });

  // One cause on one offer of one product.
  world['o-shop_not_approved'] = await build('o-shop_not_approved', [{ feedId: shopOff }]);
  world['o-feed_not_approved'] = await build('o-feed_not_approved', [{ feedId: feedOff }]);
  world['o-collected'] = await build('o-collected', [{ feedId: collected.feedId }]);
  world['o-removed'] = await build('o-removed', [{ feedId: live, isRemoved: true }]);
  world['o-hidden'] = await build('o-hidden', [{ feedId: live, isHidden: true }]);
  world['o-in_review'] = await build('o-in_review', [{ feedId: live, inReview: true }]);

  // One cause on the product, its offer fine.
  world['p-no_category'] = await build('p-no_category', [{ feedId: live }], { categoryId: null });
  world['p-collected'] = await build('p-collected', [{ feedId: live }], { isCollected: true });
  world['p-hidden'] = await build('p-hidden', [{ feedId: live }], { isHidden: true });
  world['p-no_offers'] = await build('p-no_offers', []);
  world['p-public'] = await build('p-public', [{ feedId: live }, { feedId: live, priceCents: 2000 }]);

  // Several offers, each with causes of its own: the product names the lowest-ranked cause of any of them (AC 20).
  world['r-removed-first'] = await build('r-removed-first', [
    { feedId: live, isHidden: true },
    { feedId: live, isRemoved: true },
    { feedId: live, inReview: true },
  ]);
  world['r-hidden-first'] = await build('r-hidden-first', [
    { feedId: live, isHidden: true },
    { feedId: live, inReview: true },
  ]);
  world['r-shop-first'] = await build('r-shop-first', [
    { feedId: feedOff },
    { feedId: live, isHidden: true },
    { feedId: shopOff },
  ]);
  world['r-shop-and-feed'] = await build('r-shop-and-feed', [{ feedId: bothOff }, { feedId: feedOff }]);
  world['r-one-offer-many'] = await build('r-one-offer-many', [
    { feedId: live, isRemoved: true, isHidden: true, inReview: true },
    { feedId: live, isHidden: true },
  ]);
  world['r-one-public'] = await build('r-one-public', [{ feedId: live }, { feedId: live, isHidden: true }]);

  // Collected rows (AC 26, 27).
  world['c-both'] = await build('c-both', [{ feedId: collected.feedId }], { isCollected: true });
  world['c-feed-off'] = await build('c-feed-off', [{ feedId: collectedFeedOff.feedId }]);
  world['c-hidden'] = await build('c-hidden', [{ feedId: collected.feedId, isHidden: true }]);
});

describe('each cause alone on an offer: the offer row and its product name it (AC 10 to 15, 20)', () => {
  const CASES: [string, string, string][] = [
    ['shop_not_approved', 'offer_shop_not_approved', 'offers_shop_not_approved'],
    ['feed_not_approved', 'offer_feed_not_approved', 'offers_feed_not_approved'],
    ['collected', 'offer_collected', 'offers_collected'],
    ['removed', 'offer_removed', 'offers_removed'],
    ['hidden', 'offer_hidden', 'offers_hidden'],
    ['in_review', 'offer_in_review', 'offers_in_review'],
  ];

  it.each(CASES)('%s: the offer reads %s and its only-offer product reads %s', async (cause, offerCode, productCode) => {
    const detail = await read(`o-${cause}`);
    expect(detail.offers).toHaveLength(1);
    expect(detail.offers[0]).toMatchObject({ publicNow: false, reason: offerCode, hidden: cause === 'hidden' });
    expect(detail).toMatchObject({ publicNow: false, reason: productCode, hidden: false });
    const listed = (await listProductsForAdmin(FIRST_PAGE)).rows.find((row) => row.slug === slugOf(`o-${cause}`));
    expect(listed?.reason).toBe(productCode);
  });
});

describe('each cause alone on a product, its offer fine: the offer row names the product (AC 16 to 19, 21)', () => {
  const CASES: [string, string][] = [
    ['no_category', 'product_no_category'],
    ['collected', 'product_collected'],
    ['hidden', 'product_hidden'],
  ];

  it.each(CASES)('%s: the product and its fine offer both read %s', async (cause, code) => {
    const detail = await read(`p-${cause}`);
    expect(detail).toMatchObject({ publicNow: false, reason: code });
    expect(detail.offers).toHaveLength(1);
    // The offer is fine on its own flags, shop and feed: it only reads the product's reason, and its own tag is unchanged.
    expect(detail.offers[0]).toMatchObject({ publicNow: false, reason: code, hidden: false });
  });

  it('a product with no offer at all says so, and has no offer rows to name anything (AC 21)', async () => {
    const detail = await read('p-no_offers');
    expect(detail).toMatchObject({ publicNow: false, reason: 'product_no_offers', offers: [] });
  });

  it('a public product and its offers read no reason (AC 4)', async () => {
    const detail = await read('p-public');
    expect(detail).toMatchObject({ publicNow: true, reason: null });
    expect(detail.offers).toHaveLength(2);
    for (const offer of detail.offers) expect(offer).toMatchObject({ publicNow: true, reason: null });
  });
});

describe('several offers with causes of their own: the product names the lowest-ranked cause of any (AC 20, 23)', () => {
  const CASES: [string, NotPublicReason, (NotPublicReason | null)[]][] = [
    ['r-removed-first', 'offers_removed', ['offer_hidden', 'offer_removed', 'offer_in_review']],
    ['r-hidden-first', 'offers_hidden', ['offer_hidden', 'offer_in_review']],
    ['r-shop-first', 'offers_shop_not_approved', ['offer_feed_not_approved', 'offer_hidden', 'offer_shop_not_approved']],
    ['r-shop-and-feed', 'offers_shop_not_approved', ['offer_shop_not_approved', 'offer_feed_not_approved']],
    // The first offer has three causes of its own (its first is "removed"), the second one (hidden, ranked after it).
    ['r-one-offer-many', 'offers_removed', ['offer_removed', 'offer_hidden']],
  ];

  it.each(CASES)('%s: the product reads %s and the offers read %j, each its own first cause', async (slug, productCode, offerCodes) => {
    const detail = await read(slug);
    expect(detail).toMatchObject({ publicNow: false, reason: productCode });
    expect(offerReasons(detail, world[slug].offerIds)).toEqual(offerCodes);
  });

  it('a product with one public offer reads no reason, and its hidden offer still names itself (AC 5, 25)', async () => {
    const detail = await read('r-one-public');
    expect(detail).toMatchObject({ publicNow: true, reason: null });
    expect(offerReasons(detail, world['r-one-public'].offerIds)).toEqual([null, 'offer_hidden']);
    expect(detail.offers.map((offer) => offer.hidden).sort()).toEqual([false, true]);
  });
});

describe('the reason agrees with the public product page, for every state built (AC 5, 7)', () => {
  it('is null exactly when the page answers with the product, and for an offer exactly when it lists it', async () => {
    const counts = await expectAgreeWithPublicPage();
    // Not vacuous: the world holds many states, public and not, and most offers are checked.
    expect(counts.products).toBeGreaterThanOrEqual(18);
    expect(counts.offers).toBeGreaterThanOrEqual(25);
    const all = await readAll();
    expect(all.filter(({ row }) => row.reason === null).length).toBeGreaterThanOrEqual(2);
    expect(all.filter(({ row }) => row.reason !== null).length).toBeGreaterThanOrEqual(15);
    // Every code of the closed set is a member of it: nothing outside it ever reaches a row.
    for (const { row, detail } of all) {
      for (const code of [row.reason, ...detail.offers.map((offer) => offer.reason)]) {
        if (code !== null) expect(NOT_PUBLIC_REASONS, row.slug).toContain(code);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The local flag (AC 26, 27): the same rows read through every mode, one declaration per mode.
// ---------------------------------------------------------------------------------------------------------------

describe('collected rows follow the one reading of the local flag, backstop included (AC 26, 27)', () => {
  const MODES: LocalFlagMode[] = ['on', 'off', ...BACKSTOP_MODES];

  it.each(MODES)('mode %s: collected rows read their codes unless rows are shown, and the other causes stay', async (mode) => {
    stubLocalFlag(mode);
    const shown = mode === 'on';
    const expected: Record<string, { product: NotPublicReason | null; offers: (NotPublicReason | null)[] }> = {
      // An offer of a collected feed, its product not collected.
      'o-collected': { product: shown ? null : 'offers_collected', offers: [shown ? null : 'offer_collected'] },
      // A collected product, its offer from an ordinary feed.
      'p-collected': { product: shown ? null : 'product_collected', offers: [shown ? null : 'product_collected'] },
      // Both marked: the product's own rule ranks before its offers.
      'c-both': { product: shown ? null : 'product_collected', offers: [shown ? null : 'offer_collected'] },
      // The feed is not approved: that cause ranks before the collected one, flag or no flag.
      'c-feed-off': { product: 'offers_feed_not_approved', offers: ['offer_feed_not_approved'] },
      // A hidden offer of a collected feed: collected ranks before hidden, so the flag changes which is named.
      'c-hidden': { product: shown ? 'offers_hidden' : 'offers_collected', offers: [shown ? 'offer_hidden' : 'offer_collected'] },
    };
    for (const [slug, want] of Object.entries(expected)) {
      const detail = await read(slug);
      expect(detail.reason, `${slug} product`).toBe(want.product);
      expect(offerReasons(detail, world[slug].offerIds), `${slug} offers`).toEqual(want.offers);
      expect(detail.publicNow, `${slug} publicNow`).toBe(want.product === null);
    }
    // A collected row that reads Yes is shown by the public page too (and one that reads No is not).
    await expectAgreeWithPublicPage();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The guard (D-14, ACs 8, 9): a No row no table names reads `unknown`, never a blank.
// ---------------------------------------------------------------------------------------------------------------

describe('a row that reads No for a cause no rule names reads unknown, never a blank (AC 8, D-14)', () => {
  const db = () => getDb();
  const offerBranches = () =>
    offerRules().map((rule) => ({ failing: sql`not (${rule.holds})`, code: sql.raw(`'${rule.cause}'`) }));
  const productBranches = () =>
    productRules()
      .filter((rule) => rule.cause !== 'has_visible_offer')
      .map((rule) => ({ failing: sql`not (${rule.holds})`, code: sql.raw(`'${rule.cause}'`) }));

  async function offerReason(id: number, isPublic: SQL): Promise<string | null> {
    const [row] = await db()
      .select({ reason: sql<string | null>`${reasonCaseSql(offerBranches(), isPublic)}` })
      .from(offers)
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(products, eq(offers.productId, products.id))
      .where(eq(offers.id, id));
    return row.reason;
  }

  async function productReason(id: number, isPublic: SQL): Promise<string | null> {
    const [row] = await db()
      .select({ reason: sql<string | null>`${reasonCaseSql(productBranches(), isPublic)}` })
      .from(products)
      .where(eq(products.id, id));
    return row.reason;
  }

  it('reads unknown for a public offer once a condition outside the table is added to the public side', async () => {
    const id = world['p-public'].offerIds[0];
    // Control: the real public condition says public, so there is no reason.
    expect(await offerReason(id, visibleOfferWhere())).toBeNull();
    for (const outside of [sql`false`, sql`null`, gt(offers.priceCents, 99_999_999)]) {
      expect(await offerReason(id, and(visibleOfferWhere(), outside) as SQL)).toBe('unknown');
    }
  });

  it('reads unknown for a public product once a condition outside the table is added to the public side', async () => {
    const id = world['p-public'].id;
    expect(await productReason(id, visibleProductWhere())).toBeNull();
    for (const outside of [sql`false`, sql`null`, gt(products.id, 99_999_999)]) {
      expect(await productReason(id, and(visibleProductWhere(), outside) as SQL)).toBe('unknown');
    }
  });

  it('keeps a named cause named when the public side also fails for another: unknown is only the fallback', async () => {
    expect(await offerReason(world['o-hidden'].offerIds[0], and(visibleOfferWhere(), sql`false`) as SQL)).toBe('hidden');
    expect(await productReason(world['p-hidden'].id, and(visibleProductWhere(), sql`false`) as SQL)).toBe('hidden');
    expect(await offerReason(world['o-shop_not_approved'].offerIds[0], visibleOfferWhere())).toBe('shop_not_approved');
    expect(await productReason(world['p-no_category'].id, visibleProductWhere())).toBe('no_category');
  });
});

// The same guard through the builders as they ship (CR-1): `offerNotPublicReasonSql` and `productNotPublicReasonSql`
// read the flag for their tables and again for the public builders their fallback tests. A reading that differs
// between the two makes a row the public builders call not public while no table rule names a cause, which is a
// condition added outside the tables as far as the CASE can tell. The tests above pin `reasonCaseSql`; these pin
// that the builders hand it the public builders.
describe('the shipped reason builders read unknown, never a blank, when the public side disagrees with the tables (AC 8, D-14)', () => {
  const db = () => getDb();

  async function offerReasonOf(offerId: number, readings: boolean[]): Promise<string | null> {
    const reason = withFlagReadings(readings, () => offerNotPublicReasonSql());
    const [row] = await db()
      .select({ reason: sql<string | null>`${reason}` })
      .from(offers)
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(products, eq(offers.productId, products.id))
      .where(eq(offers.id, offerId));
    return row.reason;
  }

  async function productReasonOf(productId: number, readings: boolean[]): Promise<string | null> {
    const reason = withFlagReadings(readings, () => productNotPublicReasonSql());
    const [row] = await db()
      .select({ reason: sql<string | null>`${reason}` })
      .from(products)
      .where(eq(products.id, productId));
    return row.reason;
  }

  // The offer builder reads the flag three times (its tables, the public offer scope, the public product scope),
  // the product builder twice (its tables, the public product scope): `true` shows collected rows, `false` hides them.
  const SHOWN = true;
  const HIDDEN = false;

  it('an offer of a collected feed reads unknown when only the public offer scope hides it, and when no table does', async () => {
    const id = world['o-collected'].offerIds[0];
    // Controls on the same row: every reading agreeing gives no reason (shown) and the named cause (hidden).
    expect(await offerReasonOf(id, [SHOWN, SHOWN, SHOWN])).toBeNull();
    expect(await offerReasonOf(id, [HIDDEN, HIDDEN, HIDDEN])).toBe('offer_collected');
    expect(await offerReasonOf(id, [SHOWN, HIDDEN, SHOWN])).toBe('unknown');
  });

  it('an offer of a collected product reads unknown when only the public product scope hides it', async () => {
    const id = world['p-collected'].offerIds[0];
    expect(await offerReasonOf(id, [SHOWN, SHOWN, SHOWN])).toBeNull();
    expect(await offerReasonOf(id, [HIDDEN, HIDDEN, HIDDEN])).toBe('product_collected');
    expect(await offerReasonOf(id, [SHOWN, SHOWN, HIDDEN])).toBe('unknown');
    // The public offer scope alone does not hide this offer (its feed is ordinary), so the halves are independent.
    expect(await offerReasonOf(id, [SHOWN, HIDDEN, SHOWN])).toBeNull();
  });

  it('a product reads unknown when only its public scope hides it, whether the collected rule is its own or its offer\'s', async () => {
    for (const [slug, named] of [
      ['p-collected', 'product_collected'],
      ['o-collected', 'offers_collected'],
    ] as const) {
      const id = world[slug].id;
      expect(await productReasonOf(id, [SHOWN, SHOWN]), `${slug} shown`).toBeNull();
      expect(await productReasonOf(id, [HIDDEN, HIDDEN]), `${slug} hidden`).toBe(named);
      expect(await productReasonOf(id, [SHOWN, HIDDEN]), `${slug} disagreeing`).toBe('unknown');
    }
  });

  it('keeps a named cause named, and a public row public, while the public side disagrees', async () => {
    // The hidden offer is named by its table whatever the collected reading says.
    expect(await offerReasonOf(world['o-hidden'].offerIds[0], [SHOWN, HIDDEN, HIDDEN])).toBe('offer_hidden');
    expect(await productReasonOf(world['p-hidden'].id, [SHOWN, HIDDEN])).toBe('product_hidden');
    // An ordinary public row has no collected row anywhere to disagree about: no reason on any reading.
    for (const readings of [[SHOWN, HIDDEN, HIDDEN], [HIDDEN, SHOWN, SHOWN]]) {
      expect(await offerReasonOf(world['p-public'].offerIds[0], readings)).toBeNull();
    }
    for (const readings of [[SHOWN, HIDDEN], [HIDDEN, SHOWN]]) {
      expect(await productReasonOf(world['p-public'].id, readings)).toBeNull();
    }
  });

  it('reads the real flag again once the readings are used up (the seam leaves nothing behind)', async () => {
    stubLocalFlag('off');
    expect(await offerReasonOf(world['o-collected'].offerIds[0], [])).toBe('offer_collected');
    stubLocalFlag('on');
    expect(await offerReasonOf(world['o-collected'].offerIds[0], [])).toBeNull();
    expect(flag.readings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// World 2: one row with every cause true, peeled one cause at a time (AC 22 to 25).
// ---------------------------------------------------------------------------------------------------------------

describe('one row with every cause true, fixed one cause at a time, names them in the owner order (AC 22 to 25)', () => {
  const peel: { shopId: number; feedId: number; productId: number; offerId: number } = {
    shopId: 0,
    feedId: 0,
    productId: 0,
    offerId: 0,
  };

  // Each fix puts one cause right and touches nothing else.
  const FIX = {
    shop: () => getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, peel.shopId)),
    feed: () => getDb().update(feeds).set({ isApproved: true }).where(eq(feeds.id, peel.feedId)),
    collectedFeed: () => getDb().update(feeds).set({ sourceType: 'shop_upload' }).where(eq(feeds.id, peel.feedId)),
    removed: () => getDb().update(offers).set({ isRemoved: false }).where(eq(offers.id, peel.offerId)),
    offerHidden: () => getDb().update(offers).set({ isHidden: false }).where(eq(offers.id, peel.offerId)),
    review: () => getDb().update(offers).set({ inReview: false }).where(eq(offers.id, peel.offerId)),
    category: async () => {
      await getDb().update(products).set({ categoryId: await defaultCategoryId() }).where(eq(products.id, peel.productId));
    },
    productCollected: () => getDb().update(products).set({ isCollected: false }).where(eq(products.id, peel.productId)),
    productHidden: () => getDb().update(products).set({ isHidden: false }).where(eq(products.id, peel.productId)),
  } as const;
  type Fix = keyof typeof FIX;

  /** Every cause true again: unapproved shop and feed, a collected feed, the offer removed, hidden and in review, the product unmapped, collected and hidden. */
  async function breakEverything() {
    await getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, peel.shopId));
    await getDb().update(feeds).set({ isApproved: false, sourceType: 'collected_file' }).where(eq(feeds.id, peel.feedId));
    await getDb().update(offers).set({ isRemoved: true, isHidden: true, inReview: true }).where(eq(offers.id, peel.offerId));
    await getDb().update(products).set({ categoryId: null, isCollected: true, isHidden: true }).where(eq(products.id, peel.productId));
  }

  beforeAll(async () => {
    const collected = await insertCollectedFeed({ isApproved: false, shopApproved: false });
    peel.shopId = collected.shopId;
    peel.feedId = collected.feedId;
    const row = await build('peel', [{ feedId: collected.feedId, isRemoved: true, isHidden: true, inReview: true }], {
      categoryId: null,
      isCollected: true,
      isHidden: true,
    });
    peel.productId = row.id;
    peel.offerId = row.offerIds[0];
  });

  async function walk(order: Fix[], offerReasons: (NotPublicReason | null)[], productReasons: (NotPublicReason | null)[]) {
    await breakEverything();
    const applied = new Set<Fix>();
    for (let step = 0; step <= order.length; step += 1) {
      const label = `after ${step} fixes (${[...applied].join(', ') || 'none'})`;
      const before = await allRows();
      const detail = await readProductForAdmin(peel.productId);
      const listed = (await listProductsForAdmin(FIRST_PAGE)).rows.find((row) => row.id === peel.productId);
      // Reading changes nothing: not a flag, not a row (AC 25).
      expect(await allRows(), label).toEqual(before);

      expect(detail?.reason, `${label}: product`).toBe(productReasons[step]);
      expect(detail?.offers[0].reason, `${label}: offer`).toBe(offerReasons[step]);
      expect(listed?.reason, `${label}: list row`).toBe(productReasons[step]);
      const last = step === order.length;
      expect(detail?.publicNow, label).toBe(last);
      expect(detail?.offers[0].publicNow, label).toBe(last);
      // The item's own flag keeps saying what it is whatever the reason is.
      expect(detail?.hidden, `${label}: product hidden`).toBe(!applied.has('productHidden'));
      expect(detail?.offers[0].hidden, `${label}: offer hidden`).toBe(!applied.has('offerHidden'));
      // And the public page follows: it answers only when the last cause is gone.
      expect((await getPublicProductBySlug('peel')) !== null, label).toBe(last);

      if (!last) {
        await FIX[order[step]]();
        applied.add(order[step]);
      }
    }
  }

  it('the offer, fixed in its own order: shop, feed, collected, removed, hidden, in review, then its product (AC 23)', async () => {
    await walk(
      ['shop', 'feed', 'collectedFeed', 'removed', 'offerHidden', 'review', 'category', 'productCollected', 'productHidden'],
      [
        'offer_shop_not_approved',
        'offer_feed_not_approved',
        'offer_collected',
        'offer_removed',
        'offer_hidden',
        'offer_in_review',
        'product_no_category',
        'product_collected',
        'product_hidden',
        null,
      ],
      [
        // The product's own causes outrank its offers, so it names them first however the offer is fixed.
        'product_no_category',
        'product_no_category',
        'product_no_category',
        'product_no_category',
        'product_no_category',
        'product_no_category',
        'product_no_category',
        'product_collected',
        'product_hidden',
        null,
      ],
    );
  });

  it('the product, fixed in its own order: no category, collected, hidden, then the first cause of its offer (AC 24)', async () => {
    await walk(
      ['category', 'productCollected', 'productHidden', 'shop', 'feed', 'collectedFeed', 'removed', 'offerHidden', 'review'],
      [
        // The offer names its own causes first, so the product's fixes change nothing on it until they are done.
        'offer_shop_not_approved',
        'offer_shop_not_approved',
        'offer_shop_not_approved',
        'offer_shop_not_approved',
        'offer_feed_not_approved',
        'offer_collected',
        'offer_removed',
        'offer_hidden',
        'offer_in_review',
        null,
      ],
      [
        'product_no_category',
        'product_collected',
        'product_hidden',
        'offers_shop_not_approved',
        'offers_feed_not_approved',
        'offers_collected',
        'offers_removed',
        'offers_hidden',
        'offers_in_review',
        null,
      ],
    );
  });

  it('puts every cause back and reads the first one again, so the walks above start from the same row (non-vacuity)', async () => {
    await breakEverything();
    const detail = await readProductForAdmin(peel.productId);
    expect(detail).toMatchObject({ publicNow: false, reason: 'product_no_category' });
    expect(detail?.offers[0]).toMatchObject({ publicNow: false, reason: 'offer_shop_not_approved', hidden: true });
  });
});
