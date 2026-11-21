import 'server-only';

import { and, asc, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';

// Relative on purpose: files in src/server import each other relatively.
import { getDb } from '../../db/client';
import { feeds, offers, products, shops } from '../../db/schema';
import { eanCandidate, parseSearchTerm } from '../catalogue/search-query';
import { driverErrorCode } from '../error-code';
import { normalizePartNumber } from '../matching';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import { ADMIN_PRODUCTS_PAGE_SIZE, type AdminProductListQuery } from './product-rules';

// The admin's view of products and their offers, and the only writer of the
// hidden flags (S2.4, guardrail 1; tests/unit/seams.test.ts fences both). A
// hide or unhide sets one flag on one row and nothing else: the product's flag
// and an offer's flag are independent, and neither writer touches the other
// table (D-10). Whether a row is public now is never derived here from flags:
// it is the shared visibility scope, selected as a boolean, so the screen and
// the public page cannot disagree. No offer or feed address is selected or
// returned (AC 24). A failed read logs one fixed line with a code and throws a
// fixed error with no cause, because Drizzle's own message embeds the bound
// search term (guardrail 5); the writers log nothing and let the action catch.

/** One product of the admin list or page. `id` is for links only and is never printed. */
export type AdminProductRow = {
  id: number;
  slug: string;
  title: string;
  /** Trimmed; blank is null. */
  brand: string | null;
  /** Trimmed; blank is null. */
  partNumber: string | null;
  /** As stored, trimmed; blank is null. */
  ean: string | null;
  /** The admin's hide. */
  hidden: boolean;
  /** The public product page answers with this product now. */
  publicNow: boolean;
};

/** Why a list is empty: no product at all, none hidden, or none matching the term. */
export type AdminProductEmpty = 'no_products' | 'no_hidden' | 'no_match';

export type AdminProductList = {
  /** The cleaned term actually searched. */
  term: string;
  hiddenOnly: boolean;
  /** The page as parsed, at least 1. */
  page: number;
  pageSize: number;
  /** Matching products. */
  total: number;
  /** ceil(total / pageSize); 0 when total is 0. */
  pageCount: number;
  /** total > 0 and page > pageCount; `rows` is then empty. */
  pastLast: boolean;
  /** Non-null exactly when total is 0. */
  empty: AdminProductEmpty | null;
  rows: AdminProductRow[];
};

export type AdminOfferRow = {
  id: number;
  shopName: string;
  /** Feeds have no name; the screen shows "Feed <feedId>". */
  feedId: number;
  /** Integer cents, EUR, IVA included. */
  priceCents: number;
  /** The admin's hide. */
  hidden: boolean;
  /** The public product page lists this offer now. */
  publicNow: boolean;
};

/** A product with every one of its offers, whatever their state; `offers` may be empty. */
export type AdminProductDetail = AdminProductRow & { offers: AdminOfferRow[] };

/** What a writer stored, read back in the same transaction. */
export type HiddenStored = { id: number; hidden: boolean; publicNow: boolean };

/** The public product page answers with the product: the shared scope, as a boolean. */
const productPublicNow = (): SQL<boolean> => sql<boolean>`${visibleProductWhere()}`;

/** The public product page lists the offer: the shared offer scope and the product's, as a boolean. */
const offerPublicNow = (): SQL<boolean> =>
  sql<boolean>`(${visibleOfferWhere()}) and (${visibleProductWhere()})`;

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

const productColumns = () => ({
  id: products.id,
  slug: products.slug,
  title: products.title,
  brand: products.brand,
  partNumber: products.partNumber,
  ean: products.ean,
  hidden: products.isHidden,
  publicNow: productPublicNow(),
});

function toProductRow(row: {
  id: number;
  slug: string;
  title: string;
  brand: string | null;
  partNumber: string | null;
  ean: string | null;
  hidden: boolean;
  publicNow: boolean;
}): AdminProductRow {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    brand: blankToNull(row.brand),
    partNumber: blankToNull(row.partNumber),
    ean: blankToNull(row.ean),
    hidden: row.hidden,
    publicNow: row.publicNow,
  };
}

/** Logs one fixed line and throws a fixed error with no cause. */
function readFailed(error: unknown): never {
  console.error(`admin-products: failed (${driverErrorCode(error)})`);
  throw new Error('admin-products: read failed');
}

/**
 * The text of a search term as the public search matches it (the SQL function
 * of migration 0005), or an exact EAN, an exact normalised part number or the
 * slug in lower case. A hidden or unmapped product matches like any other.
 */
