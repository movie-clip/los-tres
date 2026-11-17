import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../../db/client';
import { categories, feeds, offers, products, shops } from '../../db/schema';
import { errorCode } from '../error-code';
import { isWellFormedSlug } from '../slug';
import { visibleOfferWhere, visibleProductWhere } from '../visibility';
import { brandSlug, type CategorySort } from './category-query';
import { readCategoryTrail, type PublicCategoryCrumb } from './category-trail';
import { hasNonDemoOfferWhere } from './demo';
import {
  fitCountsSql,
  fitScope,
  groupRankSql,
  listedFitSql,
  listingGroupOf,
  type ListingGroup,
} from './fit-listing';

export type { ListingGroup } from './fit-listing';

// The backend/frontend contract for the category page (C-3, S11.4, S5.8). The
// page formats; this returns integer cents, never a formatted amount. Every
// product it lists, and every brand it counts, is public by the one visibility
// scope, the same one the product page uses. With a selected car (S5.8) the
// fit of each product is computed inside the listing's own queries.

export const CATEGORY_PAGE_SIZE = 24;

export type CategoryProductCard = {
  /** products.slug; link target /producto/<slug>. */
  slug: string;
  /** Never empty. */
  title: string;
  /** As received; null means render no brand line. */
  brand: string | null;
  /**
   * min(visible offers.price_cents). Integer > 0, EUR, IVA included. Equals
   * getPublicProductBySlug(slug).offers[0].priceCents for the same data.
   */
  lowestPriceCents: number;
  /**
   * count(visible offers). Integer >= 1. The same number the product page
   * shows as offers.length.
   */
  offerCount: number;
  /** categories.slug of the product's own category; never null for a public product. */
  categorySlug: string;
  /** products.part_number as received, trimmed; null when null or blank. */
  partNumber: string | null;
  /**
   * Null exactly when the loader was called with `vehicleId === null`. With a
   * car: `fits` or `unknown` on the category page (never `no-fit-exact`; that
   * value is for search, S5.8).
   */
  fitGroup: ListingGroup | null;
};

export type CategoryBrand = {
  /** brandSlug(...); matches /^[a-z0-9]+(-[a-z0-9]+)*$/, 1..64 chars, unique in the list. */
  slug: string;
  /**
   * Display text, never empty. Chosen by the public count of each merged group,
   * so a car never renames a chip.
   */
  label: string;
  /**
   * Without a car: public products of this brand in the subtree, integer >= 1.
   * With a car: the listed ones (fits + unknown) of the whole subtree, whatever
   * the selected brand and the sort, integer >= 0. A chip at 0 stays in the list
   * so a URL brand whose products are all left out still resolves.
   */
  productCount: number;
};

/**
 * empty-category: the whole subtree holds no public product.
 * all-left-out: with a car, the subtree holds some, the listed set is empty and
 *   at least one public product of it was left out for not fitting the car.
 * no-match: it holds some, and the listed set (after the brand filter) is empty.
 * results: otherwise.
 */
export type CategoryListingState = 'results' | 'no-match' | 'empty-category' | 'all-left-out';

export type CategoryFitCounts = {
  /** Listed set (after the brand filter), each product once, across all pages. Integers >= 0. */
  fitsCount: number;
  unknownCount: number;
  /** Public products of the listed scope whose fit is no-fit; not listed. */
  leftOutCount: number;
};

