import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { categories, products } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { getPublicCategoryTree } from '@/server/catalogue/category-tree';

import { insertCategory, insertFeed, insertListedProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterAll(closeDb);

const slugs = (nodes: { slug: string }[]) => nodes.map((node) => node.slug);

/** One public product in `categoryId` (default shop and feed, approved and visible). */
const listIn = (slug: string, categoryId: number | null) =>
  insertListedProduct({ slug, prices: [1000], categoryId });

describe('getPublicCategoryTree shape and levels', () => {
  it('returns two levels with integer counts and exactly the contract fields', async () => {
    const auto = await insertCategory({ slug: 'automovil', name: 'Automóvil' });
    const filtros = await insertCategory({ slug: 'filtros', name: 'Filtros', parentId: auto.id });
    await listIn('filtro-a', filtros.id);
    await listIn('filtro-b', filtros.id);

    const tree = await getPublicCategoryTree();

    expect(tree).toEqual([
      {
        slug: 'automovil',
        name: 'Automóvil',
        productCount: 2,
        children: [{ slug: 'filtros', name: 'Filtros', productCount: 2 }],
      },
    ]);
    expect(typeof tree[0].productCount).toBe('number');
    expect(typeof tree[0].children[0].productCount).toBe('number');
    expect(Object.keys(tree[0].children[0]).sort()).toEqual(['name', 'productCount', 'slug']);
  });

  it('counts a grandchild product in the child and in the root, and lists no third level', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    const child = await insertCategory({ slug: 'hija', parentId: root.id });
    const grandchild = await insertCategory({ slug: 'nieta', parentId: child.id });
    await listIn('solo-en-la-nieta', grandchild.id);

    const tree = await getPublicCategoryTree();

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ slug: 'raiz', productCount: 1 });
    expect(tree[0].children).toEqual([expect.objectContaining({ slug: 'hija', productCount: 1 })]);
    expect(JSON.stringify(tree)).not.toContain('nieta');
  });

  it('shows a root with products of its own and no child with products as a heading only', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    await insertCategory({ slug: 'hija-vacia', parentId: root.id });
    await listIn('propio', root.id);

    expect(await getPublicCategoryTree()).toEqual([
      expect.objectContaining({ slug: 'raiz', productCount: 1, children: [] }),
    ]);
  });

  it('counts a product once, however many descendants it sits under', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    const a = await insertCategory({ slug: 'a', parentId: root.id });
    const b = await insertCategory({ slug: 'b', parentId: root.id });
    // Two offers on one product must not double the count either.
    await insertListedProduct({ slug: 'dos-ofertas', prices: [100, 200], categoryId: a.id });
    await listIn('otro', b.id);

    const [group] = await getPublicCategoryTree();
    expect(group.productCount).toBe(2);
    expect(group.children.map((c) => c.productCount)).toEqual([1, 1]);
  });
});

describe('ordering', () => {
  it('orders both levels by position, not by name or insertion', async () => {
    const second = await insertCategory({ slug: 'segunda', name: 'Aaa', position: 2 });
    const first = await insertCategory({ slug: 'primera', name: 'Zzz', position: 1 });
    const c2 = await insertCategory({ slug: 'hija-2', name: 'Aaa', parentId: first.id, position: 5 });
    const c1 = await insertCategory({ slug: 'hija-1', name: 'Zzz', parentId: first.id, position: 3 });
    await listIn('p1', c1.id);
    await listIn('p2', c2.id);
    await listIn('p3', second.id);

    const tree = await getPublicCategoryTree();

    expect(slugs(tree)).toEqual(['primera', 'segunda']);
    expect(slugs(tree[0].children)).toEqual(['hija-1', 'hija-2']);
  });
});