function termMatch(term: string): SQL {
  const ean = eanCandidate(term);
  const partNumber = normalizePartNumber(term);
  return or(
    sql`${products.searchVector} @@ public.search_text_query(${term})`,
    ean === null ? undefined : eq(products.eanNormalised, ean),
    partNumber === null ? undefined : eq(products.partNumberNormalised, partNumber),
    eq(products.slug, term.toLowerCase()),
  ) as SQL;
}

/**
 * One page of every product, whatever its state (hidden or not, mapped or not,
 * with or without an offer, from an approved feed or not), newest first, ties
 * on the id. `query` is the output of `parseAdminProductListQuery`; the term is
 * cleaned again here, which changes nothing for a cleaned one. A page past the
 * last reads no rows.
 */
export async function listProductsForAdmin(query: AdminProductListQuery): Promise<AdminProductList> {
  const term = parseSearchTerm(query.term);
  const hiddenOnly = query.hiddenOnly;
  const page = Number.isSafeInteger(query.page) && query.page >= 1 ? query.page : 1;
  const pageSize = ADMIN_PRODUCTS_PAGE_SIZE;
  const where = and(term === '' ? undefined : termMatch(term), hiddenOnly ? eq(products.isHidden, true) : undefined);

  try {
    const db = getDb();
    const [counted] = await db.select({ total: count() }).from(products).where(where);
    const total = counted?.total ?? 0;
    const pageCount = Math.ceil(total / pageSize);
    const pastLast = total > 0 && page > pageCount;
    const empty: AdminProductEmpty | null =
      total > 0 ? null : term !== '' ? 'no_match' : hiddenOnly ? 'no_hidden' : 'no_products';

    let rows: AdminProductRow[] = [];
    if (total > 0 && !pastLast) {
      const found = await db
        .select(productColumns())
        .from(products)
        .where(where)
        .orderBy(desc(products.createdAt), desc(products.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      rows = found.map(toProductRow);
    }
    return { term, hiddenOnly, page, pageSize, total, pageCount, pastLast, empty, rows };
  } catch (error) {
    return readFailed(error);
  }
}

/**
 * One product and every offer it has, or null when there is no such product.
 * Offers come in the public order: price, shop name, id.
 */
export async function readProductForAdmin(id: number): Promise<AdminProductDetail | null> {
  try {
    const db = getDb();
    const [product] = await db.select(productColumns()).from(products).where(eq(products.id, id));
    if (!product) return null;

    const found = await db
      .select({
        id: offers.id,
        shopName: shops.name,
        feedId: feeds.id,
        priceCents: offers.priceCents,
        hidden: offers.isHidden,
        publicNow: offerPublicNow(),
      })
      .from(offers)
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(products, eq(offers.productId, products.id))
      .where(eq(offers.productId, id))
      .orderBy(asc(offers.priceCents), asc(shops.name), asc(offers.id));
    return { ...toProductRow(product), offers: found };
  } catch (error) {
    return readFailed(error);
  }
}

/**
 * Sets one product's hidden flag to `hidden` and returns what was stored with
 * whether the public page now shows it, or null when no such product exists
 * (nothing is written). One transaction; sets the flag and no other column of
 * no other row, and is idempotent. Throws only on a database failure.
 */
export async function setProductHidden(productId: number, hidden: boolean): Promise<HiddenStored | null> {
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(products)
      .set({ isHidden: hidden })
      .where(eq(products.id, productId))
      .returning({ id: products.id, hidden: products.isHidden });
    if (updated.length === 0) return null;
    const [seen] = await tx
      .select({ publicNow: productPublicNow() })
      .from(products)
      .where(eq(products.id, productId));
    return { id: updated[0].id, hidden: updated[0].hidden, publicNow: seen.publicNow };
  });
}

/**
 * Sets one offer's hidden flag to `hidden` and returns what was stored with
 * whether the public page now lists it, or null when no such offer exists
 * (nothing is written). Touches no product and no other offer.
 */
export async function setOfferHidden(offerId: number, hidden: boolean): Promise<HiddenStored | null> {
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(offers)
      .set({ isHidden: hidden })
      .where(eq(offers.id, offerId))
      .returning({ id: offers.id, hidden: offers.isHidden });
    if (updated.length === 0) return null;
    const [seen] = await tx
      .select({ publicNow: offerPublicNow() })
      .from(offers)
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(products, eq(offers.productId, products.id))
      .where(eq(offers.id, offerId));
    return { id: updated[0].id, hidden: updated[0].hidden, publicNow: seen.publicNow };
  });
}