export type PublicCategoryPage = {
  /** categories.slug */
  slug: string;
  /** categories.name */
  name: string;
  /**
   * The category's ancestors, root first, the category itself excluded.
   * [] for a root category. Each links with categoryPath(slug) (page 1, no filter).
   */
  ancestors: PublicCategoryCrumb[];
  /** 1-based, the page returned. */
  page: number;
  /** >= 1; ceil(productCount / CATEGORY_PAGE_SIZE), exactly 1 when productCount is 0. */
  pageCount: number;
  /**
   * Public products in the listed set: the category and every descendant,
   * narrowed to the selected brand when there is one. With a car, only the ones
   * that fit or are unknown (`fit.fitsCount + fit.unknownCount`).
   */
  productCount: number;
  /** Public products in the whole subtree, whatever the brand and the car. */
  categoryProductCount: number;
  state: CategoryListingState;
  /**
   * The three counts of the listed scope with a car, zeros included; null
   * exactly when the loader was called with `vehicleId === null`. Invariant:
   * their sum equals the no-car `productCount` for the same slug and brand.
   */
  fit: CategoryFitCounts | null;
  /**
   * Length 0..CATEGORY_PAGE_SIZE; 0 only when state is not 'results'. With a
   * car, the cards that fit first, then the unknown ones, each in the chosen sort.
   */
  products: CategoryProductCard[];
  /**
   * The brands of the whole subtree, independent of the selected brand and the
   * sort: productCount desc, then label, then slug. Empty for an empty category.
   */
  brands: CategoryBrand[];
  /** The entry of `brands` whose slug is the brand argument; null if none or unknown. */
  selectedBrand: CategoryBrand | null;
  /** The sort applied. */
  sort: CategorySort;
  /**
   * True when products.length >= 1 and every visible offer behind the listed
   * cards is from a demo feed. False when nothing is listed.
   */
  demoOnly: boolean;
  /**
   * True when the category subtree holds at least one public product with an
   * offer from a non-demo feed, whatever the brand. The same for every page
   * and every brand of the category. False means noindex.
   */
  indexable: boolean;
};

/**
 * `products.category_id` is in the category's subtree: the category and every
 * descendant at any depth. `UNION` (not `UNION ALL`) so a malformed parent
 * cycle terminates. The category id is a bound parameter.
 */
function inSubtree(categoryId: number): SQL {
  const subtree = sql`(
    with recursive subtree(id) as (
      select ${categoryId}::int
      union
      select child.id from ${categories} as child
      join subtree on child.parent_id = subtree.id
    )
    select id from subtree
  )`;
  return inArray(products.categoryId, subtree);
}

/** Locale-neutral label order: no language in code (D-8). */
function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, 'und', { sensitivity: 'base' });
}

/**
 * `productCount` is the public count of the group; `listedCount` the one shown
 * on the chip (the same number without a car, fits + unknown with one).
 */
type BrandGroup = {
  normalised: string;
  label: string | null;
  productCount: number;
  listedCount: number;
};

/**
 * The brand list of the whole subtree from its per-brand_normalised groups.
 * Groups that share a slug merge into one chip with the counts summed; the
 * label is the one of the group with the larger public count, a tie going to
 * the smaller label, so a car never renames a chip. The chip order is by the
 * listed count. `values` maps a chip slug to the brand_normalised values behind it.
 */
