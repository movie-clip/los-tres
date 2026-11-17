import 'server-only';

import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { errorCode } from '../error-code';
import { normalizePartNumber } from '../matching';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import type { CategoryFitCounts, CategoryProductCard } from './category-page';
import { fitCountsSql, fitScope, groupRankSql, listedFitSql, type ListingGroup } from './fit-listing';
import type { FitState } from './fit-state';
import { eanCandidate } from './search-query';

// The backend/frontend contract for the search page (S5.4, S5.8). Same shape as
// getPublicCategoryPage: a count, then a grouped card query, both through the
// one visibility scope; this file names no visibility flag. Integer cents, no
// formatting. No term, URL, query string or vehicle id is ever logged
// (guardrail 5).

export const SEARCH_PAGE_SIZE = 24;

/** The same card the category page lists; fields keep their documented meanings. */
export type SearchResultCard = CategoryProductCard;

/**
 * The four counts of a search under a car, zeros included. fitsCount, unknownCount
 * and leftOutCount keep their meaning on the category page (leftOutCount: no-fit
 * products matched by text only; not listed). `exactNoFitCount` is the no-fit
 * products listed through the exact EAN or part-number rule (D-1); a product is in
 * exactly one of the four, so they sum to the no-car `productCount` of the term.
 */
export type SearchFitCounts = CategoryFitCounts & {
  exactNoFitCount: number;
};

/**
 * empty-query: no term, no database read.
 * no-results: the term matched no public product (a hidden-only match counts).
 * all-left-out: with a car, page 1 only: public products match, none is listed
 *   (every one is a no-fit product reached by text only).
 * results: otherwise; `page` is between 1 and `pageCount`.
 */
export type PublicSearchPage =
  | { state: 'empty-query'; term: '' }
  | { state: 'no-results'; term: string }
  | {
      state: 'all-left-out';
      term: string;
      /** >= 1: the public matches, all left out for not fitting the car. */
      leftOutCount: number;
    }
  | {
      state: 'results';
      /** The cleaned term, echoed for the field, the count line and the title. */
      term: string;
      /** >= 1, <= pageCount. */
      page: number;
      /** >= 1. */
      pageCount: number;
      /**
       * >= 1; public matches only. With a car, the listed ones: fits, unknown and
       * the exact-code no-fit (`fit.fitsCount + fit.unknownCount + fit.exactNoFitCount`).
       */
      productCount: number;
      /**
       * 1..SEARCH_PAGE_SIZE. Without a car, in relevance order. With a car, the
       * fits first, then the unknown, then the exact-code no-fit, each in
       * relevance order.
       */
      products: SearchResultCard[];
      /** True when every visible offer behind the cards on this page is from a demo feed. */
      demoOnly: boolean;
      /** The four counts across all pages; null exactly when the loader was called with `vehicleId === null`. */
      fit: SearchFitCounts | null;
    };

/** The group of a listed search card: a no-fit one is listed only by an exact code. */
function searchGroupOf(fit: FitState, exact: boolean): ListingGroup {
  if (fit !== 'no-fit') return fit;
  // The query lists a no-fit product only when it is an exact code match; one
  // reaching here without it is a fault, not a group to invent.
  if (!exact) throw new Error('search-page: no-fit card without an exact code');
  return 'no-fit-exact';
}

type CardFields = Omit<SearchResultCard, 'fitGroup' | 'partNumber'> & { partNumber: string | null };

function toCard(row: CardFields, fitGroup: ListingGroup | null): SearchResultCard {
  return {
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    lowestPriceCents: row.lowestPriceCents,
    offerCount: row.offerCount,
    categorySlug: row.categorySlug,
    partNumber: row.partNumber?.trim() || null,
    fitGroup,
  };
}

/**
 * One page of the public products matching `term`, or `null` (answer 404) for
 * a page past the last, or page 2 and beyond of a term with no public match, or,
 * with a car, of a term whose matches are all left out. `term` is parseSearchTerm
 * output and `page` is parsePageParam output; neither is clamped here. An empty
 * term answers `empty-query` whatever the page.
 *
 * Three routes, OR'd, one row per product: text (every word, in the title
 * stemmed or in the brand unstemmed, see migration 0005_search), exact EAN, and
 * exact normalised part number. Order: an EAN or part-number match first, then
 * the lowest visible price, then products.id.
 *
 * `vehicleId` is `selectedVehicleId(car)`: the id of a selected car, else null.
 * With null the search is exactly the no-car one: `fit` is null and every
 * `fitGroup` is null. With an id the results are the products that fit, then the
 * unknown ones, then the no-fit ones matched by an exact EAN (8 or 13 digits) or
 * an exact normalised part number (D-1); a no-fit product reached by text only is
 * left out and counted. Inside each group the no-car order holds. The exception
 * is an OR inside a scope already limited to public products and visible offers.
 *
 * Positional primitive arguments on purpose: React cache() memoises by
 * argument identity, so the page and generateMetadata share one read.
 *
 * A database failure, the fit read included, logs `search: failed (<code>)` and
 * throws a fixed error with no cause: Drizzle's own message embeds the bound
 * term and the vehicle id.
 */
