import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { products } from '@/db/schema';
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

// S6.2: `indexable` on the two page reads drives noindex and the canonical. It
// is true iff the product (or the category subtree) has an offer from a
// non-demo feed, and it is a different question from `demoOnly`, which drives
// the demo notice and looks at visible offers only.

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
  offerSpecs: { isDemo: boolean; hidden?: boolean; approved?: boolean }[],
) {
  const product = await insertProduct({ slug, categoryId });
  for (const spec of offerSpecs) {
    await insertOffer({
      productId: product.id,
      feedId: await feed(spec.isDemo, spec.approved ?? true),
      isHidden: spec.hidden ?? false,
    });
  }
  return product;
}

describe('getPublicProductBySlug indexable (S6.2)', () => {
  it('is true for a product with a real offer', async () => {
    await productWith('real', undefined, [{ isDemo: false }]);
    expect((await getPublicProductBySlug('real'))?.indexable).toBe(true);
  });

  it('is false for a product whose offers are all from demo feeds', async () => {
    await productWith('demo', undefined, [{ isDemo: true }, { isDemo: true }]);
    const page = await getPublicProductBySlug('demo');
    expect(page?.indexable).toBe(false);
    expect(page?.demoOnly).toBe(true);
  });

  it('is true for a demo offer beside a real one', async () => {
    await productWith('mixto', undefined, [{ isDemo: true }, { isDemo: false }]);
    expect((await getPublicProductBySlug('mixto'))?.indexable).toBe(true);
  });

  it('stays true when the real offer is hidden: the product keeps its real offer (decision 2)', async () => {
    await productWith('demo-y-real-oculta', undefined, [{ isDemo: true }, { isDemo: false, hidden: true }]);
    const page = await getPublicProductBySlug('demo-y-real-oculta');
    expect(page?.indexable).toBe(true);
    expect(page?.demoOnly).toBe(true);
  });

  it('is a boolean, never null', async () => {
    await productWith('real', undefined, [{ isDemo: false }]);
    await productWith('demo', undefined, [{ isDemo: true }]);
    expect(typeof (await getPublicProductBySlug('real'))?.indexable).toBe('boolean');
    expect(typeof (await getPublicProductBySlug('demo'))?.indexable).toBe('boolean');
  });
});

describe('getPublicCategoryPage indexable (S6.2, OD-C)', () => {
  it('is true when the category holds a real public product', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('real', category.id, [{ isDemo: false }]);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.indexable).toBe(true);
  });

  it('is false when every public product in the category is demo-only', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await productWith('demo', category.id, [{ isDemo: true }]);
    const page = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    expect(page?.productCount).toBe(1);
    expect(page?.indexable).toBe(false);
  });

  it('is false for an empty category', async () => {
    await insertCategory({ slug: 'vacia' });
    expect((await getPublicCategoryPage('vacia', 1, null, 'price-asc'))?.indexable).toBe(false);
  });

  it('is false when the only real product is hidden', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const hidden = await productWith('real-oculto', category.id, [{ isDemo: false }]);
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, hidden.id));
    await productWith('demo', category.id, [{ isDemo: true }]);
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc'))?.indexable).toBe(false);
  });

  it('is true for an ancestor whose only real product sits in a descendant', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    const child = await insertCategory({ slug: 'hija', parentId: root.id });
    await productWith('real', child.id, [{ isDemo: false }]);
    expect((await getPublicCategoryPage('raiz', 1, null, 'price-asc'))?.indexable).toBe(true);
    expect((await getPublicCategoryPage('hija', 1, null, 'price-asc'))?.indexable).toBe(true);
  });

  it('is the same on every page, even when page 1 holds only demo products', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    for (let i = 0; i < CATEGORY_PAGE_SIZE; i += 1) {
      await productWith(`a-demo-${String(i).padStart(2, '0')}`, category.id, [{ isDemo: true }]);
    }
    await productWith('z-real', category.id, [{ isDemo: false }]);
    const first = await getPublicCategoryPage('filtros', 1, null, 'price-asc');
    const second = await getPublicCategoryPage('filtros', 2, null, 'price-asc');
    expect(first?.demoOnly).toBe(true);
    expect(first?.indexable).toBe(true);
    expect(second?.indexable).toBe(true);
  });
});
