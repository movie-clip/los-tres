import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, products } from '@/db/schema';
import {
  assignCategory,
  listCategoryMappingsForAdmin,
  markOutsideScope,
  removeCategoryMapping,
  type CategoryWrite,
} from '@/server/admin/category-mappings';
import { importFeeds } from '@/server/importer';

import { insertCategory, insertCategoryMapping, insertFixtureFeed } from '../support/catalogue';
import {
  ABSENT_VIEW,
  PUBLIC_VIEW,
  aFeed,
  allRecords,
  categoryBySlug,
  categoryForm,
  fiveTargets,
  offerOf,
  productIn,
  publicView,
  recordOf,
  recordsOf,
  rootCategory,
  rowsApartFromCategory,
  withFailingProductUpdates,
} from '../support/categories';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S4.2 (T4.2.3), the writer: ACs 18 to 21, 24, 25 (the record), 26 to 34 (the products follow)
// and 38 to 40 (guardrail 1). Called directly, as the actions do after the role check; the
// actions' own refusals are in category-mapping-actions.test.ts. Nothing here runs an import
// unless the case is about one (AC 29, 35): the products must follow with no import (D-1).

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

const CAT = 'Filtros';

const assign = (feedId: number, feedCategory: string, target: number) =>
  assignCategory(categoryForm({ feedId, feedCategory, target }));
const outside = (feedId: number, feedCategory: string) => markOutsideScope(categoryForm({ feedId, feedCategory }));
const remove = (feedId: number, feedCategory: string) => removeCategoryMapping(categoryForm({ feedId, feedCategory }));

/** The value the writer returned, narrowed to a saved state. */
function saved(result: CategoryWrite) {
  expect(result.status).toBe('saved');
  return result as Extract<CategoryWrite, { status: 'saved' }>;
}

/** True while a backend of this database waits on a lock: a blocked row lock shows as wait_event_type Lock. */
async function lockWaitSeen(): Promise<boolean> {
  const result = await getDb().execute<{ waiting: number }>(
    sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return (result.rows[0]?.waiting ?? 0) > 0;
}

describe('setting, changing, marking and removing a record (AC 18 to 21)', () => {
  it('maps a not-reviewed category to a target and says what it stored (AC 18)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);

    const result = saved(await assign(feedId, CAT, aceite.id));

    expect(result).toMatchObject({
      feedId,
      feedCategory: CAT,
      previous: { kind: 'not_reviewed' },
      stored: { kind: 'mapped', targetId: aceite.id, targetName: aceite.name },
    });
    expect(await recordsOf(feedId)).toEqual([{ feedCategory: CAT, categoryId: aceite.id }]);
  });

  it('maps an outside-scope category to a target (AC 18)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    await outside(feedId, CAT);

    const result = saved(await assign(feedId, CAT, aceite.id));

    expect(result.previous).toEqual({ kind: 'outside' });
    expect(await recordsOf(feedId)).toEqual([{ feedCategory: CAT, categoryId: aceite.id }]);
  });

  it('changes a mapped category to another target, with one record and the new name (AC 19)', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    await assign(feedId, CAT, aceite.id);

    const result = saved(await assign(feedId, CAT, filtroAceite.id));

    expect(result.previous).toMatchObject({ kind: 'mapped', targetId: aceite.id });
    expect(result.stored).toMatchObject({ kind: 'mapped', targetId: filtroAceite.id, targetName: filtroAceite.name });
    expect(await recordsOf(feedId)).toEqual([{ feedCategory: CAT, categoryId: filtroAceite.id }]);
  });

  it.each(['not reviewed', 'mapped'] as const)('marks a %s category outside scope: the record has no target (AC 20)', async (from) => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    if (from === 'mapped') await assign(feedId, CAT, aceite.id);

    const result = saved(await outside(feedId, CAT));

    expect(result.stored).toEqual({ kind: 'outside' });
    expect(await recordsOf(feedId)).toEqual([{ feedCategory: CAT, categoryId: null }]);
  });

  it('leaves no not-reviewed category on a feed once every one is mapped or outside scope (AC 20)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Uno');
    await productIn(feedId, 'Dos');
    await productIn(feedId, 'Tres');
    const pending = async () =>
      (await listCategoryMappingsForAdmin()).feeds.find((feed) => feed.id === feedId)!.rows.filter((row) => row.state.kind === 'not_reviewed').length;
    expect(await pending()).toBe(3);

    await assign(feedId, 'Uno', aceite.id);
    await outside(feedId, 'Dos');
    expect(await pending()).toBe(1);
    await outside(feedId, 'Tres');
    expect(await pending()).toBe(0);
  });

  it.each(['mapped', 'outside'] as const)('removes a %s record, which returns the category to not reviewed (AC 21)', async (from) => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    if (from === 'mapped') await assign(feedId, CAT, aceite.id);
    else await outside(feedId, CAT);

    const result = saved(await remove(feedId, CAT));

    expect(result.stored).toEqual({ kind: 'not_reviewed' });
    expect(await recordsOf(feedId)).toEqual([]);
    const row = (await listCategoryMappingsForAdmin()).feeds.find((feed) => feed.id === feedId)!.rows[0];
    expect(row).toMatchObject({ feedCategory: CAT, state: { kind: 'not_reviewed' } });
  });

  it('keeps a record per feed: the same string on another feed is a different record', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const one = await aFeed();
    const two = await aFeed();
    await productIn(one.feedId, CAT);
    await productIn(two.feedId, CAT);

    await assign(one.feedId, CAT, aceite.id);
    await assign(two.feedId, CAT, filtroAceite.id);
    await remove(one.feedId, CAT);

    expect(await recordsOf(one.feedId)).toEqual([]);
    expect(await recordsOf(two.feedId)).toEqual([{ feedCategory: CAT, categoryId: filtroAceite.id }]);
  });
});

