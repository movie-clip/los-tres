import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers } from '@/db/schema';
import { CATEGORY_PAGE_SIZE, getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertFeed,
  insertOffer,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// S9.3: `demoOnly` is true only when every VISIBLE offer behind the page comes
// from a demo feed. A hidden, in-review or unapproved-feed offer never counts,
// in either direction (guardrail 1).

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

async function feed(isDemo: boolean, isApproved = true): Promise<number> {
  return insertFeed((await insertShop()).id, { isDemo, isApproved });
}

async function productWith(
  slug: string,
  categoryId: number | undefined,
  offerSpecs: { isDemo: boolean; hidden?: boolean; inReview?: boolean; approved?: boolean; price?: number }[],
) {
  const product = await insertProduct({ slug, categoryId });
  const offerIds: number[] = [];
  for (const spec of offerSpecs) {
    const feedId = await feed(spec.isDemo, spec.approved ?? true);
    offerIds.push(
      await insertOffer({
        productId: product.id,
        feedId,
        priceCents: spec.price ?? 1000,
        isHidden: spec.hidden ?? false,
        inReview: spec.inReview ?? false,
      }),
    );
  }
  return { ...product, offerIds };
}

describe('getPublicProductBySlug demoOnly (S9.3)', () => {
  it('is true when every listed offer is from a demo feed', async () => {
    await productWith('todo-demo', undefined, [{ isDemo: true }, { isDemo: true }]);
    expect((await getPublicProductBySlug('todo-demo'))?.demoOnly).toBe(true);
  });

  it('is false when one visible offer is from a real feed', async () => {
    await productWith('mixto', undefined, [{ isDemo: true }, { isDemo: false }]);
    expect((await getPublicProductBySlug('mixto'))?.demoOnly).toBe(false);
  });

  it('is false when the only offer is from a real feed', async () => {
    await productWith('real', undefined, [{ isDemo: false }]);
    expect((await getPublicProductBySlug('real'))?.demoOnly).toBe(false);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['in review', { inReview: true }],
    ['from an unapproved feed', { approved: false }],
  ])('ignores a real offer that is %s: still true', async (_name, flag) => {
    await productWith('demo-y-real-oculta', undefined, [{ isDemo: true }, { isDemo: false, ...flag }]);
    const page = await getPublicProductBySlug('demo-y-real-oculta');
    expect(page?.offers).toHaveLength(1);
    expect(page?.demoOnly).toBe(true);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['in review', { inReview: true }],
    ['from an unapproved feed', { approved: false }],
  ])('ignores a demo offer that is %s: still false', async (_name, flag) => {
    await productWith('real-y-demo-oculta', undefined, [{ isDemo: false }, { isDemo: true, ...flag }]);
    const page = await getPublicProductBySlug('real-y-demo-oculta');
    expect(page?.offers).toHaveLength(1);
    expect(page?.demoOnly).toBe(false);
  });

  it('follows the offer a feed flag change shows: flipping the feed to real turns it false', async () => {
    const product = await productWith('cambia', undefined, [{ isDemo: true }]);
    expect((await getPublicProductBySlug('cambia'))?.demoOnly).toBe(true);
    const [row] = await getDb().select().from(offers).where(eq(offers.id, product.offerIds[0]));
    await getDb().update(feeds).set({ isDemo: false }).where(eq(feeds.id, row.feedId));
    expect((await getPublicProductBySlug('cambia'))?.demoOnly).toBe(false);
  });

  it('keeps demoOnly out of every offer row', async () => {
    await productWith('sin-fuga', undefined, [{ isDemo: true }]);
    const page = await getPublicProductBySlug('sin-fuga');
    for (const offer of page?.offers ?? []) {
      expect(Object.keys(offer)).not.toContain('demoOnly');
      expect(Object.keys(offer)).not.toContain('isDemo');
    }
  });
});

describe('getPublicCategoryPage demoOnly (S9.3)', () => {
  it('is true when every card is backed only by demo offers', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: true }, { isDemo: true }]);
    await productWith('b', category.id, [{ isDemo: true }]);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.products).toHaveLength(2);
    expect(page?.demoOnly).toBe(true);
  });

  it('is false when one card has a real visible offer', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: true }]);
    await productWith('b', category.id, [{ isDemo: true }, { isDemo: false }]);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.demoOnly).toBe(false);
  });

  it('is false when every offer is real', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: false }]);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.demoOnly).toBe(false);
  });

  it('is false for an empty category, not vacuously true', async () => {
    await insertCategory({ slug: 'vacia' });
    const page = await getPublicCategoryPage('vacia', 1, null, 'price-asc');
    expect(page?.products).toEqual([]);
    expect(page?.demoOnly).toBe(false);
  });

  it('is false when the only product has no visible offer left', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('oculta', category.id, [{ isDemo: true, hidden: true }]);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.products).toEqual([]);
    expect(page?.demoOnly).toBe(false);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['in review', { inReview: true }],
    ['from an unapproved feed', { approved: false }],
  ])('ignores a real offer that is %s: still true', async (_name, flag) => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: true }, { isDemo: false, ...flag }]);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.products[0].offerCount).toBe(1);
    expect(page?.demoOnly).toBe(true);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['in review', { inReview: true }],
    ['from an unapproved feed', { approved: false }],
  ])('ignores a demo offer that is %s: still false', async (_name, flag) => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: false }, { isDemo: true, ...flag }]);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.demoOnly).toBe(false);
  });

  it('never exposes the demo flag on a card', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('a', category.id, [{ isDemo: true }]);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    for (const card of page?.products ?? []) {
      expect(Object.keys(card)).not.toContain('allDemo');
      expect(Object.keys(card)).not.toContain('isDemo');
      expect(Object.keys(card)).not.toContain('demoOnly');
    }
  });

  it('scopes the flag to the cards on the displayed page', async () => {
    // Cards order by lowest price then id: the cheaper demo-only ones fill page 1,
    // the dearer real one is pushed to page 2. The flag follows the page shown, not the whole category.
    const category = await insertCategory({ slug: 'filtros' });
    for (let i = 0; i < CATEGORY_PAGE_SIZE; i += 1) {
      const product = await insertProduct({
        slug: `a-demo-${String(i).padStart(2, '0')}`,
        title: `A demo ${String(i).padStart(2, '0')}`,
        categoryId: category.id,
      });
      await insertOffer({ productId: product.id, feedId: await feed(true) });
    }
    const real = await insertProduct({ slug: 'z-real', title: 'Z real', categoryId: category.id });
    await insertOffer({ productId: real.id, feedId: await feed(false), priceCents: 5000 });

    const first = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    const second = await getPublicCategoryPage('filtros', 2, null, 'price-asc');
    expect(first?.products).toHaveLength(CATEGORY_PAGE_SIZE);
    expect(first?.demoOnly).toBe(true);
    expect(second?.products.map((card) => card.slug)).toEqual(['z-real']);
    expect(second?.demoOnly).toBe(false);
  });
});
