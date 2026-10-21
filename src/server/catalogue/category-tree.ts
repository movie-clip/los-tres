import 'server-only';

import { asc, sql } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, products } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleProductWhere } from '../visibility';

// The backend/frontend contract for the home page category tree (S5.2). The
// page renders what it is given: filtering and ordering happen here. A category
// is returned only when its own category page would show productCount >= 1,
// and the count is the number that page shows (invariant I-1, 02-design).

export type CategoryTreeChild = {
  /** categories.slug; link target /categoria/<slug>. Always well-formed. */
  slug: string;
  /** categories.name. Never empty. */
  name: string;
  /** Public products in this category and every descendant at any depth. Integer >= 1. */
  productCount: number;
};

export type CategoryTreeGroup = CategoryTreeChild & {
  /** Direct children with productCount >= 1, ordered. Empty array when none. */
  children: CategoryTreeChild[];
};

type CountRow = { ancestor_id: number; product_count: number };

/**
 * Public product count per category, subtree included. The closure pairs every
 * category with itself and with each descendant at any depth. `UNION` (not
 * `UNION ALL`) so a malformed parent cycle terminates, the same rule as
 * `inSubtree` in category-page.ts. Visibility is `visibleProductWhere()`,
 * never restated here (guardrail 1).
 */
async function countPublicProductsBySubtree(): Promise<Map<number, number>> {
  const result = await getDb().execute<CountRow>(sql`
    with recursive closure(ancestor_id, descendant_id) as (
      select ${categories.id}, ${categories.id} from ${categories}
      union
      select closure.ancestor_id, child.id from ${categories} as child
      join closure on child.parent_id = closure.descendant_id
    )
    select closure.ancestor_id as ancestor_id,
           count(distinct ${products.id})::int as product_count
    from closure
    join ${products} on ${products.categoryId} = closure.descendant_id
    where ${visibleProductWhere()}
    group by closure.ancestor_id
  `);
  return new Map(result.rows.map((row) => [Number(row.ancestor_id), Number(row.product_count)]));
}

/**
 * Top-level categories (no parent) with at least one public product in their
 * subtree, each with its direct children that have at least one, both levels
 * ordered by position, name, id. Deeper categories are never returned; their
 * products count into their ancestors. `[]` means nothing is public yet.
 */
export async function getPublicCategoryTree(): Promise<CategoryTreeGroup[]> {
  const counts = await countPublicProductsBySubtree();
  const rows = await getDb()
    .select({
      id: categories.id,
      parentId: categories.parentId,
      slug: categories.slug,
      name: categories.name,
    })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name), asc(categories.id));

  const nodeFor = (row: (typeof rows)[number]): CategoryTreeChild | null => {
    const productCount = counts.get(row.id) ?? 0;
    if (productCount < 1 || !isWellFormedSlug(row.slug)) return null;
    return { slug: row.slug, name: row.name, productCount };
  };

  const groups: CategoryTreeGroup[] = [];
  for (const root of rows.filter((row) => row.parentId === null)) {
    const node = nodeFor(root);
    if (!node) continue;
    const children: CategoryTreeChild[] = [];
    for (const row of rows) {
      if (row.parentId !== root.id) continue;
      const child = nodeFor(row);
      if (child) children.push(child);
    }
    groups.push({ ...node, children });
  }
  return groups;
}
