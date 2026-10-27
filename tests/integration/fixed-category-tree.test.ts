import { readFileSync } from 'node:fs';
import path from 'node:path';

import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureFixedCategoryTree, FIXED_CATEGORY_TREE } from '@/db/category-tree';
import { closeDb, getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { categories, feedCategoryMappings, products } from '@/db/schema';

import {
  insertCategory,
  insertCategoryMapping,
  insertFeed,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(closeDb);

const allCategories = () => getDb().select().from(categories).orderBy(asc(categories.id));

/** The tree as rows, without ids, to compare with the constant. */
const expectedRows = [
  {
    slug: FIXED_CATEGORY_TREE.slug,
    name: FIXED_CATEGORY_TREE.name,
    position: FIXED_CATEGORY_TREE.position,
    parentSlug: null,
  },
  ...FIXED_CATEGORY_TREE.children.map((child) => ({
    slug: child.slug,
    name: child.name,
    position: child.position,
    parentSlug: FIXED_CATEGORY_TREE.slug,
  })),
];

async function treeRows() {
  const rows = await allCategories();
  const slugById = new Map(rows.map((row) => [row.id, row.slug]));
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    position: row.position,
    parentSlug: row.parentId === null ? null : (slugById.get(row.parentId) ?? '?'),
  }));
}

describe('the fixed category tree after migrate (S4.0, D-2)', () => {
  it('exists after the reset: six rows, the root and its five children', async () => {
    const rows = await treeRows();
    expect(rows).toHaveLength(6);
    expect(rows).toEqual(expect.arrayContaining(expectedRows));
  });

  it('runMigrations twice, with no seed and SEED_DEMO_DATA unset, gives six rows with stable ids', async () => {
    vi.stubEnv('SEED_DEMO_DATA', '');
    await getDb().delete(categories);
    expect(await allCategories()).toEqual([]);

    await runMigrations(getDb());
    const first = await allCategories();
    expect(first).toHaveLength(6);
    expect(await treeRows()).toEqual(expect.arrayContaining(expectedRows));

    await runMigrations(getDb());
    expect(await allCategories()).toEqual(first);
  });

  it('ensureFixedCategoryTree twice leaves the same six rows with the same ids and parents', async () => {
    const before = await allCategories();
    await ensureFixedCategoryTree(getDb());
    await ensureFixedCategoryTree(getDb());
    expect(await allCategories()).toEqual(before);
    const root = before.find((row) => row.slug === FIXED_CATEGORY_TREE.slug);
    expect(root?.parentId).toBeNull();
    expect(before.filter((row) => row.parentId === root?.id)).toHaveLength(FIXED_CATEGORY_TREE.children.length);
  });

  it('restores a renamed, moved and re-ordered fixed row, keeping its id', async () => {
    const [before] = await getDb().select().from(categories).where(eq(categories.slug, 'filtros-de-aire'));
    const [other] = await getDb().select().from(categories).where(eq(categories.slug, 'aceite-de-motor'));
    await getDb()
      .update(categories)
      .set({ name: 'Renombrada a mano', parentId: other.id, position: 99 })
      .where(eq(categories.slug, 'filtros-de-aire'));

    await runMigrations(getDb());

    const [after] = await getDb().select().from(categories).where(eq(categories.slug, 'filtros-de-aire'));
    expect(after).toEqual(before);
    expect(await treeRows()).toEqual(expect.arrayContaining(expectedRows));
  });

  it('re-creates a deleted fixed child and leaves the other categories alone', async () => {
    const own = await insertCategory({ slug: 'categoria-propia', name: 'Propia', position: 7 });
    await getDb().delete(categories).where(eq(categories.slug, 'filtros-de-combustible'));

    await ensureFixedCategoryTree(getDb());

    const rows = await treeRows();
    expect(rows).toHaveLength(7);
    expect(rows).toEqual(
      expect.arrayContaining([...expectedRows, { slug: 'categoria-propia', name: 'Propia', position: 7, parentSlug: null }]),
    );
    const [still] = await getDb().select().from(categories).where(eq(categories.slug, 'categoria-propia'));
    expect(still.id).toBe(own.id);
  });
});