describe('what stays off the tree (guardrail 1)', () => {
  it('leaves out an empty root, an empty child and an empty-subtree category', async () => {
    const full = await insertCategory({ slug: 'con-productos' });
    await insertCategory({ slug: 'sin-productos' });
    const emptyChild = await insertCategory({ slug: 'hija-vacia', parentId: full.id });
    const child = await insertCategory({ slug: 'hija-llena', parentId: full.id });
    await listIn('uno', child.id);

    const tree = await getPublicCategoryTree();

    expect(slugs(tree)).toEqual(['con-productos']);
    expect(slugs(tree[0].children)).toEqual(['hija-llena']);
    expect(JSON.stringify(tree)).not.toContain(emptyChild.slug);
  });

  it('does not count a hidden product', async () => {
    const category = await insertCategory({ slug: 'cat' });
    await insertListedProduct({ slug: 'oculto', prices: [100], categoryId: category.id, isHidden: true });
    expect(await getPublicCategoryTree()).toEqual([]);
  });

  it('does not count a product whose only offer comes from an unapproved feed', async () => {
    const category = await insertCategory({ slug: 'cat' });
    const feedId = await insertFeed((await insertShop()).id, { isApproved: false });
    await insertListedProduct({ slug: 'sin-aprobar', prices: [100], categoryId: category.id, feedId });
    expect(await getPublicCategoryTree()).toEqual([]);
  });

  it('does not count a product of an unapproved shop', async () => {
    const category = await insertCategory({ slug: 'cat' });
    const feedId = await insertFeed((await insertShop({ isApproved: false })).id);
    await insertListedProduct({ slug: 'tienda-no', prices: [100], categoryId: category.id, feedId });
    expect(await getPublicCategoryTree()).toEqual([]);
  });

  it('does not count an unmapped product (category_id null)', async () => {
    await insertCategory({ slug: 'cat' });
    await listIn('sin-categoria', null);
    expect(await getPublicCategoryTree()).toEqual([]);
  });

  it('drops a node whose slug is malformed, with its children, and keeps the others', async () => {
    const bad = await insertCategory({ slug: 'Mala Slug' });
    const badChild = await insertCategory({ slug: 'hija-buena', parentId: bad.id });
    const good = await insertCategory({ slug: 'buena' });
    const badRow = await insertCategory({ slug: 'otra-buena', parentId: good.id });
    await getDb().update(categories).set({ slug: 'Mala/Fila' }).where(eq(categories.id, badRow.id));
    await listIn('a', badChild.id);
    await listIn('b', badRow.id);
    await listIn('c', good.id);

    const tree = await getPublicCategoryTree();

    expect(slugs(tree)).toEqual(['buena']);
    expect(tree[0].children).toEqual([]);
    expect(tree[0].productCount).toBe(2);
  });

  it('removes a category on the next call once an admin hides its only product', async () => {
    const category = await insertCategory({ slug: 'cat' });
    const product = await listIn('unico', category.id);
    expect(slugs(await getPublicCategoryTree())).toEqual(['cat']);

    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));

    expect(await getPublicCategoryTree()).toEqual([]);
  });
});

describe('the no-products state', () => {
  it('returns an empty array with no categories at all', async () => {
    expect(await getPublicCategoryTree()).toEqual([]);
  });

  it('returns an empty array with categories but no public products', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    await insertCategory({ slug: 'hija', parentId: root.id });
    expect(await getPublicCategoryTree()).toEqual([]);
  });
});

describe('a malformed parent cycle', () => {
  it('terminates and still returns the well-formed tree', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    await listIn('en-raiz', root.id);
    const x = await insertCategory({ slug: 'x' });
    const y = await insertCategory({ slug: 'y', parentId: x.id });
    await getDb().update(categories).set({ parentId: y.id }).where(eq(categories.id, x.id));
    await listIn('en-ciclo', y.id);

    const tree = await getPublicCategoryTree();

    expect(slugs(tree)).toEqual(['raiz']);
  });
});

describe('invariant I-1: the home count is the category page count', () => {
  it('matches getPublicCategoryPage for every group and every child', async () => {
    const auto = await insertCategory({ slug: 'automovil', position: 1 });
    const filtros = await insertCategory({ slug: 'filtros', parentId: auto.id, position: 1 });
    const luces = await insertCategory({ slug: 'luces', parentId: auto.id, position: 2 });
    const bombillas = await insertCategory({ slug: 'bombillas', parentId: luces.id });
    await insertCategory({ slug: 'aceites', parentId: auto.id, position: 3 });
    const tools = await insertCategory({ slug: 'herramientas', position: 2 });
    const manuales = await insertCategory({ slug: 'manuales', parentId: tools.id });
    await insertCategory({ slug: 'vacia', position: 3 });

    await listIn('f1', filtros.id);
    await listIn('f2', filtros.id);
    await listIn('f3', filtros.id);
    await listIn('b1', bombillas.id);
    await listIn('a-propio', auto.id);
    await listIn('m1', manuales.id);
    await listIn('t-propio', tools.id);
    // Not public: must not move either side of the comparison.
    await insertListedProduct({ slug: 'oculto', prices: [100], categoryId: filtros.id, isHidden: true });
    await listIn('huerfano', null);

    const tree = await getPublicCategoryTree();
    const nodes = tree.flatMap((group) => [group, ...group.children]);
    expect(nodes.length).toBe(5);

    for (const node of nodes) {
      const page = await getPublicCategoryPage(node.slug, 1);
      expect(page, node.slug).not.toBeNull();
      expect(page?.productCount, node.slug).toBeGreaterThanOrEqual(1);
      expect(page?.productCount, node.slug).toBe(node.productCount);
    }
    // And no category left off the tree has a page with products at depth <= 2.
    const listed = new Set(nodes.map((node) => node.slug));
    for (const slug of ['aceites', 'vacia']) {
      expect(listed.has(slug)).toBe(false);
      expect((await getPublicCategoryPage(slug, 1))?.productCount).toBe(0);
    }
  });
});