function mergeBrands(groups: BrandGroup[]): {
  brands: CategoryBrand[];
  values: Map<string, string[]>;
} {
  type Merged = CategoryBrand & { labelGroupCount: number };
  const merged = new Map<string, Merged>();
  const values = new Map<string, string[]>();
  for (const group of groups) {
    const slug = brandSlug(group.normalised);
    if (slug === null) continue;
    const label = group.label?.trim() || group.normalised;
    const existing = merged.get(slug);
    if (existing === undefined) {
      merged.set(slug, {
        slug,
        label,
        productCount: group.listedCount,
        labelGroupCount: group.productCount,
      });
      values.set(slug, [group.normalised]);
      continue;
    }
    existing.productCount += group.listedCount;
    values.get(slug)?.push(group.normalised);
    if (
      group.productCount > existing.labelGroupCount ||
      (group.productCount === existing.labelGroupCount && compareLabels(label, existing.label) < 0)
    ) {
      existing.label = label;
      existing.labelGroupCount = group.productCount;
    }
  }
  const brands = [...merged.values()]
    .map(({ slug, label, productCount }) => ({ slug, label, productCount }))
    .sort(
      (a, b) =>
        b.productCount - a.productCount ||
        compareLabels(a.label, b.label) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  return { brands, values };
}

type CardRow = {
  slug: string;
  title: string;
  brand: string | null;
  partNumber: string | null;
  lowestPriceCents: number;
  offerCount: number;
  categorySlug: string;
  allDemo: boolean;
  fitGroup: ListingGroup | null;
};

/**
 * The brand groups of the whole subtree. With a car each group also carries the
 * count of its listed products (fits + unknown); without one the two are equal.
 */
async function readBrandGroups(
  categoryId: number,
  vehicleId: number | null,
): Promise<BrandGroup[]> {
  const db = getDb();
  const where = and(
    visibleProductWhere(),
    inSubtree(categoryId),
    isNotNull(products.brandNormalised),
  );
  const normalised = sql<string>`${products.brandNormalised}`;
  const label = sql<string | null>`mode() within group (order by ${products.brand})`;
  const publicCount = sql<number>`count(*)::int`;

  if (vehicleId === null) {
    const groups = await db
      .select({ normalised, label, productCount: publicCount })
      .from(products)
      .where(where)
      .groupBy(products.brandNormalised);
    return groups.map((group) => ({ ...group, listedCount: group.productCount }));
  }

  const scope = fitScope(vehicleId, where);
  return db
    .select({
      normalised,
      label,
      productCount: publicCount,
      listedCount: sql<number>`count(*) filter (where ${listedFitSql(scope.fit)})::int`,
    })
    .from(products)
    .innerJoin(scope, eq(scope.id, products.id))
    .groupBy(products.brandNormalised);
}

/** The fits, unknown and left-out counts of the listed scope (after the brand filter). */
async function readFitCounts(
  categoryId: number,
  vehicleId: number,
  brandWhere: SQL | undefined,
): Promise<CategoryFitCounts> {
  const scope = fitScope(
    vehicleId,
    and(visibleProductWhere(), inSubtree(categoryId), brandWhere),
  );
  const [row] = await getDb().select(fitCountsSql(scope.fit)).from(scope);
  return {
    fitsCount: row?.fitsCount ?? 0,
    unknownCount: row?.unknownCount ?? 0,
    leftOutCount: row?.leftOutCount ?? 0,
  };
}

async function readCategoryPage(
  slug: string,
  page: number,
  brand: string | null,
  sort: CategorySort,
  vehicleId: number | null,
): Promise<PublicCategoryPage | null> {
  const db = getDb();

  const [category] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (!category) return null;

  const [[counted], [indexed], brandGroups, trail] = await Promise.all([
    db
      .select({ productCount: sql<number>`count(*)::int` })
      .from(products)
      .where(and(visibleProductWhere(), inSubtree(category.id))),
    db
      .select({ indexedCount: sql<number>`count(*)::int` })
      .from(products)
      .where(and(visibleProductWhere(), hasNonDemoOfferWhere(), inSubtree(category.id))),
    readBrandGroups(category.id, vehicleId),
    readCategoryTrail(category.id),
  ]);
  const categoryProductCount = counted?.productCount ?? 0;
  const indexable = (indexed?.indexedCount ?? 0) > 0;
  const { brands, values } = mergeBrands(brandGroups);
  const selectedBrand =
    brand === null ? null : (brands.find((entry) => entry.slug === brand) ?? null);

  // A brand argument that names no chip lists nothing; a chip narrows the set
  // to the brand_normalised values behind it.
  const brandValues = selectedBrand === null ? [] : (values.get(selectedBrand.slug) ?? []);
  const brandWhere: SQL | undefined =
    brand === null ? undefined : inArray(products.brandNormalised, brandValues);
  const namesNoBrand = brand !== null && brandValues.length === 0;

  let productCount = categoryProductCount;
  let fit: CategoryFitCounts | null = null;
  if (vehicleId === null) {
    if (brand !== null) {
      if (namesNoBrand) {
        productCount = 0;
      } else {
        const [filtered] = await db
          .select({ productCount: sql<number>`count(*)::int` })
          .from(products)
          .where(and(visibleProductWhere(), inSubtree(category.id), brandWhere));
        productCount = filtered?.productCount ?? 0;
      }
    }
  } else {
    // The listed set under a car: what fits and what is unknown. The left-out
    // ones are counted, never listed.
    fit = namesNoBrand
      ? { fitsCount: 0, unknownCount: 0, leftOutCount: 0 }
      : await readFitCounts(category.id, vehicleId, brandWhere);
    productCount = fit.fitsCount + fit.unknownCount;
  }
  const pageCount = Math.max(1, Math.ceil(productCount / CATEGORY_PAGE_SIZE));
  if (page > pageCount) return null;

  const lowestPrice = sql<number>`min(${offers.priceCents})::int`;
  // Every order ends on products.id, so pages never repeat or skip a product.
  // Name order is the ICU root collation: no language, accents and case ignored
  // at the primary level (D-8, D-11).
  const order =
    sort === 'price-desc'
      ? [desc(lowestPrice), asc(products.id)]
      : sort === 'name'
        ? [sql`${products.title} collate "und-x-icu" asc`, asc(products.id)]
        : [asc(lowestPrice), asc(products.id)];
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
  let rows: CardRow[] = [];
  if (productCount === 0) {
    rows = [];
  } else if (vehicleId === null) {
    const plain = await db
      .select(cardColumns)
      .from(offers)
      .innerJoin(products, eq(offers.productId, products.id))
      .innerJoin(feeds, eq(offers.feedId, feeds.id))
      .innerJoin(shops, eq(feeds.shopId, shops.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(visibleProductWhere(), visibleOfferWhere(), inSubtree(category.id), brandWhere))
      .groupBy(products.id, categories.id)
      .orderBy(...order)
      .limit(CATEGORY_PAGE_SIZE)
      .offset((page - 1) * CATEGORY_PAGE_SIZE);
    rows = plain.map((row) => ({ ...row, fitGroup: null }));
  } else {
    // Fits first, then unknown, each in the chosen sort; no-fit is not listed.
    const scope = fitScope(
      vehicleId,
      and(visibleProductWhere(), inSubtree(category.id), brandWhere),
    );
    const grouped = await db
      .select({ ...cardColumns, fit: scope.fit })
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
          inSubtree(category.id),
          brandWhere,
          listedFitSql(scope.fit),
        ),
      )
      .groupBy(products.id, categories.id, scope.fit)
      .orderBy(groupRankSql(scope.fit), ...order)
      .limit(CATEGORY_PAGE_SIZE)
      .offset((page - 1) * CATEGORY_PAGE_SIZE);
    rows = grouped.map(({ fit: state, ...row }) => ({ ...row, fitGroup: listingGroupOf(state) }));
  }

  const state: CategoryListingState =
    categoryProductCount === 0
      ? 'empty-category'
      : productCount === 0
        ? fit !== null && fit.leftOutCount > 0
          ? 'all-left-out'
          : 'no-match'
        : 'results';

  return {
    slug: category.slug,
    name: category.name,
    ancestors: trail.slice(0, -1),
    page,
    pageCount,
    productCount,
    categoryProductCount,
    state,
    fit,
    products: rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      lowestPriceCents: row.lowestPriceCents,
      offerCount: row.offerCount,
      categorySlug: row.categorySlug,
      partNumber: row.partNumber?.trim() || null,
      fitGroup: row.fitGroup,
    })),
    brands,
    selectedBrand,
    sort,
    demoOnly: rows.length > 0 && rows.every((row) => row.allDemo),
    indexable,
  };
}