describe('saving the state a category already has changes nothing and is not an error (AC 24)', () => {
  it.each([
    ['the same target', 'assign'],
    ['outside scope again', 'outside'],
    ['a removal of a not-reviewed category', 'remove'],
  ] as const)('%s answers unchanged, writes no record and moves no product', async (_name, intent) => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    if (intent === 'assign') await assign(feedId, CAT, aceite.id);
    if (intent === 'outside') await outside(feedId, CAT);
    const recordsBefore = await allRecords();
    const categoriesBefore = await categoryBySlug();

    const again =
      intent === 'assign' ? await assign(feedId, CAT, aceite.id) : intent === 'outside' ? await outside(feedId, CAT) : await remove(feedId, CAT);

    expect(again.status).toBe('unchanged');
    expect(await allRecords()).toEqual(recordsBefore);
    expect(await categoryBySlug()).toEqual(categoriesBefore);
  });

  it('does not re-fill a product an unchanged save finds without a category', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    await assign(feedId, CAT, aceite.id);
    // The category was cleared by hand since: an unchanged save is not a re-apply.
    await getDb().update(products).set({ categoryId: null });

    expect((await assign(feedId, CAT, aceite.id)).status).toBe('unchanged');
    expect(Object.values(await categoryBySlug())).toEqual([null]);
  });
});