export async function getPublicSearchPage(
  term: string,
  page: number,
  vehicleId: number | null = null,
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
  // eanNormalised and partNumberNormalised are nullable: a null code match inside
  // `not exact` would drop rows from a count filter, so every use is coalesced.
  const exact = (
    codeMatch === undefined ? sql`false` : sql`coalesce(${codeMatch}, false)`
  ) as SQL<boolean>;

  try {
    const db = getDb();

    let productCount: number;
    let fit: SearchFitCounts | null = null;
    if (vehicleId === null) {
      const [counted] = await db
        .select({ productCount: sql<number>`count(*)::int` })
        .from(products)
        .where(and(visibleProductWhere(), match));
      productCount = counted?.productCount ?? 0;
      if (productCount === 0) return page === 1 ? { state: 'no-results', term } : null;
    } else {
      const scope = fitScope(vehicleId, and(visibleProductWhere(), match));
      const [counted] = await db
        .select(fitCountsSql(scope.fit, exact))
        .from(products)
        .innerJoin(scope, eq(scope.id, products.id));
      fit = {
        fitsCount: counted?.fitsCount ?? 0,
        unknownCount: counted?.unknownCount ?? 0,
        leftOutCount: counted?.leftOutCount ?? 0,
        exactNoFitCount: counted?.exactNoFitCount ?? 0,
      };
      productCount = fit.fitsCount + fit.unknownCount + fit.exactNoFitCount;
      if (productCount === 0) {
        if (page !== 1) return null;
        return fit.leftOutCount === 0
          ? { state: 'no-results', term }
          : { state: 'all-left-out', term, leftOutCount: fit.leftOutCount };
      }
    }
    const pageCount = Math.max(1, Math.ceil(productCount / SEARCH_PAGE_SIZE));
    if (page > pageCount) return null;

    const lowestPrice = sql<number>`min(${offers.priceCents})::int`;
    const cardColumns = {
      slug: products.slug,
      title: products.title,
      brand: products.brand,
      partNumber: products.partNumber,
      lowestPriceCents: lowestPrice,
      offerCount: sql<number>`count(*)::int`,
      categorySlug: categories.slug,
      allDemo: sql<boolean>`bool_and(${feeds.isDemo})`,
    };
    let cards: SearchResultCard[];
    let demoOnly: boolean;
    if (vehicleId === null) {
      const rows = await db
        .select(cardColumns)
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
      cards = rows.map((row) => toCard(row, null));
      demoOnly = rows.every((row) => row.allDemo);
    } else {
      // Fits, then unknown, then the exact-code no-fit; the no-car order inside each.
      const scope = fitScope(vehicleId, and(visibleProductWhere(), match));
      const rows = await db
        .select({ ...cardColumns, fit: scope.fit, exact })
        .from(offers)
        .innerJoin(products, eq(offers.productId, products.id))
        .innerJoin(feeds, eq(offers.feedId, feeds.id))
        .innerJoin(shops, eq(feeds.shopId, shops.id))
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(scope, eq(scope.id, products.id))
        .where(
          and(
            visibleProductWhere(),
            visibleOfferWhere(),
            match,
            or(listedFitSql(scope.fit), exact),
          ),
        )
        .groupBy(products.id, categories.id, scope.fit)
        .orderBy(
          asc(groupRankSql(scope.fit, exact)),
          asc(tier),
          asc(lowestPrice),
          asc(products.id),
        )
        .limit(SEARCH_PAGE_SIZE)
        .offset((page - 1) * SEARCH_PAGE_SIZE);
      if (rows.length === 0) return page === 1 ? { state: 'no-results', term } : null;
      cards = rows.map((row) => toCard(row, searchGroupOf(row.fit, row.exact)));
      demoOnly = rows.every((row) => row.allDemo);
    }

    return { state: 'results', term, page, pageCount, productCount, products: cards, demoOnly, fit };
  } catch (error) {
    // The Postgres code lives on the cause of Drizzle's wrapper. Never the
    // message: it embeds the term and the vehicle id.
    console.error(
      `search: failed (${errorCode(error instanceof Error && error.cause !== undefined ? error.cause : error)})`,
    );
    throw new Error('search: failed');
  }
}
