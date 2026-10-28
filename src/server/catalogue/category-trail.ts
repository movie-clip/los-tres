import 'server-only';

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories } from '../../db/schema';

// The category trail, shared by the product page and the category page.

export type PublicCategoryCrumb = {
  /** categories.slug; the page links it with categoryPath(slug) (page 1, no filter). */
  slug: string;
  /** categories.name. Never empty. Display text, not a message key. */
  name: string;
};

/**
 * The category and its ancestors, root first; [] when the id matches no row.
 * Read from the `categories` table (runtime truth), not from the fixed-tree
 * constant. `depth < 8` is the cycle guard: the depth column makes rows
 * distinct, so UNION alone would not stop a malformed parent cycle; a deeper
 * chain is cut at the root end.
 */
export async function readCategoryTrail(categoryId: number): Promise<PublicCategoryCrumb[]> {
  const result = await getDb().execute<PublicCategoryCrumb>(sql`
    with recursive trail(id, parent_id, slug, name, depth) as (
      select id, parent_id, slug, name, 0 from ${categories} where id = ${categoryId}
      union all
      select c.id, c.parent_id, c.slug, c.name, t.depth + 1
      from ${categories} c join trail t on c.id = t.parent_id
      where t.depth < 8
    )
    select slug, name from trail order by depth desc
  `);
  return result.rows.map((row) => ({ slug: row.slug, name: row.name }));
}