describe('two submissions at the same moment (AC 25)', () => {
  it('leave one record, no error and a stored state equal to one of the two submitted', async () => {
    const [aceite, filtroAceite, filtroAire] = await fiveTargets();
    for (let round = 0; round < 6; round += 1) {
      const { feedId } = await aFeed();
      await productIn(feedId, CAT);

      const settled = await Promise.allSettled([
        assign(feedId, CAT, aceite.id),
        assign(feedId, CAT, filtroAceite.id),
        outside(feedId, CAT),
        assign(feedId, CAT, filtroAire.id),
      ]);

      expect(settled.map((entry) => entry.status), `round ${round}`).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
      const records = await recordsOf(feedId);
      expect(records).toHaveLength(1);
      expect([aceite.id, filtroAceite.id, filtroAire.id, null]).toContain(records[0].categoryId);
    }
  });

  it('leave the product in the target of the record that won, or in none for an outside-scope win', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const inCat = await productIn(feedId, CAT);

    await Promise.all([assign(feedId, CAT, aceite.id), assign(feedId, CAT, filtroAceite.id)]);

    const [record] = await recordsOf(feedId);
    expect((await categoryBySlug())[inCat.slug]).toBe(record.categoryId);
  });

  it('a save waits for a transaction that holds the feed row for share, the importer\'s lock, and then writes', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    await assertTestDatabase();

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const importer = getDb().transaction(async (tx) => {
      await tx.execute(sql`select id from feeds where id = ${feedId} for share`);
      held();
      await gate;
    });
    await holding;

    let done = false;
    const save = assign(feedId, CAT, aceite.id).then((result) => {
      done = true;
      return result;
    });
    try {
      // Wait for the save to be blocked on the lock, not for a fixed time (0006, rule 3):
      // this database's own backend waiting on a lock can only be the save, because the
      // importer holds its lock and waits on nothing. A save that finished instead of
      // waiting ends the loop and fails the assertion below. Only the test timeout
      // bounds the wait.
      while (!done && !(await lockWaitSeen())) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(done, 'the save went through while an import held the feed').toBe(false);
      expect(await recordsOf(feedId)).toEqual([]);
    } finally {
      release();
    }
    await importer;
    expect((await save).status).toBe('saved');
    expect(await recordsOf(feedId)).toHaveLength(1);
  });
});

describe('a new mapping fills only products with no category (AC 26, 27)', () => {
  it('gives the target to every product with an offer in the feed category and no category, with no import', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const a = await productIn(feedId, CAT);
    const b = await productIn(feedId, CAT);

    const result = saved(await assign(feedId, CAT, aceite.id));

    const now = await categoryBySlug();
    expect(now[a.slug]).toBe(aceite.id);
    expect(now[b.slug]).toBe(aceite.id);
    expect(result.productsChanged).toBe(2);
  });

  it('also fills when the category was outside scope', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const a = await productIn(feedId, CAT);
    await outside(feedId, CAT);

    saved(await assign(feedId, CAT, aceite.id));

    expect((await categoryBySlug())[a.slug]).toBe(aceite.id);
  });

  it('leaves a product that already has a category where it is, and reports only the ones it filled', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const empty = await productIn(feedId, CAT);
    const placed = await productIn(feedId, CAT, { categoryId: filtroAceite.id });
    const alreadyThere = await productIn(feedId, CAT, { categoryId: aceite.id });

    const result = saved(await assign(feedId, CAT, aceite.id));

    const now = await categoryBySlug();
    expect(now[empty.slug]).toBe(aceite.id);
    expect(now[placed.slug]).toBe(filtroAceite.id);
    expect(now[alreadyThere.slug]).toBe(aceite.id);
    expect(result.productsChanged).toBe(1);
  });

  it('touches no product outside the feed category: another string, another feed, an empty cell', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const other = await aFeed();
    const inCat = await productIn(feedId, CAT);
    const sameStringOtherFeed = await productIn(other.feedId, CAT);
    const otherString = await productIn(feedId, 'Otra');
    const caseOnly = await productIn(feedId, 'filtros');
    const emptyCell = await productIn(feedId, null);

    await assign(feedId, CAT, aceite.id);

    const now = await categoryBySlug();
    expect(now[inCat.slug]).toBe(aceite.id);
    for (const untouched of [sameStringOtherFeed, otherString, caseOnly, emptyCell]) expect(now[untouched.slug], untouched.slug).toBeNull();
  });

  it('a product with offers in two categories of the feed is filled by the first mapping and kept by the second (AC 27)', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const both = await productIn(feedId, 'Uno');
    await offerOf(both.id, feedId, 'Dos');

    await assign(feedId, 'Uno', aceite.id);
    const second = saved(await assign(feedId, 'Dos', filtroAceite.id));

    expect((await categoryBySlug())[both.slug]).toBe(aceite.id);
    expect(second.productsChanged).toBe(0);
  });
});

