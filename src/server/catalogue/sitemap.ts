import 'server-only';

import { and, asc, sql } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, products } from '../../db/schema';
import { isWellFormedSlug } from '../slug';
import { visibleProductWhere } from '../visibility';
import { hasNonDemoOfferWhere } from './demo';

// What a search engine is offered (S6.2): products that are public by the one
// visibility scope and are not demo-only, plus the categories whose subtree
// holds at least one of them. Indexable and listed are the same set.

export const SITEMAP_CHUNK_SIZE = 5000;

type CategoryRow = { id: number; slug: string };

/** Number of product sitemap files: `ceil(count / chunkSize)`, 0 when nothing is listed. */
export async function countSitemapProductChunks(
  chunkSize: number = SITEMAP_CHUNK_SIZE,
): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(products)
    .where(and(visibleProductWhere(), hasNonDemoOfferWhere()));
  return Math.ceil((row?.total ?? 0) / chunkSize);
}

/**
 * The slugs of one product sitemap file, ordered by products.id. `chunk` is
 * 1-based; `null` when it is not an integer in 1..chunk count.
 */
export async function getSitemapProductSlugs(
  chunk: number,
  chunkSize: number = SITEMAP_CHUNK_SIZE,
): Promise<string[] | null> {
  if (!Number.isInteger(chunk) || chunk < 1) return null;
  const chunkCount = await countSitemapProductChunks(chunkSize);
  if (chunk > chunkCount) return null;
  const rows = await getDb()
    .select({ slug: products.slug })
    .from(products)
    .where(and(visibleProductWhere(), hasNonDemoOfferWhere()))
    .orderBy(asc(products.id))
    .limit(chunkSize)
    .offset((chunk - 1) * chunkSize);
  return rows.map((row) => row.slug).filter(isWellFormedSlug);
}

/**
 * Categories at any depth whose subtree holds at least one sitemap product,
 * ordered by categories.id, well-formed slugs only. The closure is the one in
 * category-tree.ts (`UNION`, so a malformed parent cycle terminates).
 */
export async function getSitemapCategorySlugs(): Promise<string[]> {
  const result = await getDb().execute<CategoryRow>(sql`
    with recursive closure(ancestor_id, descendant_id) as (
      select ${categories.id}, ${categories.id} from ${categories}
      union
      select closure.ancestor_id, child.id from ${categories} as child
      join closure on child.parent_id = closure.descendant_id
    )
    select c.id as id, c.slug as slug
    from ${categories} as c
    where exists (
      select 1
      from closure
      join ${products} on ${products.categoryId} = closure.descendant_id
      where closure.ancestor_id = c.id
        and ${visibleProductWhere()}
        and ${hasNonDemoOfferWhere()}
    )
    order by c.id asc
  `);
  return result.rows.map((row) => row.slug).filter(isWellFormedSlug);
}
