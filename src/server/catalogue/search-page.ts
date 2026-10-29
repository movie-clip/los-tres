import 'server-only';

import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { errorCode } from '../error-code';
import { normalizePartNumber } from '../matching';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import type { CategoryProductCard } from './category-page';
import { eanCandidate } from './search-query';

// The backend/frontend contract for the search page (S5.4). Same shape as
// getPublicCategoryPage: a count, then a grouped card query, both through the
// one visibility scope; this file names no visibility flag. Integer cents, no
// formatting. No term, URL or query string is ever logged (guardrail 5).

export const SEARCH_PAGE_SIZE = 24;

/** The same card the category page lists; fields keep their documented meanings. */
export type SearchResultCard = CategoryProductCard;

/**
 * empty-query: no term, no database read.
 * no-results: the term matched no public product (a hidden-only match counts).
 * results: otherwise; `page` is between 1 and `pageCount`.
 */
export type PublicSearchPage =
  | { state: 'empty-query'; term: '' }
  | { state: 'no-results'; term: string }
  | {
      state: 'results';
      /** The cleaned term, echoed for the field, the count line and the title. */
      term: string;
      /** >= 1, <= pageCount. */
      page: number;
      /** >= 1. */
      pageCount: number;
      /** >= 1; public matches only. */
      productCount: number;
      /** 1..SEARCH_PAGE_SIZE, in relevance order. */
      products: SearchResultCard[];
      /** True when every visible offer behind the cards on this page is from a demo feed. */
      demoOnly: boolean;
    };

/**
 * One page of the public products matching `term`, or `null` (answer 404) for
 * a page past the last, or page 2 and beyond of a term with no public match.
 * `term` is parseSearchTerm output and `page` is parsePageParam output; neither
 * is clamped here. An empty term answers `empty-query` whatever the page.
 *
 * Three routes, OR'd, one row per product: text (every word, in the title
 * stemmed or in the brand unstemmed, see migration 0005_search), exact EAN, and
 * exact normalised part number. Order: an EAN or part-number match first, then
 * the lowest visible price, then products.id.
 *
 * Positional primitive arguments on purpose: React cache() memoises by
 * argument identity, so the page and generateMetadata share one read.
 *
 * A database failure logs `search: failed (<code>)` and throws a fixed error
 * with no cause: Drizzle's own message embeds the bound term.
 */
export async function getPublicSearchPage(
  term: string,
  page: number,
): Promise<PublicSearchPage | null> {
  if (term === '') return { state: 'empty-query', term: '' };

  const text = sql`${products.searchVector} @@ public.search_text_query(${term})`;
  const ean = eanCandidate(term);
  const partNumber = normalizePartNumber(term);
  const codeMatch: SQL | undefined = or(
    ean === null ? undefined : eq(products.eanNormalised, ean),
    partNumber === null ? undefined : eq(products.partNumberNormalised, partNumber),
  );
  const match = or(text, codeMatch) as SQL;
  const tier = codeMatch === undefined ? sql`1` : sql`case when ${codeMatch} then 0 else 1 end`;

  try {
    const db = getDb();

    const [counted] = await db
      .select({ productCount: sql<number>`count(*)::int` })
      .from(products)
      .where(and(visibleProductWhere(), match));
    const productCount = counted?.productCount ?? 0;
    if (productCount === 0) return page === 1 ? { state: 'no-results', term } : null;
    const pageCount = Math.max(1, Math.ceil(productCount / SEARCH_PAGE_SIZE));
    if (page > pageCount) return null;

    const lowestPrice = sql<number>`min(${offers.priceCents})::int`;
    const rows = await db
      .select({
        slug: products.slug,
        title: products.title,
        brand: products.brand,
        partNumber: products.partNumber,
        lowestPriceCents: lowestPrice,
        offerCount: sql<number>`count(*)::int`,
        categorySlug: categories.slug,
        allDemo: sql<boolean>`bool_and(${feeds.isDemo})`,
      })
      .from(offers)
      .innerJoin(products, eq(offers.productId, products.id))
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(visibleProductWhere(), visibleOfferWhere(), match))
      .groupBy(products.id, categories.id)
      // Every order ends on products.id, so pages never repeat or skip a product.
      .orderBy(asc(tier), asc(lowestPrice), asc(products.id))
      .limit(SEARCH_PAGE_SIZE)
      .offset((page - 1) * SEARCH_PAGE_SIZE);
    // Only if the data changed between the two reads.
    if (rows.length === 0) return page === 1 ? { state: 'no-results', term } : null;

    return {
      state: 'results',
      term,
      page,
      pageCount,
      productCount,
      products: rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        brand: row.brand,
        lowestPriceCents: row.lowestPriceCents,
        offerCount: row.offerCount,
        categorySlug: row.categorySlug,
        partNumber: row.partNumber?.trim() || null,
      })),
      demoOnly: rows.every((row) => row.allDemo),
    };
  } catch (error) {
    // The Postgres code lives on the cause of Drizzle's wrapper. Never the
    // message: it embeds the term.
    console.error(
      `search: failed (${errorCode(error instanceof Error && error.cause !== undefined ? error.cause : error)})`,
    );
    throw new Error('search: failed');
  }
}