describe('a change moves only the products of the old target (AC 28)', () => {
  it('moves the product on the old target and keeps one on another category or on none', async () => {
    const [aceite, filtroAceite, filtroAire] = await fiveTargets();
    const { feedId } = await aFeed();
    const onOld = await productIn(feedId, CAT);
    await assign(feedId, CAT, aceite.id);
    const elsewhere = await productIn(feedId, CAT, { categoryId: filtroAire.id });
    const none = await productIn(feedId, CAT);

    const result = saved(await assign(feedId, CAT, filtroAceite.id));

    const now = await categoryBySlug();
    expect(now[onOld.slug]).toBe(filtroAceite.id);
    expect(now[elsewhere.slug]).toBe(filtroAire.id);
    expect(now[none.slug]).toBeNull();
    expect(result.productsChanged).toBe(1);
  });

  it('leaves a product in the old target that has no offer in this feed category', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    await assign(feedId, CAT, aceite.id);
    const bystander = await productIn(feedId, 'Otra', { categoryId: aceite.id });

    await assign(feedId, CAT, filtroAceite.id);

    expect((await categoryBySlug())[bystander.slug]).toBe(aceite.id);
  });
});

describe('outside scope and removal clear only the products of the old target (AC 30, 32, 33)', () => {
  it.each(['outside', 'remove'] as const)('%s clears the product on the old target and keeps the others', async (how) => {
    const [aceite, filtroAire] = await fiveTargets();
    const { feedId } = await aFeed();
    const onTarget = await productIn(feedId, CAT);
    await assign(feedId, CAT, aceite.id);
    const elsewhere = await productIn(feedId, CAT, { categoryId: filtroAire.id });
    const none = await productIn(feedId, CAT);
    const otherFeedCategory = await productIn(feedId, 'Otra', { categoryId: aceite.id });

    const result = saved(how === 'outside' ? await outside(feedId, CAT) : await remove(feedId, CAT));

    const now = await categoryBySlug();
    expect(now[onTarget.slug]).toBeNull();
    expect(now[elsewhere.slug]).toBe(filtroAire.id);
    expect(now[none.slug]).toBeNull();
    expect(now[otherFeedCategory.slug]).toBe(aceite.id);
    expect(result.productsChanged).toBe(1);
  });

  it('moving between not reviewed and outside scope changes no product and reports no count (AC 33)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT, { categoryId: aceite.id });
    await productIn(feedId, CAT);
    const before = await categoryBySlug();

    const toOutside = saved(await outside(feedId, CAT));
    const back = saved(await remove(feedId, CAT));

    expect(toOutside.productsChanged).toBeNull();
    expect(back.productsChanged).toBeNull();
    expect(await categoryBySlug()).toEqual(before);
  });
});