/**
 * One page of the public products of a category, or `null` for: a malformed
 * slug (rejected before any query), an unknown slug, or a page past the last
 * (of the listed set, so after the brand filter and, with a car, after the
 * left-out products). `page` is an integer >= 1 (see parsePageParam); it is not
 * clamped here. `brand` is a brand slug or null (see parseBrandParam); one that
 * names no brand of the category lists nothing.
 *
 * `vehicleId` is `selectedVehicleId(car)`: the id of a selected car, else null.
 * With null the listing, the counts and the cards are exactly the no-car ones,
 * `fit` is null and every `fitGroup` is null. With an id the listing holds the
 * products that fit the car, then the unknown ones, and drops the products
 * known not to fit (see CategoryFitCounts).
 *
 * Positional primitive arguments on purpose: React cache() memoises by
 * argument identity, so the page and generateMetadata share one read.
 *
 * A database failure logs `category: failed (<code>)` and throws a fixed error
 * with no cause: Drizzle's own message embeds the bound parameters, the vehicle
 * id among them (guardrail 5).
 */
export async function getPublicCategoryPage(
  slug: string,
  page: number,
  brand: string | null,
  sort: CategorySort,
  vehicleId: number | null = null,
): Promise<PublicCategoryPage | null> {
  if (!isWellFormedSlug(slug)) return null;
  try {
    return await readCategoryPage(slug, page, brand, sort, vehicleId);
  } catch (error) {
    // The Postgres code lives on the cause of Drizzle's wrapper. Never the message.
    console.error(
      `category: failed (${errorCode(error instanceof Error && error.cause !== undefined ? error.cause : error)})`,
    );
    throw new Error('category: failed');
  }
}