// Migration 0004 runs once per database, before the tree is ensured. The test
// database already applied it on an empty schema, so its statements are run here
// against legacy data (the seven demo categories of the earlier tree).
describe('migration 0004_retire_legacy_demo_categories (S4.0, D-3)', () => {
  const statements = readFileSync(
    path.resolve(process.cwd(), 'src/db/migrations/0004_retire_legacy_demo_categories.sql'),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  async function runRetirement() {
    for (const statement of statements) await getDb().execute(sql.raw(statement));
  }

  async function seedLegacy() {
    const automovil = await insertCategory({ slug: 'automovil', name: 'Automóvil' });
    const herramientas = await insertCategory({ slug: 'herramientas', name: 'Herramientas' });
    const legacyChildren: Record<string, number> = {};
    for (const [slug, parent] of [
      ['filtros', automovil],
      ['escobillas-y-bombillas', automovil],
      ['aceites-y-lubricantes', automovil],
      ['herramientas-electricas', herramientas],
      ['herramientas-manuales', herramientas],
    ] as const) {
      legacyChildren[slug] = (await insertCategory({ slug, name: slug, parentId: parent.id })).id;
    }
    return { automovil, herramientas, legacyChildren };
  }

  it('has the retirement statements split on the drizzle breakpoint', () => {
    expect(statements.length).toBeGreaterThanOrEqual(4);
  });

  it('removes the seven legacy categories, their mappings, and unassigns their products', async () => {
    const { legacyChildren } = await seedLegacy();
    const shop = await insertShop();
    const feed = await insertFeed(shop.id);
    await insertCategoryMapping(feed, 'Recambios > Filtros', legacyChildren.filtros);
    await insertCategoryMapping(feed, 'Herramienta manual', legacyChildren['herramientas-manuales']);
    const legacyProduct = await insertProduct({ slug: 'producto-en-filtros', categoryId: legacyChildren.filtros });
    const unmappedProduct = await insertProduct({ slug: 'producto-sin-categoria', categoryId: null });

    await runRetirement();

    const slugs = (await allCategories()).map((row) => row.slug).sort();
    expect(slugs).toEqual(
      [FIXED_CATEGORY_TREE.slug, ...FIXED_CATEGORY_TREE.children.map((child) => child.slug)].sort(),
    );
    expect(await getDb().select().from(feedCategoryMappings)).toEqual([]);
    const [moved] = await getDb().select().from(products).where(eq(products.id, legacyProduct.id));
    expect(moved.categoryId).toBeNull();
    const [untouched] = await getDb().select().from(products).where(eq(products.id, unmappedProduct.id));
    expect(untouched.categoryId).toBeNull();
  });

  it('keeps the fixed tree, its mappings and products, and any other category', async () => {
    await seedLegacy();
    const [fixedChild] = await getDb().select().from(categories).where(eq(categories.slug, 'filtros-de-aire'));
    const own = await insertCategory({ slug: 'categoria-propia', name: 'Propia' });
    const shop = await insertShop();
    const feed = await insertFeed(shop.id);
    await insertCategoryMapping(feed, 'Recambios > Filtros de aire', fixedChild.id);
    const fixedProduct = await insertProduct({ slug: 'producto-en-aire', categoryId: fixedChild.id });
    const ownProduct = await insertProduct({ slug: 'producto-propio', categoryId: own.id });
    const fixedBefore = (await allCategories()).filter((row) =>
      expectedRows.some((expected) => expected.slug === row.slug),
    );

    await runRetirement();

    const after = await allCategories();
    expect(after.filter((row) => expectedRows.some((expected) => expected.slug === row.slug))).toEqual(fixedBefore);
    expect(after.map((row) => row.slug)).toContain('categoria-propia');
    expect(await getDb().select().from(feedCategoryMappings)).toHaveLength(1);
    const [keptFixed] = await getDb().select().from(products).where(eq(products.id, fixedProduct.id));
    const [keptOwn] = await getDb().select().from(products).where(eq(products.id, ownProduct.id));
    expect(keptFixed.categoryId).toBe(fixedChild.id);
    expect(keptOwn.categoryId).toBe(own.id);
  });

  it('is safe on a database with no legacy categories, and when run twice', async () => {
    const before = await allCategories();
    await runRetirement();
    await runRetirement();
    expect(await allCategories()).toEqual(before);
  });
});