describe('the admin\'s latest action wins, across two feeds (AC 29, 35)', () => {
  async function twoFeedWorld() {
    const targets = await fiveTargets();
    const one = await insertFixtureFeed('category-ean-one.csv', { shopName: 'Tienda A' });
    const two = await insertFixtureFeed('category-ean-two.csv', { shopName: 'Tienda B' });
    // Import first: a category is listed only when an offer carries it (AC 8). No mapping yet, so no product has a category.
    await importFeeds(getDb(), { deps: fixtureDeps });
    const [product] = await getDb().select().from(products);
    expect(product.categoryId).toBeNull();
    return { targets, one, two, slug: product.slug };
  }
  const run = () => importFeeds(getDb(), { deps: fixtureDeps });

  it('a change of one feed\'s mapping moves the shared product to its target, not the other feed\'s, and an import leaves it there', async () => {
    const { targets: [a, b, c, d], one, two, slug } = await twoFeedWorld();
    await assign(one.feedId, 'Cat Uno', a.id); // fills the product: it sits in A
    await assign(two.feedId, 'Cat Dos', b.id); // the product has a category: it stays in A
    expect((await categoryBySlug())[slug]).toBe(a.id);

    saved(await assign(one.feedId, 'Cat Uno', c.id)); // an admin change moves it by AC 28
    expect((await categoryBySlug())[slug]).toBe(c.id);

    await run();
    expect((await categoryBySlug())[slug]).toBe(c.id); // AC 35: the importer never overwrites

    // A later admin action on the other feed's mapping applies by the same rules: the product is not in B, so it stays.
    const other = saved(await assign(two.feedId, 'Cat Dos', d.id));
    expect(other.productsChanged).toBe(0);
    expect((await categoryBySlug())[slug]).toBe(c.id);
    await run();
    expect((await categoryBySlug())[slug]).toBe(c.id);
  });

  it('a change of the other feed\'s mapping moves the product when it sits in that feed\'s old target', async () => {
    const { targets: [a, b, c], one, two, slug } = await twoFeedWorld();
    await assign(two.feedId, 'Cat Dos', b.id); // fills: B
    await assign(one.feedId, 'Cat Uno', a.id); // stays in B
    expect((await categoryBySlug())[slug]).toBe(b.id);

    saved(await assign(two.feedId, 'Cat Dos', c.id));

    expect((await categoryBySlug())[slug]).toBe(c.id);
  });

  it('a removal clears the product and the next import refills it from the other feed\'s mapping (Q-2)', async () => {
    const { targets: [a], one, two, slug } = await twoFeedWorld();
    await assign(one.feedId, 'Cat Uno', a.id);
    await assign(two.feedId, 'Cat Dos', a.id);
    expect((await categoryBySlug())[slug]).toBe(a.id);

    saved(await remove(one.feedId, 'Cat Uno'));
    expect((await categoryBySlug())[slug]).toBeNull(); // cleared at once, though feed two still maps there

    await run();
    expect((await categoryBySlug())[slug]).toBe(a.id); // the importer fills from none
  });

  it('after a removal with nothing else mapping it, an import does not bring the category back (AC 35)', async () => {
    const { targets: [a], one, slug } = await twoFeedWorld();
    await assign(one.feedId, 'Cat Uno', a.id);
    await remove(one.feedId, 'Cat Uno');

    await run();

    expect((await categoryBySlug())[slug]).toBeNull();
    expect(await allRecords()).toEqual([]);
  });

  it('an import after a save changes no category the admin produced, and writes no record', async () => {
    const { targets: [a], one, slug } = await twoFeedWorld();
    await assign(one.feedId, 'Cat Uno', a.id);
    const recordsBefore = await allRecords();

    await run();
    await run();

    expect((await categoryBySlug())[slug]).toBe(a.id);
    expect(await allRecords()).toEqual(recordsBefore);
  });
});

describe('the public readers follow the save at once, with no import (AC 31, 26)', () => {
  /** One product on an approved feed, public in a category once its feed category is mapped. */
  async function publicWorld() {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const product = await productIn(feedId, CAT);
    const view = (target: { slug: string }) => publicView({ productSlug: product.slug, offerId: product.offerId, categorySlug: target.slug });
    return { aceite, filtroAceite, feedId, product, view };
  }

  it('a mapped feed category makes its product public, a removal takes it off every reader, a re-map returns it', async () => {
    const { aceite, feedId, view } = await publicWorld();
    expect(await view(aceite)).toEqual({ ...ABSENT_VIEW });

    await assign(feedId, CAT, aceite.id);
    expect(await view(aceite)).toEqual(PUBLIC_VIEW);

    saved(await remove(feedId, CAT));
    expect(await view(aceite)).toEqual(ABSENT_VIEW);

    await assign(feedId, CAT, aceite.id);
    expect(await view(aceite)).toEqual(PUBLIC_VIEW);
  });

  it('marking outside scope takes the product off the category page, the product page, the sitemap and /go', async () => {
    const { aceite, feedId, view } = await publicWorld();
    await assign(feedId, CAT, aceite.id);
    expect(await view(aceite)).toEqual(PUBLIC_VIEW);

    await outside(feedId, CAT);

    expect(await view(aceite)).toEqual(ABSENT_VIEW);
  });

  it('a change moves the product from one category page to the other with no import', async () => {
    const { aceite, filtroAceite, feedId, view } = await publicWorld();
    await assign(feedId, CAT, aceite.id);

    await assign(feedId, CAT, filtroAceite.id);

    expect(await view(aceite)).toEqual({ ...ABSENT_VIEW, productPage: true, sitemapProduct: true, go: 302 });
    expect(await view(filtroAceite)).toEqual(PUBLIC_VIEW);
  });

  it('a product that stays on another category after a removal is still public there', async () => {
    const { aceite, filtroAceite, feedId, product } = await publicWorld();
    await getDb().update(products).set({ categoryId: filtroAceite.id });
    await assign(feedId, CAT, aceite.id); // changes nothing: the product has a category

    await remove(feedId, CAT);

    expect(await publicView({ productSlug: product.slug, offerId: product.offerId, categorySlug: filtroAceite.slug })).toEqual(PUBLIC_VIEW);
  });
});

