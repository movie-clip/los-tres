import { eq } from 'drizzle-orm';

import type { Database } from './client';
import { categories } from './schema';

/**
 * The fixed category tree of the MVP: car maintenance basics, one root and five
 * children (S4.0). Defined once, here; every lane names slugs through this
 * constant.
 *
 * The slugs are public URLs (`/categoria/<slug>`) and nothing redirects a
 * renamed one, so they are frozen. A display name or position may change: the
 * next migrate rewrites it. A unit test pins the whole constant on purpose.
 */
export const FIXED_CATEGORY_TREE = {
  slug: 'mantenimiento-del-coche',
  name: 'Mantenimiento del coche',
  position: 0,
  children: [
    { slug: 'aceite-de-motor', name: 'Aceite de motor', position: 0 },
    { slug: 'filtros-de-aceite', name: 'Filtros de aceite', position: 1 },
    { slug: 'filtros-de-aire', name: 'Filtros de aire', position: 2 },
    { slug: 'filtros-de-combustible', name: 'Filtros de combustible', position: 3 },
    { slug: 'filtros-de-habitaculo', name: 'Filtros de habitáculo', position: 4 },
  ],
} as const;

export type FixedCategorySlug =
  | typeof FIXED_CATEGORY_TREE.slug
  | (typeof FIXED_CATEGORY_TREE.children)[number]['slug'];

/**
 * Makes the fixed tree exist, with these slugs, names, parents and positions:
 * an upsert on slug in one transaction, so a second run leaves the same six
 * rows with the same ids. Never deletes, and touches no other category. A hand
 * edit of a fixed row is overwritten, which is the intent. Imports no
 * `server-only` and no client: `runMigrations` and the test reset call it.
 */
export async function ensureFixedCategoryTree(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const root = FIXED_CATEGORY_TREE;
    await tx
      .insert(categories)
      .values({ slug: root.slug, name: root.name, parentId: null, position: root.position })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { name: root.name, parentId: null, position: root.position },
      });
    const [rootRow] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, root.slug));

    for (const child of root.children) {
      await tx
        .insert(categories)
        .values({
          slug: child.slug,
          name: child.name,
          parentId: rootRow.id,
          position: child.position,
        })
        .onConflictDoUpdate({
          target: categories.slug,
          set: { name: child.name, parentId: rootRow.id, position: child.position },
        });
    }
  });
}