describe('the record and the products are one write (AC 34)', () => {
  it('a failing product update leaves the record as it was and no product half-changed', async () => {
    const [aceite, filtroAceite] = await fiveTargets();
    const { feedId } = await aFeed();
    const a = await productIn(feedId, CAT);
    const b = await productIn(feedId, CAT);
    const before = { records: await allRecords(), categories: await categoryBySlug() };

    await expect(withFailingProductUpdates(() => assign(feedId, CAT, aceite.id))).rejects.toMatchObject({ cause: { code: 'P0001' } });

    expect({ records: await allRecords(), categories: await categoryBySlug() }).toEqual(before);

    // The same for a change and a removal: an existing record survives a failed move.
    await assign(feedId, CAT, aceite.id);
    const mapped = { records: await allRecords(), categories: await categoryBySlug() };
    expect(mapped.categories[a.slug]).toBe(aceite.id);
    for (const attempt of [() => assign(feedId, CAT, filtroAceite.id), () => remove(feedId, CAT), () => outside(feedId, CAT)]) {
      await expect(withFailingProductUpdates(attempt)).rejects.toBeDefined();
      expect({ records: await allRecords(), categories: await categoryBySlug() }).toEqual(mapped);
    }
    expect(mapped.categories[b.slug]).toBe(aceite.id);
  });
});

describe('guardrail 1: a save changes a category and nothing else (AC 38 to 40)', () => {
  const ACTIONS: [string, (feedId: number, target: number) => Promise<CategoryWrite>][] = [
    ['assign', (feedId, target) => assign(feedId, CAT, target)],
    ['outside', (feedId) => outside(feedId, CAT)],
    ['remove', (feedId) => remove(feedId, CAT)],
  ];

  /** A feed with one product per interesting flag, every one carrying the feed category. */
  async function flagWorld(o: { approved?: boolean; shopApproved?: boolean } = {}) {
    const { feedId } = await aFeed(o);
    const hiddenProduct = await productIn(feedId, CAT, { product: { isHidden: true } });
    const hiddenOffer = await productIn(feedId, CAT, { offer: { isHidden: true } });
    const reviewOffer = await productIn(feedId, CAT, { offer: { inReview: true } });
    const plain = await productIn(feedId, CAT);
    return { feedId, hiddenProduct, hiddenOffer, reviewOffer, plain };
  }

  it.each(ACTIONS)('%s: no product, offer, feed or shop row differs afterwards but the category', async (_name, act) => {
    const [aceite] = await fiveTargets();
    const world = await flagWorld();
    // Start from a mapped state so every action has something to do.
    await assign(world.feedId, CAT, aceite.id);
    const before = await rowsApartFromCategory();

    const result = await act(world.feedId, (await fiveTargets())[1].id);

    expect(result.status).toBe('saved');
    expect(await rowsApartFromCategory()).toEqual(before);
  });

  it('a hidden product given a category by a save stays hidden and does not become public (AC 39)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId, hiddenProduct } = await flagWorld();

    await assign(feedId, CAT, aceite.id);

    expect(await categoryBySlug()).toMatchObject({ [hiddenProduct.slug]: aceite.id });
    const row = (await getDb().select().from(products)).find((candidate) => candidate.slug === hiddenProduct.slug)!;
    expect(row.isHidden).toBe(true);
    expect(await publicView({ productSlug: hiddenProduct.slug, offerId: hiddenProduct.offerId, categorySlug: aceite.slug })).toMatchObject({
      productPage: false,
      sitemapProduct: false,
      go: 404,
    });
  });

  it('a hidden offer and an offer in review stay off the public readers after the save, and a plain one appears (AC 38, 39)', async () => {
    const [aceite] = await fiveTargets();
    const { feedId, hiddenOffer, reviewOffer, plain } = await flagWorld();

    await assign(feedId, CAT, aceite.id);

    for (const product of [hiddenOffer, reviewOffer]) {
      expect(await publicView({ productSlug: product.slug, offerId: product.offerId, categorySlug: aceite.slug }), product.slug).toMatchObject({
        productPage: false,
        sitemapProduct: false,
        go: 404,
      });
    }
    expect(await publicView({ productSlug: plain.slug, offerId: plain.offerId, categorySlug: aceite.slug })).toEqual({
      ...PUBLIC_VIEW,
      categoryCount: 1,
    });
  });

  it.each<[string, { approved?: boolean; shopApproved?: boolean }]>([
    ['an unapproved feed', { approved: false }],
    ['an unapproved shop', { shopApproved: false }],
  ])('%s: the save sets the categories and every public answer stays what it was (AC 40)', async (_name, flags) => {
    const [aceite] = await fiveTargets();
    const { feedId, plain } = await flagWorld(flags);
    const view = () => publicView({ productSlug: plain.slug, offerId: plain.offerId, categorySlug: aceite.slug });
    const before = await view();
    expect(before).toEqual(ABSENT_VIEW);
    const rowsBefore = await rowsApartFromCategory();

    await assign(feedId, CAT, aceite.id);

    expect((await categoryBySlug())[plain.slug]).toBe(aceite.id);
    expect(await view()).toEqual(before);
    expect(await rowsApartFromCategory()).toEqual(rowsBefore);
    const feedRow = (await getDb().select().from(feeds)).find((row) => row.id === feedId)!;
    expect(feedRow.isApproved).toBe(flags.approved ?? true);
  });
});

describe('the target is one of the five, checked in the writer (AC 4)', () => {
  it('refuses the root and a category outside the five, and writes nothing', async () => {
    const root = await rootCategory();
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);
    const before = { records: await allRecords(), categories: await categoryBySlug() };

    const refused = await assign(feedId, CAT, root.id);

    expect(refused).toMatchObject({ status: 'refused', reason: 'target_invalid', feedId, feedCategory: CAT });
    expect({ records: await allRecords(), categories: await categoryBySlug() }).toEqual(before);
  });

  it('refuses a category added outside the fixed tree even if it sits under the root', async () => {
    const root = await rootCategory();
    const extra = await insertCategory({ slug: 'otra-hija', parentId: root.id });
    const { feedId } = await aFeed();
    await productIn(feedId, CAT);

    expect(await assign(feedId, CAT, extra.id)).toMatchObject({ status: 'refused', reason: 'target_invalid' });
    expect(await allRecords()).toEqual([]);
  });

  it('a mapped record on a legacy target outside the five can still be changed to one of the five', async () => {
    const [aceite] = await fiveTargets();
    const legacy = await insertCategory({ slug: 'heredada' });
    const { feedId } = await aFeed();
    const inCat = await productIn(feedId, CAT, { categoryId: legacy.id });
    await insertCategoryMapping(feedId, CAT, legacy.id);

    const result = saved(await assign(feedId, CAT, aceite.id));

    expect(result.previous).toMatchObject({ kind: 'mapped', targetId: legacy.id });
    expect((await categoryBySlug())[inCat.slug]).toBe(aceite.id);
    expect(await recordOf(feedId, CAT)).toMatchObject({ categoryId: aceite.id });
  });
});
